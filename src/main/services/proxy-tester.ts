import { net, session as electronSession } from 'electron'
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
  const proxyScheme = proxy.type === 'socks5' ? 'socks5' : proxy.type === 'https' ? 'https' : 'http'
  const proxyUrl = `${proxyScheme}://${proxy.host}:${proxy.port}`

  const partition = `proxy-test-${proxy.id}-${Date.now()}`
  const sess = electronSession.fromPartition(partition, { cache: false })

  try {
    await sess.setProxy({ proxyRules: proxyUrl, proxyBypassRules: '<-loopback>' })
  } catch (e) {
    return { success: false, error: `setProxy: ${(e as Error).message}` }
  }

  return new Promise<ProxyTestResult>((resolve) => {
    let settled = false
    const finish = (result: ProxyTestResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }

    try {
      const request = net.request({
        method: 'GET',
        url: 'http://ip-api.com/json/?fields=status,message,country,countryCode,city,query',
        useSessionCookies: false,
        session: sess,
      })

      request.on('login', (authInfo, callback) => {
        if (authInfo.isProxy && proxy.username) {
          callback(proxy.username, proxy.password ?? '')
        } else {
          callback()
        }
      })

      let body = ''
      request.on('response', (res) => {
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8')
        })
        res.on('end', () => {
          const latencyMs = Date.now() - startedAt
          if (res.statusCode && res.statusCode >= 400) {
            finish({ success: false, latencyMs, error: `HTTP ${res.statusCode}` })
            return
          }
          try {
            const data = JSON.parse(body) as IpApiResponse
            if (data.status === 'success') {
              finish({
                success: true,
                ip: data.query,
                country: data.country,
                countryCode: data.countryCode,
                city: data.city,
                latencyMs,
              })
            } else {
              finish({ success: false, latencyMs, error: data.message || 'Unknown' })
            }
          } catch (e) {
            finish({ success: false, latencyMs, error: (e as Error).message })
          }
        })
      })
      request.on('error', (err) => {
        finish({ success: false, error: err.message })
      })
      request.setHeader('User-Agent', 'multi-browser-manager/0.1')
      request.end()

      setTimeout(() => {
        try {
          request.abort()
        } catch (_e) {
          // noop
        }
        finish({ success: false, error: 'Timeout' })
      }, 12_000)
    } catch (e) {
      finish({ success: false, error: (e as Error).message })
    }
  })
}
