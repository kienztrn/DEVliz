import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '@shared/ipc'
import type { BridgeApi, ProfileCreateInput, ProxyCreateInput } from '@shared/ipc'
import type {
  AppSettings,
  BulkCreateOptions,
  FingerprintConfig,
  ProfileRecord,
  ProxyRecord,
} from '@shared/types'

const api: BridgeApi = {
  profile: {
    list: () => ipcRenderer.invoke(IpcChannels.ProfileList),
    get: (id) => ipcRenderer.invoke(IpcChannels.ProfileGet, id),
    create: (input: ProfileCreateInput) => ipcRenderer.invoke(IpcChannels.ProfileCreate, input),
    bulkCreate: (options: BulkCreateOptions) =>
      ipcRenderer.invoke(IpcChannels.ProfileBulkCreate, options),
    update: (id, patch: Partial<ProfileRecord>) =>
      ipcRenderer.invoke(IpcChannels.ProfileUpdate, id, patch),
    delete: (id) => ipcRenderer.invoke(IpcChannels.ProfileDelete, id),
    clone: (id, name) => ipcRenderer.invoke(IpcChannels.ProfileClone, id, name),
    launch: (id) => ipcRenderer.invoke(IpcChannels.ProfileLaunch, id),
    stop: (id) => ipcRenderer.invoke(IpcChannels.ProfileStop, id),
    launchMany: (ids) => ipcRenderer.invoke(IpcChannels.ProfileLaunchMany, ids),
    stopMany: (ids) => ipcRenderer.invoke(IpcChannels.ProfileStopMany, ids),
  },
  proxy: {
    list: () => ipcRenderer.invoke(IpcChannels.ProxyList),
    create: (input: ProxyCreateInput) => ipcRenderer.invoke(IpcChannels.ProxyCreate, input),
    update: (id, patch: Partial<ProxyRecord>) =>
      ipcRenderer.invoke(IpcChannels.ProxyUpdate, id, patch),
    delete: (id) => ipcRenderer.invoke(IpcChannels.ProxyDelete, id),
    test: (id) => ipcRenderer.invoke(IpcChannels.ProxyTest, id),
    import: (text) => ipcRenderer.invoke(IpcChannels.ProxyImport, text),
  },
  fingerprint: {
    random: (os?: FingerprintConfig['os']) => ipcRenderer.invoke(IpcChannels.FingerprintRandom, os),
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.SettingsGet),
    update: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IpcChannels.SettingsUpdate, patch),
  },
  runtime: {
    status: () => ipcRenderer.invoke(IpcChannels.RuntimeStatus),
    onStatusEvent: (cb) => {
      const handler = (_e: unknown, id: string, running: boolean, pid?: number): void =>
        cb(id, running, pid)
      ipcRenderer.on(IpcChannels.RuntimeStatusEvent, handler)
      return () => ipcRenderer.removeListener(IpcChannels.RuntimeStatusEvent, handler)
    },
  },
}

contextBridge.exposeInMainWorld('mbm', api)
