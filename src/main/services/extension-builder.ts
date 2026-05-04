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
export function buildFingerprintExtension(
  dir: string,
  fp: FingerprintConfig,
  proxy: ProxyRecord | null,
): string {
  mkdirSync(dir, { recursive: true })

  const manifest = {
    manifest_version: 3,
    name: 'MBM Fingerprint Bridge',
    version: '1.0.0',
    description: 'Internal fingerprint and proxy auth handler for Multi Browser Manager.',
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
if (PROXY_AUTH) {
  chrome.webRequest.onAuthRequired.addListener(
    (_details) => ({ authCredentials: { username: PROXY_AUTH.username, password: PROXY_AUTH.password } }),
    { urls: ['<all_urls>'] },
    ['blocking']
  );
}
`.trim()

  const content = `
(() => {
  const FP = ${JSON.stringify({
    userAgent: fp.userAgent,
    platform: fp.platform,
    language,
    languages: [language, baseLang === language ? 'en' : baseLang, 'en'],
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
      'Australia/Sydney': -660,
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
  return dir
}
