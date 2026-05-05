export type ProxyType = 'http' | 'https' | 'socks5'

export interface ProxyRecord {
  id: string
  name: string
  type: ProxyType
  host: string
  port: number
  username?: string | null
  password?: string | null
  notes?: string | null
  lastIp?: string | null
  lastCountry?: string | null
  lastCheckedAt?: number | null
  createdAt: number
  updatedAt: number
}

export interface FingerprintConfig {
  os: 'win' | 'mac' | 'linux' | 'android' | 'ios'
  userAgent: string
  acceptLanguage: string
  locale: string
  timezone: string
  screen: {
    width: number
    height: number
    colorDepth: number
    pixelRatio: number
  }
  platform: string
  hardwareConcurrency: number
  deviceMemory: number
  webgl: {
    vendor: string
    renderer: string
    noise: number
  }
  canvasNoise: number
  audioNoise: number
  webrtcMode: 'disabled' | 'proxy-only' | 'real'
}

export interface ProfileRecord {
  id: string
  name: string
  groupName?: string | null
  notes?: string | null
  proxyId?: string | null
  fingerprint: FingerprintConfig
  startUrl?: string | null
  cookieJar?: string | null
  status: 'idle' | 'running'
  lastLaunchedAt?: number | null
  createdAt: number
  updatedAt: number
}

export interface BulkCreateOptions {
  count: number
  baseName: string
  groupName?: string
  osMix: Array<'win' | 'mac' | 'linux'>
  localePool: string[]
  timezonePool: string[]
  startUrl?: string
  proxyAssignment: 'none' | 'round-robin' | 'random'
  proxyIds?: string[]
}

export interface ProxyTestResult {
  success: boolean
  ip?: string
  country?: string
  countryCode?: string
  city?: string
  latencyMs?: number
  error?: string
}

export interface AppSettings {
  language: 'vi' | 'en'
  theme: 'light' | 'dark' | 'system'
  chromiumPath?: string | null
  profilesDir?: string | null
}
