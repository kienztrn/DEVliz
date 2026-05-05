import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FingerprintConfig, ProxyRecord } from '@shared/types'

/**
 * Build a Chrome MV3 extension that:
 * - Provides proxy auth via webRequest.onAuthRequired
 * - Spoofs UA-CH client hints via declarativeNetRequest header rewrite
 * - Injects a content/world script that patches:
 *   navigator.userAgent / platform / hardwareConcurrency / deviceMemory / language(s),
 *   screen.* dims, Date timezone offset, Intl.DateTimeFormat resolvedOptions,
 *   WebGLRenderingContext.getParameter (vendor/renderer + tiny noise),
 *   HTMLCanvasElement.toDataURL/getContext('2d').getImageData (canvas noise),
 *   AudioContext analyser (audio noise),
 *   RTCPeerConnection (WebRTC mode).
 */
const PROFILE_PALETTE = [
  '#1a73e8',
  '#d93025',
  '#188038',
  '#9334e6',
  '#0b8043',
  '#1967d2',
  '#a142f4',
  '#e8710a',
  '#137333',
  '#7627bb',
  '#c5221f',
  '#0d652d',
]

function colorForProfile(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0
  return PROFILE_PALETTE[Math.abs(h) % PROFILE_PALETTE.length]
}

function initialFor(name: string): string {
  const trimmed = (name || '').trim()
  if (!trimmed) return 'P'
  const ch = trimmed[0]
  return ch.toUpperCase()
}

export function buildFingerprintExtension(
  dir: string,
  fp: FingerprintConfig,
  proxy: ProxyRecord | null,
  profileId = '',
  profileName = '',
): string {
  mkdirSync(dir, { recursive: true })

  const profileColor = colorForProfile(profileId || profileName || 'profile')
  const profileInitial = initialFor(profileName)
  const displayName = profileName || 'Profile'

  const manifest = {
    manifest_version: 3,
    name: `MBM \u2014 ${displayName}`,
    version: '1.0.0',
    description: `Profile indicator + fingerprint/proxy bridge for "${displayName}".`,
    action: {
      default_title: displayName,
    },
    permissions: ['webRequest', 'webRequestAuthProvider', 'declarativeNetRequest', 'scripting'],
    host_permissions: ['<all_urls>'],
    background: { service_worker: 'background.js' },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['content.js'],
        run_at: 'document_start',
        all_frames: true,
        world: 'MAIN',
      },
      {
        matches: ['<all_urls>'],
        js: ['indicator.js'],
        run_at: 'document_end',
        all_frames: false,
      },
    ],
    declarative_net_request: {
      rule_resources: [
        {
          id: 'rules',
          enabled: true,
          path: 'rules.json',
        },
      ],
    },
  }

  const language = fp.locale.split(',')[0]
  const baseLang = language.split('-')[0]
  const acceptLanguage = fp.acceptLanguage

  const rules = [
    {
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'User-Agent', operation: 'set', value: fp.userAgent },
          { header: 'Accept-Language', operation: 'set', value: acceptLanguage },
        ],
      },
      condition: {
        urlFilter: '*',
        resourceTypes: [
          'main_frame',
          'sub_frame',
          'xmlhttprequest',
          'script',
          'stylesheet',
          'image',
          'font',
          'media',
          'websocket',
          'other',
        ],
      },
    },
  ]

  const proxyAuth =
    proxy && proxy.username ? { username: proxy.username, password: proxy.password ?? '' } : null

  const background = `
const PROXY_AUTH = ${JSON.stringify(proxyAuth)};
const PROFILE_NAME = ${JSON.stringify(displayName)};
const PROFILE_COLOR = ${JSON.stringify(profileColor)};
const PROFILE_INITIAL = ${JSON.stringify(profileInitial)};

if (PROXY_AUTH) {
  chrome.webRequest.onAuthRequired.addListener(
    (_details) => ({ authCredentials: { username: PROXY_AUTH.username, password: PROXY_AUTH.password } }),
    { urls: ['<all_urls>'] },
    ['blocking']
  );
}

async function setupAction() {
  try {
    const sizes = [16, 32, 48, 128];
    const imageData = {};
    for (const size of sizes) {
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const r = Math.max(2, size / 4);
      ctx.fillStyle = PROFILE_COLOR;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(size - r, 0);
      ctx.quadraticCurveTo(size, 0, size, r);
      ctx.lineTo(size, size - r);
      ctx.quadraticCurveTo(size, size, size - r, size);
      ctx.lineTo(r, size);
      ctx.quadraticCurveTo(0, size, 0, size - r);
      ctx.lineTo(0, r);
      ctx.quadraticCurveTo(0, 0, r, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold ' + Math.floor(size * 0.6) + 'px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(PROFILE_INITIAL, size / 2, size / 2 + size * 0.04);
      imageData[size] = ctx.getImageData(0, 0, size, size);
    }
    await chrome.action.setIcon({ imageData });
    await chrome.action.setTitle({ title: PROFILE_NAME });
    await chrome.action.setBadgeBackgroundColor({ color: PROFILE_COLOR });
    await chrome.action.setBadgeText({ text: PROFILE_INITIAL });
  } catch (e) {
    // ignore
  }
}

chrome.runtime.onStartup.addListener(setupAction);
chrome.runtime.onInstalled.addListener(setupAction);
setupAction();
`.trim()

  const indicator = `
(() => {
  const NAME = ${JSON.stringify(displayName)};
  const COLOR = ${JSON.stringify(profileColor)};
  const HIDE_KEY = '__mbm_indicator_hidden_session__';
  const CHIP_ID = '__mbm_chip__';
  const prefix = '[' + NAME + '] ';

  function applyTitlePrefix() {
    try {
      const t = document.title || '';
      if (!t.startsWith(prefix)) document.title = prefix + t;
    } catch (_) {}
  }

  function watchTitle() {
    try {
      const titleEl = document.querySelector('title');
      if (titleEl) {
        new MutationObserver(applyTitlePrefix).observe(titleEl, {
          childList: true, characterData: true, subtree: true,
        });
      }
      const head = document.head || document.documentElement;
      if (head) {
        new MutationObserver((muts) => {
          for (const m of muts) {
            for (const n of m.addedNodes) {
              if (n && n.nodeName === 'TITLE') {
                applyTitlePrefix();
                new MutationObserver(applyTitlePrefix).observe(n, {
                  childList: true, characterData: true, subtree: true,
                });
              }
            }
          }
        }).observe(head, { childList: true });
      }
    } catch (_) {}
  }

  function injectChip() {
    try {
      if (sessionStorage.getItem(HIDE_KEY) === '1') return;
      if (!document.body) return;
      if (document.getElementById(CHIP_ID)) return;
      const chip = document.createElement('div');
      chip.id = CHIP_ID;
      chip.style.cssText = [
        'all: initial',
        'position: fixed',
        'top: 12px',
        'right: 12px',
        'z-index: 2147483647',
        'background: ' + COLOR,
        'color: #fff',
        'padding: 6px 8px 6px 10px',
        'border-radius: 9999px',
        'font: 600 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
        'box-shadow: 0 2px 8px rgba(0,0,0,0.18)',
        'user-select: none',
        'display: flex',
        'align-items: center',
        'gap: 6px',
        'max-width: 240px',
        'pointer-events: auto',
        'cursor: default',
      ].join(';');
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('width', '14'); icon.setAttribute('height', '14');
      icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('fill', 'rgba(255,255,255,0.95)');
      icon.style.flexShrink = '0';
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z');
      icon.appendChild(path);
      const label = document.createElement('span');
      label.textContent = NAME;
      label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff;font:inherit';
      const close = document.createElement('span');
      close.textContent = '\u00d7';
      close.title = 'Hide for this tab';
      close.style.cssText = 'cursor:pointer;opacity:0.8;font-size:16px;line-height:1;padding:0 2px 0 4px;color:#fff';
      close.addEventListener('click', () => {
        try { sessionStorage.setItem(HIDE_KEY, '1'); } catch (_) {}
        chip.remove();
      });
      chip.appendChild(icon);
      chip.appendChild(label);
      chip.appendChild(close);
      document.body.appendChild(chip);
    } catch (_) {}
  }

  applyTitlePrefix();
  watchTitle();
  injectChip();

  try {
    new MutationObserver(() => {
      applyTitlePrefix();
      injectChip();
    }).observe(document.documentElement || document, { childList: true, subtree: false });
  } catch (_) {}
})();
`.trim()

  const content = `
(() => {
  const FP = ${JSON.stringify({
    userAgent: fp.userAgent,
    platform: fp.platform,
    language,
    languages: Array.from(new Set([language, baseLang, 'en'])),
    hardwareConcurrency: fp.hardwareConcurrency,
    deviceMemory: fp.deviceMemory,
    screen: fp.screen,
    timezone: fp.timezone,
    webgl: fp.webgl,
    canvasNoise: fp.canvasNoise,
    audioNoise: fp.audioNoise,
    webrtcMode: fp.webrtcMode,
  })};

  const SEED = (() => {
    let h = 0;
    for (let i = 0; i < FP.userAgent.length; i++) h = (h * 31 + FP.userAgent.charCodeAt(i)) | 0;
    return h >>> 0;
  })();
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return ((s >>> 0) % 1_000_000) / 1_000_000;
    };
  }

  const safeDef = (obj, key, value) => {
    try { Object.defineProperty(obj, key, { get: () => value, configurable: true }); }
    catch (_) { /* ignore */ }
  };

  // navigator.*
  safeDef(navigator, 'userAgent', FP.userAgent);
  safeDef(navigator, 'appVersion', FP.userAgent.replace(/^Mozilla\\//, ''));
  safeDef(navigator, 'platform', FP.platform);
  safeDef(navigator, 'language', FP.language);
  safeDef(navigator, 'languages', Object.freeze([...FP.languages]));
  safeDef(navigator, 'hardwareConcurrency', FP.hardwareConcurrency);
  safeDef(navigator, 'deviceMemory', FP.deviceMemory);

  // screen.*
  for (const [k, v] of Object.entries({ width: FP.screen.width, height: FP.screen.height, availWidth: FP.screen.width, availHeight: FP.screen.height - 40, colorDepth: FP.screen.colorDepth, pixelDepth: FP.screen.colorDepth })) {
    safeDef(screen, k, v);
  }
  safeDef(window, 'devicePixelRatio', FP.screen.pixelRatio);

  // Timezone
  try {
    const NativeDateTimeFormat = Intl.DateTimeFormat;
    const Patched = function (...args) {
      if (args.length >= 2 && args[1] && typeof args[1] === 'object' && !args[1].timeZone) args[1].timeZone = FP.timezone;
      else if (args.length < 2) args[1] = { timeZone: FP.timezone };
      return new NativeDateTimeFormat(...args);
    };
    Patched.prototype = NativeDateTimeFormat.prototype;
    Patched.supportedLocalesOf = NativeDateTimeFormat.supportedLocalesOf.bind(NativeDateTimeFormat);
    // @ts-ignore
    Intl.DateTimeFormat = Patched;
    const origResolved = NativeDateTimeFormat.prototype.resolvedOptions;
    NativeDateTimeFormat.prototype.resolvedOptions = function () {
      const r = origResolved.call(this);
      r.timeZone = FP.timezone;
      r.locale = FP.language;
      return r;
    };
  } catch (_) {}

  // Date.getTimezoneOffset (fallback offset based on a few well-known zones)
  try {
    const offsets = {
      'Asia/Ho_Chi_Minh': -420, 'Asia/Bangkok': -420, 'Asia/Tokyo': -540,
      'Asia/Singapore': -480, 'Asia/Hong_Kong': -480,
      'America/Los_Angeles': 480, 'America/New_York': 300, 'America/Chicago': 360,
      'Europe/London': 0, 'Europe/Berlin': -60, 'Europe/Paris': -60,
      'Australia/Sydney': -600,
    };
    const off = offsets[FP.timezone];
    if (typeof off === 'number') {
      // eslint-disable-next-line no-extend-native
      Date.prototype.getTimezoneOffset = function () { return off; };
    }
  } catch (_) {}

  // WebGL spoof
  try {
    const patchGL = (proto) => {
      const orig = proto.getParameter;
      proto.getParameter = function (p) {
        if (p === 37445) return FP.webgl.vendor;          // UNMASKED_VENDOR_WEBGL
        if (p === 37446) return FP.webgl.renderer;        // UNMASKED_RENDERER_WEBGL
        if (p === 7936)  return FP.webgl.vendor;          // VENDOR
        if (p === 7937)  return FP.webgl.renderer;        // RENDERER
        return orig.call(this, p);
      };
    };
    if (window.WebGLRenderingContext) patchGL(WebGLRenderingContext.prototype);
    if (window.WebGL2RenderingContext) patchGL(WebGL2RenderingContext.prototype);
  } catch (_) {}

  // Canvas noise
  try {
    const noise = FP.canvasNoise;
    const r = rng(SEED);
    const wrapImg = (origImageData) => function (...args) {
      const data = origImageData.apply(this, args);
      try {
        for (let i = 0; i < data.data.length; i += 4) {
          if (r() < 0.0008) {
            data.data[i] = (data.data[i] + Math.floor(r() * 3 * noise)) & 255;
            data.data[i + 1] = (data.data[i + 1] + Math.floor(r() * 3 * noise)) & 255;
            data.data[i + 2] = (data.data[i + 2] + Math.floor(r() * 3 * noise)) & 255;
          }
        }
      } catch (_) {}
      return data;
    };
    const ctx2d = CanvasRenderingContext2D.prototype;
    if (ctx2d && ctx2d.getImageData) ctx2d.getImageData = wrapImg(ctx2d.getImageData);
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      try {
        const ctx = this.getContext('2d');
        if (ctx) {
          const w = this.width, h = this.height;
          if (w > 0 && h > 0) {
            ctx.fillStyle = 'rgba(' + Math.floor(r() * 255) + ',' + Math.floor(r() * 255) + ',' + Math.floor(r() * 255) + ',0.0035)';
            ctx.fillRect(Math.floor(r() * Math.max(1, w - 1)), Math.floor(r() * Math.max(1, h - 1)), 1, 1);
          }
        }
      } catch (_) {}
      return origToDataURL.apply(this, args);
    };
  } catch (_) {}

  // Audio noise (analyser)
  try {
    const noise = FP.audioNoise;
    const r = rng(SEED ^ 0x9e3779b9);
    const proto = (window.AnalyserNode || window.RealAnalyserNode || (window.AudioContext && AudioContext.prototype && AudioContext.prototype.createAnalyser && Object.getPrototypeOf(new (window.OfflineAudioContext || window.AudioContext)(1, 1, 44100).createAnalyser())));
    if (proto && proto.getFloatFrequencyData) {
      const orig = proto.getFloatFrequencyData;
      proto.getFloatFrequencyData = function (arr) {
        orig.call(this, arr);
        for (let i = 0; i < arr.length; i++) arr[i] += (r() - 0.5) * noise;
      };
    }
  } catch (_) {}

  // WebRTC: disable to avoid leaks
  try {
    if (FP.webrtcMode === 'disabled') {
      window.RTCPeerConnection = function () { throw new Error('WebRTC disabled'); };
      window.webkitRTCPeerConnection = window.RTCPeerConnection;
      window.RTCDataChannel = undefined;
    }
  } catch (_) {}
})();
`.trim()

  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(join(dir, 'rules.json'), JSON.stringify(rules, null, 2))
  writeFileSync(join(dir, 'background.js'), background)
  writeFileSync(join(dir, 'content.js'), content)
  writeFileSync(join(dir, 'indicator.js'), indicator)
  return dir
}
