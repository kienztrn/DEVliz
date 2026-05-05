import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FingerprintConfig, ProxyRecord } from '@shared/types'
import { colorForProfile } from './icon-builder'

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
function initialFor(name: string): string {
  const trimmed = (name || '').trim()
  if (!trimmed) return 'P'
  const ch = trimmed[0]
  return ch.toUpperCase()
}

export interface MailReportConfig {
  port: number
  token: string
}

export function buildFingerprintExtension(
  dir: string,
  fp: FingerprintConfig,
  proxy: ProxyRecord | null,
  profileId = '',
  profileName = '',
  mailReport: MailReportConfig | null = null,
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
      {
        matches: ['*://mail.google.com/*'],
        js: ['gmail-watcher.js'],
        run_at: 'document_idle',
        all_frames: false,
        world: 'MAIN',
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

  const gmailWatcher = `
(() => {
  const PROFILE_ID = ${JSON.stringify(profileId)};
  const REPORT_PORT = ${JSON.stringify(mailReport ? mailReport.port : 0)};
  const REPORT_TOKEN = ${JSON.stringify(mailReport ? mailReport.token : '')};
  const TAG = '[DEVliz]';
  if (!REPORT_PORT || !REPORT_TOKEN || !PROFILE_ID) {
    console.warn(TAG, 'gmail-watcher missing config — automation disabled', {
      hasPort: !!REPORT_PORT,
      hasToken: !!REPORT_TOKEN,
      hasProfileId: !!PROFILE_ID,
    });
    return;
  }

  const BASE = 'http://127.0.0.1:' + REPORT_PORT;
  const ID_ENC = encodeURIComponent(PROFILE_ID);
  const TOK_ENC = encodeURIComponent(REPORT_TOKEN);
  const REPORT_URL = BASE + '/api/mail-report/' + ID_ENC + '/' + TOK_ENC;
  const COMMAND_URL = BASE + '/api/command/' + ID_ENC + '/' + TOK_ENC;
  const PROGRESS_URL = BASE + '/api/automation-progress/' + ID_ENC + '/' + TOK_ENC;

  console.log(TAG, 'gmail-watcher loaded for profile', PROFILE_ID, '— mail server', BASE);

  let lastReportedUnread = -1;
  let lastReportTs = 0;
  let automationRunning = false;
  let commandPollCount = 0;
  let commandPollOk = 0;
  let commandPollFail = 0;

  function readEmail() {
    try {
      const a = document.querySelector('a[href*="//myaccount.google.com/"][aria-label]');
      if (a) {
        const m = a.getAttribute('aria-label').match(/[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+/);
        if (m) return m[0];
      }
      const t = document.title.match(/[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+/);
      if (t) return t[0];
    } catch (_) {}
    return null;
  }

  function readLabel() {
    try {
      const m = document.title.match(/^([^()]+?)\\s*\\(\\d+\\)/);
      if (m) return m[1].trim();
      const m2 = document.title.match(/^([^-]+?)\\s*-\\s*[\\w.+-]+@/);
      if (m2) return m2[1].trim();
    } catch (_) {}
    return null;
  }

  function readUnread() {
    try {
      const m = document.title.match(/\\((\\d+)\\)/);
      if (m) return parseInt(m[1], 10) || 0;
      if (/Inbox|H\\u1ed9p th\\u01b0 \\u0111\\u1ebfn/i.test(document.title)) return 0;
    } catch (_) {}
    return null;
  }

  function report(force) {
    const unread = readUnread();
    if (unread === null) return;
    const now = Date.now();
    if (!force && unread === lastReportedUnread && now - lastReportTs < 60000) return;
    lastReportedUnread = unread;
    lastReportTs = now;
    try {
      fetch(REPORT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ unread, email: readEmail(), label: readLabel() }),
        keepalive: true,
        credentials: 'omit',
        mode: 'cors',
      }).catch(() => {});
    } catch (_) {}
  }

  setTimeout(() => report(true), 1500);
  setInterval(() => report(false), 30000);

  try {
    const titleEl = document.querySelector('title');
    if (titleEl) {
      new MutationObserver(() => report(false)).observe(titleEl, {
        childList: true, characterData: true, subtree: true,
      });
    }
  } catch (_) {}

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') report(true);
  });

  // ---------- Automation command polling + inbox rotation ----------

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function rand(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }

  function postProgress(commandId, phase, extra) {
    extra = extra || {};
    const body = Object.assign({ commandId: commandId, phase: phase }, extra);
    try {
      fetch(PROGRESS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit',
        mode: 'cors',
        keepalive: true,
      }).catch(() => {});
    } catch (_) {}
  }

  function dismissPopups() {
    let dismissed = 0;
    const dismissTexts = [
      'got it',
      'no thanks',
      'skip',
      'maybe later',
      'cancel',
      'close',
      'b\\u1ecf qua',
      '\\u0111\\u1ec3 sau',
      '\\u0111\\u1eebng h\\u1ecfi l\\u1ea1i',
      '\\u0111\\u00e3 hi\\u1ec3u',
      'kh\\u00f4ng, c\\u1ea3m \\u01a1n',
    ];
    try {
      const buttons = document.querySelectorAll('button, [role="button"]');
      buttons.forEach(function (btn) {
        const txt = (btn.textContent || '').trim().toLowerCase();
        const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
        const target = txt || aria;
        if (!target) return;
        for (let i = 0; i < dismissTexts.length; i++) {
          if (target.indexOf(dismissTexts[i]) !== -1) {
            try { btn.click(); dismissed++; } catch (_) {}
            break;
          }
        }
      });
    } catch (_) {}
    return dismissed;
  }

  function findUnreadRow() {
    const r = document.querySelector('tr.zE');
    if (r) return r;
    const labeled = document.querySelector('tr.zA[aria-labelledby] [aria-label$="unread"]');
    if (labeled) {
      const row = labeled.closest ? labeled.closest('tr.zA') : null;
      if (row) return row;
    }
    return null;
  }

  function rowSubject(row) {
    if (!row) return '';
    try {
      const subjEl = row.querySelector('[role="link"] span, .y6 span, .bog span, .bog');
      if (subjEl) return (subjEl.textContent || '').trim().slice(0, 200);
      return (row.textContent || '').trim().slice(0, 100);
    } catch (_) { return ''; }
  }

  async function navigateBackToInbox() {
    try {
      const back = document.querySelector('[aria-label="Back to Inbox"], [aria-label*="quay l\\u1ea1i"], [data-tooltip*="Back to Inbox"]');
      if (back) { back.click(); return; }
    } catch (_) {}
    try { history.back(); } catch (_) {}
    if (location.hash && location.hash.indexOf('#inbox') !== 0) {
      try { location.hash = '#inbox'; } catch (_) {}
    }
  }

  async function waitForInbox(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (location.hash.indexOf('#inbox') === 0 && document.querySelector('table[role="grid"], table.F.cf.zt')) {
        return true;
      }
      await sleep(300);
    }
    return false;
  }

  async function runGmailRotate(commandId, options) {
    if (automationRunning) {
      postProgress(commandId, 'error', { message: 'already running' });
      return;
    }
    automationRunning = true;

    const opts = options || {};
    const maxItems = Math.max(1, Math.min(200, opts.maxItems || 50));
    const minOpenMs = Math.max(500, opts.minOpenMs || 2000);
    const maxOpenMs = Math.max(minOpenMs, opts.maxOpenMs || 3000);
    const minReadMs = Math.max(500, opts.minReadMs || 5000);
    const maxReadMs = Math.max(minReadMs, opts.maxReadMs || 7000);

    try {
      postProgress(commandId, 'started', { total: maxItems });

      // Make sure we are on the inbox
      if (location.hash && location.hash.indexOf('#inbox') !== 0) {
        try { location.hash = '#inbox'; } catch (_) {}
        await sleep(1500);
      }

      // Initial dismiss + a brief wait for UI
      const dismissed = dismissPopups();
      if (dismissed > 0) postProgress(commandId, 'dismiss-popup', { message: dismissed + ' popup(s) dismissed' });
      await sleep(1500);

      let processed = 0;
      for (let i = 0; i < maxItems; i++) {
        // Refresh popup dismissal each iteration in case Google shows a new one
        dismissPopups();

        const row = findUnreadRow();
        if (!row) {
          postProgress(commandId, 'no-unread', { index: processed, total: processed });
          break;
        }
        const subject = rowSubject(row);
        postProgress(commandId, 'opening', { index: processed + 1, total: maxItems, subject: subject });

        try {
          row.click();
        } catch (_) {
          postProgress(commandId, 'error', { index: processed + 1, message: 'click failed' });
          await sleep(500);
          continue;
        }

        await sleep(rand(minOpenMs, maxOpenMs));
        try { window.scrollBy({ top: 400 + Math.floor(Math.random() * 300), behavior: 'smooth' }); } catch (_) {}
        postProgress(commandId, 'reading', { index: processed + 1, total: maxItems, subject: subject });
        await sleep(rand(minReadMs, maxReadMs));

        await navigateBackToInbox();
        await waitForInbox(5000);
        await sleep(800);

        processed++;
        postProgress(commandId, 'done-item', { index: processed, total: maxItems, subject: subject });
      }

      postProgress(commandId, 'finished', { total: processed });
    } catch (e) {
      postProgress(commandId, 'error', { message: (e && e.message) || String(e) });
    } finally {
      automationRunning = false;
    }
  }

  async function pollCommands() {
    commandPollCount++;
    try {
      const res = await fetch(COMMAND_URL, { credentials: 'omit', mode: 'cors' });
      if (!res.ok) {
        commandPollFail++;
        console.warn(TAG, 'pollCommands HTTP', res.status, COMMAND_URL);
        return;
      }
      commandPollOk++;
      const data = await res.json().catch(() => null);
      if (commandPollCount === 1) {
        console.log(TAG, 'first command poll OK', { url: COMMAND_URL, data: data });
      }
      if (!data || !data.command) return;
      const cmd = data.command;
      console.log(TAG, 'command received', cmd);
      if (cmd.type === 'gmail-rotate-unread') {
        runGmailRotate(cmd.id, cmd.options);
      } else {
        console.warn(TAG, 'unknown command type', cmd.type);
      }
    } catch (e) {
      commandPollFail++;
      if (commandPollFail <= 3 || commandPollFail % 10 === 0) {
        console.warn(TAG, 'pollCommands fetch failed', e && (e.message || e), 'url:', COMMAND_URL);
      }
    }
  }

  // Expose a manual trigger for debugging from DevTools console.
  // Usage: __devliz_runGmailRotate({ maxItems: 5 })
  try {
    Object.defineProperty(window, '__devliz_runGmailRotate', {
      value: function (opts) {
        console.log(TAG, 'manual trigger via __devliz_runGmailRotate', opts || {});
        runGmailRotate('manual_' + Date.now(), opts || {});
      },
      writable: false,
      configurable: true,
    });
    Object.defineProperty(window, '__devliz_status', {
      value: function () {
        return {
          profileId: PROFILE_ID,
          mailServer: BASE,
          commandPollCount: commandPollCount,
          commandPollOk: commandPollOk,
          commandPollFail: commandPollFail,
          automationRunning: automationRunning,
        };
      },
      writable: false,
      configurable: true,
    });
  } catch (_) {}

  setTimeout(pollCommands, 2500);
  setInterval(pollCommands, 5000);
})();
`.trim()

  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(join(dir, 'rules.json'), JSON.stringify(rules, null, 2))
  writeFileSync(join(dir, 'background.js'), background)
  writeFileSync(join(dir, 'content.js'), content)
  writeFileSync(join(dir, 'indicator.js'), indicator)
  writeFileSync(join(dir, 'gmail-watcher.js'), gmailWatcher)
  return dir
}
