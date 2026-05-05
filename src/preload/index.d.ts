import type { BridgeApi } from '@shared/ipc'

declare global {
  interface Window {
    mbm: BridgeApi
  }
}

export {}
