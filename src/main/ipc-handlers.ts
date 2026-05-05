import { BrowserWindow, ipcMain } from 'electron'
import { IpcChannels, type ProfileCreateInput, type ProxyCreateInput } from '@shared/ipc'
import type {
  AppSettings,
  BulkCreateOptions,
  FingerprintConfig,
  ProfileRecord,
  ProxyRecord,
} from '@shared/types'
import { buildFingerprint } from '@shared/fingerprint-pool'
import {
  createProfile,
  deleteProfile,
  getProfile,
  listProfiles,
  setProfileStatus,
  updateProfile,
} from './repositories/profile-repo'
import {
  createProxy,
  deleteProxy,
  getProxy,
  listProxies,
  updateProxy,
} from './repositories/proxy-repo'
import { getSettings, updateSettings } from './repositories/settings-repo'
import {
  deleteProfileData,
  getRunningStatus,
  isRunning,
  launchProfile,
  onStatusChange,
  stopProfile,
} from './services/profile-launcher'
import { testProxy } from './services/proxy-tester'
import { importProxiesFromText } from './services/proxy-importer'

function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, ...args)
  }
}

export function registerIpcHandlers(): void {
  onStatusChange((id, running, pid) => {
    if (running) {
      setProfileStatus(id, 'running', Date.now())
    } else {
      setProfileStatus(id, 'idle')
    }
    broadcast(IpcChannels.RuntimeStatusEvent, id, running, pid)
  })

  ipcMain.handle(IpcChannels.ProfileList, () => listProfiles())
  ipcMain.handle(IpcChannels.ProfileGet, (_e, id: string) => getProfile(id))

  ipcMain.handle(IpcChannels.ProfileCreate, (_e, input: ProfileCreateInput) => {
    const fp = mergeFingerprint(input.fingerprint)
    return createProfile({
      name: input.name,
      groupName: input.groupName,
      notes: input.notes,
      proxyId: input.proxyId ?? null,
      fingerprint: fp,
      startUrl: input.startUrl,
    })
  })

  ipcMain.handle(IpcChannels.ProfileBulkCreate, (_e, options: BulkCreateOptions) => {
    const out: ProfileRecord[] = []
    const proxies = options.proxyIds ?? []
    for (let i = 0; i < options.count; i++) {
      const os = options.osMix[i % options.osMix.length] ?? 'win'
      const fp = buildFingerprint(os)
      if (options.localePool.length) {
        fp.locale = options.localePool[i % options.localePool.length]
        fp.acceptLanguage = `${fp.locale},${fp.locale.split('-')[0]};q=0.9,en;q=0.8`
      }
      if (options.timezonePool.length) {
        fp.timezone = options.timezonePool[i % options.timezonePool.length]
      }
      let proxyId: string | null = null
      if (options.proxyAssignment === 'round-robin' && proxies.length) {
        proxyId = proxies[i % proxies.length]
      } else if (options.proxyAssignment === 'random' && proxies.length) {
        proxyId = proxies[Math.floor(Math.random() * proxies.length)]
      }
      const created = createProfile({
        name: `${options.baseName}-${String(i + 1).padStart(3, '0')}`,
        groupName: options.groupName,
        proxyId,
        fingerprint: fp,
        startUrl: options.startUrl,
      })
      out.push(created)
    }
    return out
  })

  ipcMain.handle(IpcChannels.ProfileUpdate, (_e, id: string, patch: Partial<ProfileRecord>) =>
    updateProfile(id, patch),
  )

  ipcMain.handle(IpcChannels.ProfileDelete, (_e, id: string) => {
    deleteProfileData(id)
    deleteProfile(id)
  })

  ipcMain.handle(IpcChannels.ProfileClone, (_e, id: string, name?: string) => {
    const original = getProfile(id)
    if (!original) throw new Error('Profile not found')
    const fp = buildFingerprint(original.fingerprint.os)
    return createProfile({
      name: name || `${original.name} (copy)`,
      groupName: original.groupName,
      notes: original.notes,
      proxyId: original.proxyId,
      fingerprint: fp,
      startUrl: original.startUrl,
    })
  })

  ipcMain.handle(IpcChannels.ProfileLaunch, async (_e, id: string) => {
    const p = getProfile(id)
    if (!p) throw new Error('Profile not found')
    return launchProfile(p)
  })

  ipcMain.handle(IpcChannels.ProfileStop, (_e, id: string) => {
    stopProfile(id)
  })

  ipcMain.handle(IpcChannels.ProfileStopMany, (_e, ids: string[]) => {
    for (const id of ids) {
      try {
        stopProfile(id)
      } catch (_err) {
        // ignore individual failures so we still try the rest
      }
    }
  })

  ipcMain.handle(IpcChannels.ProfileLaunchMany, async (_e, ids: string[]) => {
    const results: Array<{ id: string; pid?: number; error?: string; warning?: string }> = []
    for (const id of ids) {
      try {
        const p = getProfile(id)
        if (!p) {
          results.push({ id, error: 'Not found' })
          continue
        }
        if (isRunning(id)) {
          results.push({ id })
          continue
        }
        const r = await launchProfile(p)
        results.push({ id, pid: r.pid, warning: r.warning })
        await new Promise((res) => setTimeout(res, 250))
      } catch (e) {
        results.push({ id, error: (e as Error).message })
      }
    }
    return results
  })

  ipcMain.handle(IpcChannels.ProxyList, () => listProxies())
  ipcMain.handle(IpcChannels.ProxyCreate, (_e, input: ProxyCreateInput) => createProxy(input))
  ipcMain.handle(IpcChannels.ProxyUpdate, (_e, id: string, patch: Partial<ProxyRecord>) =>
    updateProxy(id, patch),
  )
  ipcMain.handle(IpcChannels.ProxyDelete, (_e, id: string) => deleteProxy(id))
  ipcMain.handle(IpcChannels.ProxyTest, async (_e, id: string) => {
    const p = getProxy(id)
    if (!p) throw new Error('Proxy not found')
    const result = await testProxy(p)
    if (result.success) {
      updateProxy(id, {
        lastIp: result.ip ?? null,
        lastCountry: result.country ?? null,
        lastCheckedAt: Date.now(),
      })
    } else {
      updateProxy(id, { lastCheckedAt: Date.now() })
    }
    return result
  })
  ipcMain.handle(IpcChannels.ProxyImport, (_e, text: string) => importProxiesFromText(text))

  ipcMain.handle(IpcChannels.FingerprintRandom, (_e, os?: FingerprintConfig['os']) =>
    buildFingerprint(os ?? 'win'),
  )

  ipcMain.handle(IpcChannels.SettingsGet, () => getSettings())
  ipcMain.handle(IpcChannels.SettingsUpdate, (_e, patch: Partial<AppSettings>) =>
    updateSettings(patch),
  )

  ipcMain.handle(IpcChannels.RuntimeStatus, () => getRunningStatus())
}

function mergeFingerprint(partial: ProfileCreateInput['fingerprint']): FingerprintConfig {
  const base = buildFingerprint(partial?.os ?? 'win')
  if (!partial) return base
  return {
    ...base,
    ...partial,
    screen: { ...base.screen, ...(partial.screen ?? {}) },
    webgl: { ...base.webgl, ...(partial.webgl ?? {}) },
  }
}
