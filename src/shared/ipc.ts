import type {
  AppSettings,
  BulkCreateOptions,
  FingerprintConfig,
  ProfileRecord,
  ProxyRecord,
  ProxyTestResult,
  ProxyType,
} from './types'

export const IpcChannels = {
  ProfileList: 'profile:list',
  ProfileGet: 'profile:get',
  ProfileCreate: 'profile:create',
  ProfileBulkCreate: 'profile:bulkCreate',
  ProfileUpdate: 'profile:update',
  ProfileDelete: 'profile:delete',
  ProfileClone: 'profile:clone',
  ProfileLaunch: 'profile:launch',
  ProfileStop: 'profile:stop',
  ProfileLaunchMany: 'profile:launchMany',
  ProfileStopMany: 'profile:stopMany',

  ProxyList: 'proxy:list',
  ProxyCreate: 'proxy:create',
  ProxyUpdate: 'proxy:update',
  ProxyDelete: 'proxy:delete',
  ProxyTest: 'proxy:test',
  ProxyImport: 'proxy:import',

  FingerprintRandom: 'fingerprint:random',

  SettingsGet: 'settings:get',
  SettingsUpdate: 'settings:update',

  RuntimeStatus: 'runtime:status',
  RuntimeStatusEvent: 'runtime:statusEvent',

  MailList: 'mail:list',
  MailUpdateEvent: 'mail:updateEvent',

  AutomationGmailRun: 'automation:gmailRun',
  AutomationProgressEvent: 'automation:progressEvent',

  SystemDetectBrowser: 'system:detectBrowser',
} as const

export type IpcChannelName = (typeof IpcChannels)[keyof typeof IpcChannels]

export interface ProfileCreateInput {
  name: string
  groupName?: string
  notes?: string
  proxyId?: string | null
  fingerprint?: Partial<FingerprintConfig> & { os?: FingerprintConfig['os'] }
  startUrl?: string
}

export interface ProxyCreateInput {
  name: string
  type: ProxyType
  host: string
  port: number
  username?: string
  password?: string
  notes?: string
}

export interface BridgeApi {
  profile: {
    list(): Promise<ProfileRecord[]>
    get(id: string): Promise<ProfileRecord | null>
    create(input: ProfileCreateInput): Promise<ProfileRecord>
    bulkCreate(options: BulkCreateOptions): Promise<ProfileRecord[]>
    update(id: string, patch: Partial<ProfileRecord>): Promise<ProfileRecord>
    delete(id: string): Promise<void>
    clone(id: string, name?: string): Promise<ProfileRecord>
    launch(id: string): Promise<{ pid: number; warning?: string }>
    stop(id: string): Promise<void>
    launchMany(
      ids: string[],
    ): Promise<Array<{ id: string; pid?: number; error?: string; warning?: string }>>
    stopMany(ids: string[]): Promise<void>
  }
  proxy: {
    list(): Promise<ProxyRecord[]>
    create(input: ProxyCreateInput): Promise<ProxyRecord>
    update(id: string, patch: Partial<ProxyRecord>): Promise<ProxyRecord>
    delete(id: string): Promise<void>
    test(id: string): Promise<ProxyTestResult>
    import(text: string): Promise<{ added: number; skipped: number }>
  }
  fingerprint: {
    random(os?: FingerprintConfig['os']): Promise<FingerprintConfig>
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  runtime: {
    status(): Promise<Record<string, { running: boolean; pid?: number }>>
    onStatusEvent(cb: (id: string, running: boolean, pid?: number) => void): () => void
  }
  mail: {
    list(): Promise<Record<string, MailStatusDto>>
    onUpdate(cb: (status: MailStatusDto) => void): () => void
  }
  automation: {
    gmailRun(profileIds: string[], options?: GmailRotateOptionsDto): Promise<GmailRunResultDto[]>
    onProgress(cb: (progress: AutomationProgressDto) => void): () => void
  }
  system: {
    detectBrowser(explicitPath?: string | null): Promise<DetectedBrowserDto>
  }
}

export interface DetectedBrowserDto {
  path: string | null
  brand: string | null
  source: 'explicit' | 'auto' | 'none'
}

export interface MailStatusDto {
  profileId: string
  unread: number
  email: string | null
  label: string | null
  updatedAt: number
}

export interface GmailRotateOptionsDto {
  maxItems?: number
  minOpenMs?: number
  maxOpenMs?: number
  minReadMs?: number
  maxReadMs?: number
}

export interface GmailRunResultDto {
  profileId: string
  commandId: string
  launched: boolean
  pid?: number
  error?: string
  warning?: string
}

export interface AutomationProgressDto {
  profileId: string
  commandId: string
  phase:
    | 'started'
    | 'opening'
    | 'reading'
    | 'done-item'
    | 'finished'
    | 'no-unread'
    | 'error'
    | 'dismiss-popup'
    | 'queued'
    | 'launching'
    | 'launched'
    | 'launch-failed'
  index?: number
  total?: number
  subject?: string
  message?: string
  ts: number
}
