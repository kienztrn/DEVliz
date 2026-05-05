import { spawn, ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, symlinkSync, lstatSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
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

  args.push(profile.startUrl || DEFAULT_START_URL)

  return args
}

function prepareLaunchExecutable(profileDir: string, chromiumPath: string): string {
  if (process.platform !== 'win32') return chromiumPath

  try {
    const chromeAppDir = dirname(chromiumPath)
    const linkDir = join(profileDir, 'chrome-app')
    const linkExe = join(linkDir, basename(chromiumPath))

    if (existsSync(linkExe)) {
      try {
        if (lstatSync(linkDir).isSymbolicLink() || lstatSync(linkDir).isDirectory()) {
          return linkExe
        }
      } catch {
        // fall through and recreate
      }
    }

    if (existsSync(linkDir)) {
      rmSync(linkDir, { recursive: true, force: true })
    }
    symlinkSync(chromeAppDir, linkDir, 'junction')
    if (existsSync(linkExe)) return linkExe
    return chromiumPath
  } catch {
    return chromiumPath
  }
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
  buildFingerprintExtension(extensionDir, profile.fingerprint, proxy)

  const { server, anonymizedUrl } = await resolveProxyServer(proxy)

  const launchExe = prepareLaunchExecutable(profileDir, chromium)
  const args = buildArgs(profile, userDataDir, extensionDir, server)
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

  return { pid: child.pid }
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
