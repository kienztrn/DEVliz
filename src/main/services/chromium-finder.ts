import { existsSync } from 'node:fs'
import { platform } from 'node:os'

const WIN_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
  'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe',
]

const MAC_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
]

const LINUX_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
  '/usr/bin/brave-browser',
  '/snap/bin/chromium',
]

export function findChromium(explicitPath?: string | null): string | null {
  if (explicitPath && existsSync(explicitPath)) return explicitPath

  const list =
    platform() === 'win32'
      ? WIN_CANDIDATES
      : platform() === 'darwin'
        ? MAC_CANDIDATES
        : LINUX_CANDIDATES

  for (const candidate of list) {
    if (existsSync(candidate)) return candidate
  }
  return null
}
