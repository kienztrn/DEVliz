import { net } from 'electron'
import type { ProxyRecord, ProxyTestResult } from '@shared/types'

interface IpApiResponse {
  status?: string
  query?: string
  country?: string
  countryCode?: string
  city?: string
  message?: string
}

export async function testProxy(proxy: ProxyRecord): Promise<ProxyTestResult> {
  const startedAt = Date.now()
  return new Promise<ProxyTestResult>((resolve) => {
    try {
      const proxyScheme =
        proxy.type === 'socks5' ? 'socks5' : proxy.type === 'https' ? 'https' : 'http'
      const proxyUrl = `${proxyScheme}://${proxy.host}:${proxy.port}`

      const request = net.request({
        method: 'GET',
        url: 'http://ip-api.com/json/?fields=status,message,country,countryCode,city,query',
        useSessionCookies: false,
      })

      // electron net request supports proxy override
      // @ts-expect-error - typing for internal API
      request.session?.setProxy?.({ proxyRules: proxyUrl }).catch(() => undefined)

      let body = ''
      request.on('response', (res) => {
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8')
        })
        res.on('end', () => {
          const latencyMs = Date.now() - startedAt
          if (res.statusCode && res.statusCode >= 400) {
            resolve({ success: false, latencyMs, error: `HTTP ${res.statusCode}` })
            return
          }
          try {
            const data = JSON.parse(body) as IpApiResponse
            if (data.status === 'success') {
              resolve({
                success: true,
                ip: data.query,
                country: data.country,
                countryCode: data.countryCode,
                city: data.city,
                latencyMs,
              })
            } else {
              resolve({ success: false, latencyMs, error: data.message || 'Unknown' })
            }
          } catch (e) {
            resolve({ success: false, latencyMs, error: (e as Error).message })
          }
        })
      })
      request.on('error', (err) => {
        resolve({ success: false, error: err.message })
      })
      request.setHeader('User-Agent', 'multi-browser-manager/0.1')
      request.end()

      setTimeout(() => {
        try {
          request.abort()
        } catch (_e) {
          // noop
        }
        resolve({ success: false, error: 'Timeout' })
      }, 12_000)
    } catch (e) {
      resolve({ success: false, error: (e as Error).message })
    }
  })
}
