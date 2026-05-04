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

  let username: string | undefined
  let password: string | undefined

  if (raw.includes('@')) {
    const [auth, hostPart] = raw.split('@')
    if (auth.includes(':')) {
      const [u, ...rest] = auth.split(':')
      username = u
      password = rest.join(':')
    }
    raw = hostPart
  }

  const parts = raw.split(':')
  if (parts.length === 2) {
    const [host, portStr] = parts
    const port = Number(portStr)
    if (!host || !Number.isFinite(port) || port < 1 || port > 65535) return null
    return { name: `${host}:${port}`, type, host, port, username, password }
  }
  if (parts.length === 4) {
    const [host, portStr, u, p] = parts
    const port = Number(portStr)
    if (!host || !Number.isFinite(port) || port < 1 || port > 65535) return null
    return { name: `${host}:${port}`, type, host, port, username: u, password: p }
  }
  return null
}
