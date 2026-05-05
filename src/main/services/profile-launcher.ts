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
import { app } from 'electron'
import { anonymizeProxy, closeAnonymizedProxy } from 'proxy-chain'
import { DEFAULT_START_URL, type ProfileRecord, type ProxyRecord } from '@shared/types'
import { findChromium } from './chromium-finder'
import { buildFingerprintExtension } from './extension-builder'
import { buildProfileIco, colorForProfile } from './icon-builder'
import { applyWindowIdentity, aumidForProfile } from './window-identity'
import { getMailServerInfo } from './mail-server'
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
    // DisableLoadExtensionCommandLineSwitch is enabled by default in Chrome
    // 137+/138+ Stable (rolled out 2025-06). When enabled it silently strips
    // the --load-extension flag, so our fingerprint/automation extension
    // never gets loaded and chrome://extensions appears empty even though we
    // passed --load-extension. Disabling the feature restores the previous
    // behavior.
    '--disable-features=Translate,InterestFeedContentSuggestions,PrivacySandboxSettings4,OptimizationHints,DisableLoadExtensionCommandLineSwitch',
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

async function applyCustomIcon(exePath: string, icoPath: string): Promise<void> {
  if (process.platform !== 'win32') return
  try {
    const mod = (await import('rcedit')) as { rcedit: (e: string, o: object) => Promise<void> }
    await mod.rcedit(exePath, { icon: icoPath })
    logLaunch(`rcedit set-icon ok exe=${exePath} ico=${icoPath}`)
  } catch (e) {
    logLaunch(`rcedit set-icon failed: ${describeError(e)}`)
  }
}

async function prepareLaunchExecutable(
  profileId: string,
  profileDir: string,
  chromiumPath: string,
): Promise<string> {
  if (process.platform !== 'win32') return chromiumPath

  const srcAppDir = dirname(chromiumPath)
  const exeBase = basename(chromiumPath)
  const ext = exeBase.toLowerCase().endsWith('.exe') ? '.exe' : ''
  const exeStem = ext ? exeBase.slice(0, -ext.length) : exeBase
  const renamedExe = `${exeStem}-${shortId(profileId)}${ext}`

  const destAppDir = join(profileDir, 'chrome-app')
  const renamedExePath = join(destAppDir, renamedExe)
  const icoPath = join(destAppDir, 'profile.ico')

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

  let icoChanged = false
  try {
    if (!existsSync(destAppDir)) mkdirSync(destAppDir, { recursive: true })
    if (!existsSync(icoPath)) {
      const color = colorForProfile(profileId)
      writeFileSync(icoPath, buildProfileIco(color))
      icoChanged = true
      logLaunch(`generated ico ${icoPath} color=${color}`)
    }
  } catch (e) {
    logLaunch(`ico generate failed: ${describeError(e)}`)
  }

  if (existsSync(renamedExePath)) {
    if (icoChanged) {
      await applyCustomIcon(renamedExePath, icoPath)
    }
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
    copyFileSync(chromiumPath, renamedExePath)
    logLaunch(`copyFileSync chrome.exe -> ${renamedExePath} ok`)
  } catch (copyErr) {
    logLaunch(`copyFileSync chrome.exe failed: ${describeError(copyErr)}; trying linkSync`)
    try {
      linkSync(chromiumPath, renamedExePath)
      logLaunch(`hardlinked (fallback) ${chromiumPath} -> ${renamedExePath}`)
    } catch (linkErr) {
      const msg = `unable to materialize ${renamedExe}: copy=${describeError(copyErr)} link=${describeError(linkErr)}`
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

  if (existsSync(icoPath)) {
    await applyCustomIcon(renamedExePath, icoPath)
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

export interface LaunchOptions {
  startUrlOverride?: string
}

export async function launchProfile(
  profile: ProfileRecord,
  options: LaunchOptions = {},
): Promise<LaunchResult> {
  if (running.has(profile.id)) {
    const existing = running.get(profile.id)!
    return { pid: existing.pid }
  }

  const settings = getSettings()
  const chromium = findChromium(settings.chromiumPath)
  if (!chromium) {
    throw new Error(
      'No Chromium-based browser found. Install Brave / Vivaldi / ungoogled-chromium / Edge / Chrome, or set the path in Settings.',
    )
  }

  const root = profilesRoot()
  const profileDir = join(root, profile.id)
  const userDataDir = join(profileDir, 'user-data')
  const extensionDir = join(profileDir, 'extension')
  mkdirSync(userDataDir, { recursive: true })

  const proxy = profile.proxyId ? getProxy(profile.proxyId) : null
  const mailInfo = getMailServerInfo()
  const mailReport =
    mailInfo.port > 0 ? { port: mailInfo.port, token: mailInfo.tokenFor(profile.id) } : null
  buildFingerprintExtension(
    extensionDir,
    profile.fingerprint,
    proxy,
    profile.id,
    profile.name,
    mailReport,
  )

  const { server, anonymizedUrl } = await resolveProxyServer(proxy)

  const launchExe = await prepareLaunchExecutable(profile.id, profileDir, chromium)
  const warning = takeLastLaunchWarning() ?? undefined

  const startUrl: string = options.startUrlOverride || profile.startUrl || DEFAULT_START_URL

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

  if (process.platform === 'win32') {
    const icoPath = join(profileDir, 'chrome-app', 'profile.ico')
    if (existsSync(icoPath)) {
      applyWindowIdentity(child.pid, aumidForProfile(profile.id), icoPath)
      logLaunch(
        `spawned window-identity helper pid=${child.pid} aumid=${aumidForProfile(profile.id)}`,
      )
    }
  }

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
