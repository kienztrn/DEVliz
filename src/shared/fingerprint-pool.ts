import type { FingerprintConfig } from './types'

const UA_WIN = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
]

const UA_MAC = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
]

const UA_LINUX = [
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
]

const UA_ANDROID = [
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
]

const UA_IOS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
]

export const TIMEZONES = [
  'Asia/Ho_Chi_Minh',
  'Asia/Bangkok',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'America/Los_Angeles',
  'America/New_York',
  'America/Chicago',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Australia/Sydney',
]

export const LOCALES = [
  'vi-VN',
  'en-US',
  'en-GB',
  'ja-JP',
  'ko-KR',
  'zh-CN',
  'fr-FR',
  'de-DE',
  'es-ES',
  'th-TH',
]

const SCREEN_PROFILES_DESKTOP = [
  { width: 1920, height: 1080, colorDepth: 24, pixelRatio: 1 },
  { width: 1536, height: 864, colorDepth: 24, pixelRatio: 1.25 },
  { width: 1440, height: 900, colorDepth: 24, pixelRatio: 1 },
  { width: 1366, height: 768, colorDepth: 24, pixelRatio: 1 },
  { width: 2560, height: 1440, colorDepth: 24, pixelRatio: 1 },
]

const SCREEN_PROFILES_MOBILE = [
  { width: 390, height: 844, colorDepth: 24, pixelRatio: 3 },
  { width: 412, height: 915, colorDepth: 24, pixelRatio: 2.625 },
  { width: 360, height: 780, colorDepth: 24, pixelRatio: 3 },
]

const WEBGL_VENDORS = [
  {
    vendor: 'Google Inc. (Intel)',
    renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    vendor: 'Google Inc. (AMD)',
    renderer: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  { vendor: 'Apple Inc.', renderer: 'Apple M1' },
  { vendor: 'Apple Inc.', renderer: 'Apple M2' },
]

const HARDWARE_CONCURRENCY = [4, 6, 8, 12, 16]
const DEVICE_MEMORY = [4, 8, 16, 32]

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function buildFingerprint(os: FingerprintConfig['os'] = 'win'): FingerprintConfig {
  let userAgent: string
  let platform: string
  let screenPool = SCREEN_PROFILES_DESKTOP

  switch (os) {
    case 'mac':
      userAgent = pickRandom(UA_MAC)
      platform = 'MacIntel'
      break
    case 'linux':
      userAgent = pickRandom(UA_LINUX)
      platform = 'Linux x86_64'
      break
    case 'android':
      userAgent = pickRandom(UA_ANDROID)
      platform = 'Linux armv8l'
      screenPool = SCREEN_PROFILES_MOBILE
      break
    case 'ios':
      userAgent = pickRandom(UA_IOS)
      platform = 'iPhone'
      screenPool = SCREEN_PROFILES_MOBILE
      break
    case 'win':
    default:
      userAgent = pickRandom(UA_WIN)
      platform = 'Win32'
      break
  }

  const locale = pickRandom(LOCALES)
  const timezone = pickRandom(TIMEZONES)
  const screen = pickRandom(screenPool)
  const webgl = pickRandom(WEBGL_VENDORS)

  return {
    os,
    userAgent,
    acceptLanguage: `${locale},${locale.split('-')[0]};q=0.9,en;q=0.8`,
    locale,
    timezone,
    screen,
    platform,
    hardwareConcurrency: pickRandom(HARDWARE_CONCURRENCY),
    deviceMemory: pickRandom(DEVICE_MEMORY),
    webgl: {
      vendor: webgl.vendor,
      renderer: webgl.renderer,
      noise: Math.random() * 0.0001,
    },
    canvasNoise: 0.5 + Math.random() * 0.5,
    audioNoise: 0.0001 + Math.random() * 0.0009,
    webrtcMode: 'proxy-only',
  }
}
