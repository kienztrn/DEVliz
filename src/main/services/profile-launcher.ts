import { spawn, ChildProcess } from 'node:child_process'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  type Dirent,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app } from 'electron'
import { anonymizeProxy, closeAnonymizedProxy } from 'proxy-chain'
import { DEFAULT_START_URL, type ProfileRecord, type ProxyRecord } from '@shared/types'
import { findChromium } from './chromium-finder'
import { buildFingerprintExtension } from './extension-builder'
import { getSettings } from '../repositories/settings-repo'
import { getProxy } from '../repositories/proxy-repo'

interface RunningProfile {
  id: string
  child: ChildProcess
  pid: number
  extensionDir: string
  anonymizedProxyUrl: string | null
}

const running = new Map<string, RunningProfile>()
type StatusListener = (id: string, isRunning: boolean, pid?: number) => void
const listeners = new Set<StatusListener>()

export function onStatusChange(cb: StatusListener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function emitStatus(id: string, isRunning: boolean, pid?: number): void {
  for (const cb of listeners) cb(id, isRunning, pid)
}

export function isRunning(id: string): boolean {
  return running.has(id)
}

export function getRunningStatus(): Record<string, { running: boolean; pid?: number }> {
  const out: Record<string, { running: boolean; pid?: number }> = {}
  for (const [id, info] of running) out[id] = { running: true, pid: info.pid }
  return out
}

function profilesRoot(): string {
  const settings = getSettings()
  if (settings.profilesDir) return settings.profilesDir
  return join(app.getPath('userData'), 'profiles')
}

function buildArgs(
  profile: ProfileRecord,
  userDataDir: string,
  extensionDir: string,
  proxyServer: string | null,
  startUrl: string,
): string[] {
  const args: string[] = [
    `--user-data-dir=${userDataDir}`,
    `--load-extension=${extensionDir}`,
    `--disable-extensions-except=${extensionDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,InterestFeedContentSuggestions,PrivacySandboxSettings4,OptimizationHints',
    `--user-agent=${profile.fingerprint.userAgent}`,
    `--lang=${profile.fingerprint.locale}`,
    `--accept-lang=${profile.fingerprint.acceptLanguage}`,
    `--window-size=${profile.fingerprint.screen.width},${profile.fingerprint.screen.height}`,
    `--force-device-scale-factor=${profile.fingerprint.screen.pixelRatio}`,
  ]

  if (profile.fingerprint.webrtcMode === 'proxy-only') {
    args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp')
  } else if (profile.fingerprint.webrtcMode === 'disabled') {
    args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp')
  }

  if (proxyServer) {
    args.push(`--proxy-server=${proxyServer}`)
    args.push('--proxy-bypass-list=<-loopback>')
  }

  args.push(startUrl)

  return args
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function generateWelcomePage(profileDir: string, profileName: string): string {
  const safeName = escapeHtml(profileName || 'Profile')
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${safeName}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: linear-gradient(135deg, #f5f7fb 0%, #ffffff 60%, #eef2ff 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    color: #202124;
  }
  .name {
    font-size: 56px;
    font-weight: 700;
    margin: 0 0 32px;
    letter-spacing: -0.02em;
    text-align: center;
    word-break: break-word;
    max-width: 800px;
    padding: 0 16px;
    background: linear-gradient(90deg, #1a73e8, #8e44ad);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  form { width: 100%; max-width: 580px; padding: 0 16px; }
  .search {
    display: flex; align-items: center;
    background: #fff;
    border: 1px solid #dfe1e5;
    border-radius: 24px;
    padding: 8px 16px;
    box-shadow: 0 1px 6px rgba(32,33,36,0.08);
    transition: box-shadow .2s, border-color .2s;
  }
  .search:hover, .search:focus-within {
    box-shadow: 0 1px 12px rgba(32,33,36,0.16);
    border-color: rgba(223,225,229,0);
  }
  .search svg { flex-shrink: 0; margin-right: 12px; opacity: .6; }
  input {
    border: 0; outline: 0; font-size: 16px; flex: 1; padding: 10px 0;
    background: transparent; color: #202124;
  }
  .links {
    margin-top: 28px; display: flex; gap: 24px; font-size: 14px;
    flex-wrap: wrap; justify-content: center; padding: 0 16px;
  }
  .links a { color: #5f6368; text-decoration: none; }
  .links a:hover { color: #1a73e8; text-decoration: underline; }
</style>
</head>
<body>
  <h1 class="name">${safeName}</h1>
  <form action="https://www.google.com/search" method="GET" autocomplete="off">
    <div class="search">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
      <input type="text" name="q" autofocus placeholder="Search Google" />
    </div>
  </form>
  <div class="links">
    <a href="https://www.google.com">Google</a>
    <a href="https://mail.google.com">Gmail</a>
    <a href="https://www.youtube.com">YouTube</a>
    <a href="https://maps.google.com">Maps</a>
    <a href="https://translate.google.com">Translate</a>
  </div>
</body>
</html>
`
  const filePath = join(profileDir, 'welcome.html')
  try {
    writeFileSync(filePath, html, 'utf8')
    return pathToFileURL(filePath).href
  } catch {
    return DEFAULT_START_URL
  }
}

function ensureHardlink(src: string, dest: string): void {
  try {
    if (existsSync(dest)) {
      try {
        const s = statSync(src)
        const d = statSync(dest)
        if (s.ino && s.ino === d.ino && s.dev === d.dev) return
      } catch {
        // fall through and recreate
      }
      try {
        rmSync(dest, { force: true })
      } catch {
        return
      }
    }
    try {
      linkSync(src, dest)
    } catch {
      try {
        copyFileSync(src, dest)
      } catch {
        // ignore — Chrome may still find resources via parent path
      }
    }
  } catch {
    // ignore individual file failures
  }
}

function mirrorChromeAppDir(srcDir: string, destDir: string, renameAtRoot: [string, string]): void {
  mkdirSync(destDir, { recursive: true })
  let entries: Dirent[]
  try {
    entries = readdirSync(srcDir, { withFileTypes: true }) as Dirent[]
  } catch {
    return
  }
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name)
    const targetName = entry.name === renameAtRoot[0] ? renameAtRoot[1] : entry.name
    const destPath = join(destDir, targetName)
    if (entry.isDirectory()) {
      mirrorChromeAppDir(srcPath, destPath, ['', ''])
    } else if (entry.isFile()) {
      ensureHardlink(srcPath, destPath)
    }
  }
}

function shortId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'profile'
}

function logFile(): string {
  return join(app.getPath('userData'), 'launch-debug.log')
}

function logLaunch(line: string): void {
  try {
    appendFileSync(logFile(), `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    // best effort
  }
}

let lastLaunchWarning: string | null = null
export function takeLastLaunchWarning(): string | null {
  const w = lastLaunchWarning
  lastLaunchWarning = null
  return w
}

function describeError(e: unknown): string {
  if (e && typeof e === 'object') {
    const err = e as { code?: string; message?: string; errno?: number; syscall?: string }
    return `${err.code ?? ''} ${err.syscall ?? ''} ${err.message ?? String(e)}`.trim()
  }
  return String(e)
}

function prepareLaunchExecutable(
  profileId: string,
  profileDir: string,
  chromiumPath: string,
): string {
  if (process.platform !== 'win32') return chromiumPath

  const srcAppDir = dirname(chromiumPath)
  const exeBase = basename(chromiumPath)
  const ext = exeBase.toLowerCase().endsWith('.exe') ? '.exe' : ''
  const exeStem = ext ? exeBase.slice(0, -ext.length) : exeBase
  const renamedExe = `${exeStem}-${shortId(profileId)}${ext}`

  const destAppDir = join(profileDir, 'chrome-app')
  const renamedExePath = join(destAppDir, renamedExe)

  logLaunch(`prepare profile=${profileId} chromium=${chromiumPath} dest=${renamedExePath}`)

  if (existsSync(destAppDir)) {
    try {
      const st = lstatSync(destAppDir)
      if (st.isSymbolicLink()) {
        logLaunch(`removing old junction at ${destAppDir}`)
        rmSync(destAppDir, { recursive: true, force: true })
      }
    } catch (e) {
      logLaunch(`lstat ${destAppDir} failed: ${describeError(e)}`)
    }
  }

  if (existsSync(renamedExePath)) {
    logLaunch(`reuse existing renamed exe ${renamedExePath}`)
    return renamedExePath
  }

  try {
    mkdirSync(destAppDir, { recursive: true })
  } catch (e) {
    const msg = `mkdir ${destAppDir} failed: ${describeError(e)}`
    logLaunch(msg)
    lastLaunchWarning = msg
    return chromiumPath
  }

  try {
    linkSync(chromiumPath, renamedExePath)
    logLaunch(`hardlinked ${chromiumPath} -> ${renamedExePath}`)
  } catch (linkErr) {
    logLaunch(`linkSync chrome.exe failed: ${describeError(linkErr)}; trying copyFileSync`)
    try {
      copyFileSync(chromiumPath, renamedExePath)
      logLaunch(`copyFileSync ${renamedExePath} ok`)
    } catch (copyErr) {
      const msg = `unable to materialize ${renamedExe}: link=${describeError(linkErr)} copy=${describeError(copyErr)}`
      logLaunch(msg)
      lastLaunchWarning = msg
      return chromiumPath
    }
  }

  try {
    mirrorChromeAppDir(srcAppDir, destAppDir, [exeBase, renamedExe])
    logLaunch(`mirror complete for ${destAppDir}`)
  } catch (e) {
    logLaunch(`mirror error (continuing): ${describeError(e)}`)
  }

  if (!existsSync(renamedExePath)) {
    const msg = `renamed exe missing after mirror: ${renamedExePath}`
    logLaunch(msg)
    lastLaunchWarning = msg
    return chromiumPath
  }

  return renamedExePath
}

async function resolveProxyServer(
  proxy: ProxyRecord | null,
): Promise<{ server: string | null; anonymizedUrl: string | null }> {
  if (!proxy) return { server: null, anonymizedUrl: null }

  const scheme = proxy.type === 'socks5' ? 'socks5' : proxy.type === 'https' ? 'https' : 'http'

  if (proxy.type === 'socks5') {
    return { server: `${scheme}://${proxy.host}:${proxy.port}`, anonymizedUrl: null }
  }

  if (proxy.username) {
    const auth = `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? '')}`
    const upstream = `${scheme}://${auth}@${proxy.host}:${proxy.port}`
    const localUrl = await anonymizeProxy(upstream)
    return { server: localUrl, anonymizedUrl: localUrl }
  }

  return { server: `${scheme}://${proxy.host}:${proxy.port}`, anonymizedUrl: null }
}

export interface LaunchResult {
  pid: number
  warning?: string
}

export async function launchProfile(profile: ProfileRecord): Promise<LaunchResult> {
  if (running.has(profile.id)) {
    const existing = running.get(profile.id)!
    return { pid: existing.pid }
  }

  const settings = getSettings()
  const chromium = findChromium(settings.chromiumPath)
  if (!chromium) {
    throw new Error(
      'No Chromium-based browser found. Install Google Chrome / Edge / Brave / Chromium, or set the path in Settings.',
    )
  }

  const root = profilesRoot()
  const profileDir = join(root, profile.id)
  const userDataDir = join(profileDir, 'user-data')
  const extensionDir = join(profileDir, 'extension')
  mkdirSync(userDataDir, { recursive: true })

  const proxy = profile.proxyId ? getProxy(profile.proxyId) : null
  buildFingerprintExtension(extensionDir, profile.fingerprint, proxy, profile.id, profile.name)

  const { server, anonymizedUrl } = await resolveProxyServer(proxy)

  const launchExe = prepareLaunchExecutable(profile.id, profileDir, chromium)
  const warning = takeLastLaunchWarning() ?? undefined

  const isDefaultUrl = !profile.startUrl || profile.startUrl === DEFAULT_START_URL
  const startUrl: string = isDefaultUrl
    ? generateWelcomePage(profileDir, profile.name)
    : (profile.startUrl ?? DEFAULT_START_URL)

  const args = buildArgs(profile, userDataDir, extensionDir, server, startUrl)
  const child = spawn(launchExe, args, { detached: false, stdio: 'ignore' })

  if (!child.pid) {
    if (anonymizedUrl) {
      void closeAnonymizedProxy(anonymizedUrl, true).catch(() => {})
    }
    throw new Error('Failed to launch browser process')
  }

  const info: RunningProfile = {
    id: profile.id,
    child,
    pid: child.pid,
    extensionDir,
    anonymizedProxyUrl: anonymizedUrl,
  }
  running.set(profile.id, info)
  emitStatus(profile.id, true, child.pid)

  child.on('exit', () => {
    if (running.get(profile.id)?.child === child) {
      running.delete(profile.id)
      emitStatus(profile.id, false)
    }
    if (anonymizedUrl) {
      void closeAnonymizedProxy(anonymizedUrl, true).catch(() => {})
    }
  })

  return warning ? { pid: child.pid, warning } : { pid: child.pid }
}

export function stopProfile(id: string): void {
  const info = running.get(id)
  if (!info) return
  try {
    info.child.kill()
  } catch (_e) {
    // ignore
  }
  if (info.anonymizedProxyUrl) {
    void closeAnonymizedProxy(info.anonymizedProxyUrl, true).catch(() => {})
  }
  running.delete(id)
  emitStatus(id, false)
}

export function deleteProfileData(id: string): void {
  stopProfile(id)
  const dir = join(profilesRoot(), id)
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}
