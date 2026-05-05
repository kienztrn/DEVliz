import { create } from 'zustand'
import type { MailStatusDto } from '@shared/ipc'
import type { AppSettings, ProfileRecord, ProxyRecord } from '@shared/types'

interface AppStore {
  profiles: ProfileRecord[]
  proxies: ProxyRecord[]
  runningIds: Set<string>
  mailStatuses: Record<string, MailStatusDto>
  settings: AppSettings | null
  loading: boolean

  init(): Promise<void>
  refreshProfiles(): Promise<void>
  refreshProxies(): Promise<void>
  refreshSettings(): Promise<void>
  setRunning(id: string, running: boolean): void
}

export const useAppStore = create<AppStore>((set, get) => ({
  profiles: [],
  proxies: [],
  runningIds: new Set<string>(),
  mailStatuses: {},
  settings: null,
  loading: true,

  async init() {
    await Promise.all([get().refreshProfiles(), get().refreshProxies(), get().refreshSettings()])
    const status = await window.mbm.runtime.status()
    const ids = new Set<string>()
    for (const [id, info] of Object.entries(status)) if (info.running) ids.add(id)
    const mailStatuses = await window.mbm.mail.list().catch(() => ({}))
    set({ runningIds: ids, mailStatuses, loading: false })

    window.mbm.runtime.onStatusEvent((id, running) => {
      const next = new Set(get().runningIds)
      if (running) next.add(id)
      else next.delete(id)
      set({ runningIds: next })
    })

    window.mbm.mail.onUpdate((status) => {
      const next = { ...get().mailStatuses, [status.profileId]: status }
      set({ mailStatuses: next })
    })
  },

  async refreshProfiles() {
    const profiles = await window.mbm.profile.list()
    set({ profiles })
  },

  async refreshProxies() {
    const proxies = await window.mbm.proxy.list()
    set({ proxies })
  },

  async refreshSettings() {
    const settings = await window.mbm.settings.get()
    set({ settings })
  },

  setRunning(id, running) {
    const next = new Set(get().runningIds)
    if (running) next.add(id)
    else next.delete(id)
    set({ runningIds: next })
  },
}))
