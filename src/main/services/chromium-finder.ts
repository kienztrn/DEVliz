import { existsSync } from 'node:fs'
import { homedir, platform } from 'node:os'

export interface BrowserCandidate {
  path: string
  brand: string
}

function expand(p: string): string {
  return p.replace(/^~/, homedir())
}

// Priority order: prefer non-Google, open-source / privacy-focused Chromium
// forks first, fall back to Edge / Chrome. The user's stated reason for
// switching away from Chrome is fingerprint/anti-detection — these forks all
// share the Chromium engine so behavior is identical, but using a non-Chrome
// binary avoids the "Chrome by Google" branding which many sites flag.
const WIN_CANDIDATES: BrowserCandidate[] = [
  { path: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', brand: 'Brave' },
  {
    path: 'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe',
    brand: 'Brave',
  },
  { path: 'C:/Program Files/Vivaldi/Application/vivaldi.exe', brand: 'Vivaldi' },
  { path: 'C:/Program Files (x86)/Vivaldi/Application/vivaldi.exe', brand: 'Vivaldi' },
  { path: 'C:/Program Files/Chromium/Application/chrome.exe', brand: 'Chromium' },
  { path: 'C:/Program Files/ungoogled-chromium/chrome.exe', brand: 'ungoogled-chromium' },
  { path: 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', brand: 'Edge' },
  { path: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', brand: 'Edge' },
  { path: 'C:/Program Files/Opera/launcher.exe', brand: 'Opera' },
  { path: 'C:/Program Files (x86)/Opera/launcher.exe', brand: 'Opera' },
  { path: 'C:/Program Files (x86)/Yandex/YandexBrowser/Application/browser.exe', brand: 'Yandex' },
  { path: 'C:/Program Files/Google/Chrome/Application/chrome.exe', brand: 'Chrome' },
  { path: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', brand: 'Chrome' },
]

const WIN_USER_CANDIDATES: BrowserCandidate[] = [
  {
    path: '~/AppData/Local/BraveSoftware/Brave-Browser/Application/brave.exe',
    brand: 'Brave',
  },
  { path: '~/AppData/Local/Vivaldi/Application/vivaldi.exe', brand: 'Vivaldi' },
  { path: '~/AppData/Local/Chromium/Application/chrome.exe', brand: 'Chromium' },
  {
    path: '~/AppData/Local/ungoogled-chromium/chrome.exe',
    brand: 'ungoogled-chromium',
  },
  { path: '~/AppData/Local/Microsoft/Edge/Application/msedge.exe', brand: 'Edge' },
  { path: '~/AppData/Local/Google/Chrome/Application/chrome.exe', brand: 'Chrome' },
]

const MAC_CANDIDATES: BrowserCandidate[] = [
  {
    path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    brand: 'Brave',
  },
  { path: '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi', brand: 'Vivaldi' },
  { path: '/Applications/Chromium.app/Contents/MacOS/Chromium', brand: 'Chromium' },
  {
    path: '/Applications/Ungoogled Chromium.app/Contents/MacOS/Chromium',
    brand: 'ungoogled-chromium',
  },
  {
    path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    brand: 'Edge',
  },
  { path: '/Applications/Opera.app/Contents/MacOS/Opera', brand: 'Opera' },
  {
    path: '/Applications/Yandex.app/Contents/MacOS/Yandex',
    brand: 'Yandex',
  },
  {
    path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    brand: 'Chrome',
  },
]

const LINUX_CANDIDATES: BrowserCandidate[] = [
  { path: '/usr/bin/brave-browser', brand: 'Brave' },
  { path: '/usr/bin/brave', brand: 'Brave' },
  { path: '/usr/bin/vivaldi', brand: 'Vivaldi' },
  { path: '/usr/bin/vivaldi-stable', brand: 'Vivaldi' },
  { path: '/usr/bin/chromium', brand: 'Chromium' },
  { path: '/usr/bin/chromium-browser', brand: 'Chromium' },
  { path: '/snap/bin/chromium', brand: 'Chromium' },
  { path: '/usr/bin/ungoogled-chromium', brand: 'ungoogled-chromium' },
  { path: '/usr/bin/microsoft-edge', brand: 'Edge' },
  { path: '/usr/bin/microsoft-edge-stable', brand: 'Edge' },
  { path: '/usr/bin/opera', brand: 'Opera' },
  { path: '/usr/bin/yandex-browser', brand: 'Yandex' },
  { path: '/usr/bin/google-chrome', brand: 'Chrome' },
  { path: '/usr/bin/google-chrome-stable', brand: 'Chrome' },
]

function candidatesForCurrentOs(): BrowserCandidate[] {
  if (platform() === 'win32') return [...WIN_USER_CANDIDATES, ...WIN_CANDIDATES]
  if (platform() === 'darwin') return MAC_CANDIDATES
  return LINUX_CANDIDATES
}

export function detectBrowser(explicitPath?: string | null): BrowserCandidate | null {
  if (explicitPath && existsSync(explicitPath)) {
    return { path: explicitPath, brand: brandFromPath(explicitPath) }
  }

  for (const c of candidatesForCurrentOs()) {
    const resolved = expand(c.path)
    if (existsSync(resolved)) return { path: resolved, brand: c.brand }
  }
  return null
}

export function findChromium(explicitPath?: string | null): string | null {
  return detectBrowser(explicitPath)?.path ?? null
}

function brandFromPath(p: string): string {
  const lower = p.toLowerCase().replace(/\\/g, '/')
  if (lower.includes('brave')) return 'Brave'
  if (lower.includes('vivaldi')) return 'Vivaldi'
  if (lower.includes('ungoogled')) return 'ungoogled-chromium'
  if (lower.includes('chromium')) return 'Chromium'
  if (lower.includes('msedge') || lower.includes('microsoft/edge')) return 'Edge'
  if (lower.includes('opera')) return 'Opera'
  if (lower.includes('yandex')) return 'Yandex'
  if (lower.includes('chrome')) return 'Chrome'
  // Hidemyacc (Marco/Ghosty), xBrowser, AdsPower, BitBrowser etc.: all are
  // Chromium forks; we can't auto-detect their brand from the path — the
  // user knows what they pointed us at, just show "Custom".
  return 'Custom'
}

// Shape returned to the renderer.
export interface DetectedBrowserInfo {
  path: string | null
  brand: string | null
  source: 'explicit' | 'auto' | 'none'
}

export function describeDetectedBrowser(explicitPath?: string | null): DetectedBrowserInfo {
  if (explicitPath && existsSync(explicitPath)) {
    return { path: explicitPath, brand: brandFromPath(explicitPath), source: 'explicit' }
  }
  const auto = detectBrowser(null)
  if (auto) return { path: auto.path, brand: auto.brand, source: 'auto' }
  return { path: null, brand: null, source: 'none' }
}
