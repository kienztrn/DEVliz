import type { CreateProxyInput } from '../repositories/proxy-repo'
import { createProxy, listProxies } from '../repositories/proxy-repo'

/**
 * Accepts lines like:
 *   host:port
 *   host:port:user:pass
 *   socks5://user:pass@host:port
 *   http://host:port
 *   user:pass@host:port
 */
export function importProxiesFromText(text: string): { added: number; skipped: number } {
  const existing = new Set(listProxies().map((p) => `${p.type}://${p.host}:${p.port}`))
  let added = 0
  let skipped = 0

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const parsed = parseProxyLine(line)
    if (!parsed) {
      skipped++
      continue
    }
    const dedupKey = `${parsed.type}://${parsed.host}:${parsed.port}`
    if (existing.has(dedupKey)) {
      skipped++
      continue
    }
    createProxy(parsed)
    existing.add(dedupKey)
    added++
  }
  return { added, skipped }
}

function parseProxyLine(line: string): CreateProxyInput | null {
  let raw = line
  let type: CreateProxyInput['type'] = 'http'
  const protoMatch = raw.match(/^(http|https|socks5):\/\//i)
  if (protoMatch) {
    type = protoMatch[1].toLowerCase() as CreateProxyInput['type']
    raw = raw.slice(protoMatch[0].length)
  }

  const validHostPort = (h: string, p: number): boolean =>
    !!h && Number.isFinite(p) && p >= 1 && p <= 65535

  const build = (
    host: string,
    port: number,
    username?: string,
    password?: string,
  ): CreateProxyInput => ({ name: `${host}:${port}`, type, host, port, username, password })

  // Try URL-style first when `@` is present (user:pass@host:port).
  // Split at the LAST `@` so passwords containing `@` are preserved.
  // If the part after `@` is not a valid host:port, fall through to the
  // colon-only format below — handles `host:port:user:p@ss` correctly.
  if (raw.includes('@')) {
    const atIdx = raw.lastIndexOf('@')
    const auth = raw.slice(0, atIdx)
    const hostPart = raw.slice(atIdx + 1)
    const hostParts = hostPart.split(':')
    if (hostParts.length === 2) {
      const [host, portStr] = hostParts
      const port = Number(portStr)
      if (validHostPort(host, port)) {
        let username: string | undefined
        let password: string | undefined
        const colonIdx = auth.indexOf(':')
        if (colonIdx > 0) {
          username = auth.slice(0, colonIdx)
          password = auth.slice(colonIdx + 1)
        } else if (auth) {
          username = auth
        }
        return build(host, port, username, password)
      }
    }
    // fall through — likely host:port:user:pass with `@` in password
  }

  // Colon-only format. Slice manually instead of `split(':')` so the password
  // can legitimately contain `:` or `@`.
  const firstColon = raw.indexOf(':')
  if (firstColon <= 0) return null
  const host = raw.slice(0, firstColon)
  const afterHost = raw.slice(firstColon + 1)

  const secondColon = afterHost.indexOf(':')
  if (secondColon < 0) {
    // host:port
    const port = Number(afterHost)
    if (!validHostPort(host, port)) return null
    return build(host, port)
  }

  const portStr = afterHost.slice(0, secondColon)
  const port = Number(portStr)
  if (!validHostPort(host, port)) return null

  const userPass = afterHost.slice(secondColon + 1)
  if (!userPass) return build(host, port)

  const userColon = userPass.indexOf(':')
  if (userColon <= 0) {
    // host:port:user (no password)
    return build(host, port, userPass)
  }
  const username = userPass.slice(0, userColon)
  const password = userPass.slice(userColon + 1)
  return build(host, port, username, password)
}
