import { spawn, ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ProfileRecord, ProxyRecord } from '@shared/types'
import { findChromium } from './chromium-finder'
import { buildFingerprintExtension } from './extension-builder'
import { getSettings } from '../repositories/settings-repo'
import { getProxy } from '../repositories/proxy-repo'

interface RunningProfile {
  id: string
  child: ChildProcess
  pid: number
  extensionDir: string
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
  proxy: ProxyRecord | null,
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

  if (proxy) {
    const scheme = proxy.type === 'socks5' ? 'socks5' : proxy.type === 'https' ? 'https' : 'http'
    args.push(`--proxy-server=${scheme}://${proxy.host}:${proxy.port}`)
    args.push('--proxy-bypass-list=<-loopback>')
  }

  if (profile.startUrl) {
    args.push(profile.startUrl)
  } else {
    args.push('about:blank')
  }

  return args
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
  const userDataDir = join(root, profile.id, 'user-data')
  const extensionDir = join(root, profile.id, 'extension')
  mkdirSync(userDataDir, { recursive: true })

  const proxy = profile.proxyId ? getProxy(profile.proxyId) : null
  buildFingerprintExtension(extensionDir, profile.fingerprint, proxy)

  const args = buildArgs(profile, userDataDir, extensionDir, proxy)
  const child = spawn(chromium, args, { detached: false, stdio: 'ignore' })

  if (!child.pid) {
    throw new Error('Failed to launch browser process')
  }

  const info: RunningProfile = { id: profile.id, child, pid: child.pid, extensionDir }
  running.set(profile.id, info)
  emitStatus(profile.id, true, child.pid)

  child.on('exit', () => {
    running.delete(profile.id)
    emitStatus(profile.id, false)
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
