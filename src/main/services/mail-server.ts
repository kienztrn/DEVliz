import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'

export interface MailStatus {
  profileId: string
  unread: number
  email: string | null
  label: string | null
  updatedAt: number
}

type MailListener = (status: MailStatus) => void

const statuses = new Map<string, MailStatus>()
const listeners = new Set<MailListener>()
let port = 0
let secret = ''

function emit(status: MailStatus): void {
  for (const l of listeners) {
    try {
      l(status)
    } catch {
      // ignore listener errors
    }
  }
}

function tokenFor(profileId: string): string {
  return createHash('sha256').update(`${secret}:${profileId}`).digest('hex').slice(0, 32)
}

function parseBody(req: IncomingMessage, limitBytes = 16 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > limitBytes) {
        req.destroy(new Error('payload too large'))
        return
      }
      data += chunk.toString('utf8')
    })
    req.on('end', () => resolve(data))
    req.on('error', (e) => reject(e))
  })
}

function send(res: ServerResponse, status: number, body: string, contentType = 'text/plain'): void {
  res.statusCode = status
  res.setHeader('content-type', contentType)
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS')
  res.end(body)
}

async function handleMailReport(
  req: IncomingMessage,
  res: ServerResponse,
  profileId: string,
  token: string,
): Promise<void> {
  if (token !== tokenFor(profileId)) {
    send(res, 403, 'forbidden')
    return
  }
  if (req.method !== 'POST') {
    send(res, 405, 'method not allowed')
    return
  }
  let payload: { unread?: unknown; email?: unknown; label?: unknown }
  try {
    const body = await parseBody(req)
    payload = JSON.parse(body) as typeof payload
  } catch {
    send(res, 400, 'bad json')
    return
  }
  const unread = Math.max(0, Math.min(99999, Number(payload.unread) || 0))
  const email = typeof payload.email === 'string' ? payload.email.slice(0, 320) : null
  const label = typeof payload.label === 'string' ? payload.label.slice(0, 64) : null
  const status: MailStatus = {
    profileId,
    unread,
    email,
    label,
    updatedAt: Date.now(),
  }
  statuses.set(profileId, status)
  emit(status)
  send(res, 200, JSON.stringify({ ok: true }), 'application/json')
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    send(res, 204, '')
    return
  }
  const url = req.url ?? ''
  if (url === '/api/health') {
    send(res, 200, 'ok')
    return
  }
  const m = url.match(/^\/api\/mail-report\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9]{1,64})\b/)
  if (m) {
    await handleMailReport(req, res, m[1], m[2])
    return
  }
  send(res, 404, 'not found')
}

let started = false
export async function startMailServer(): Promise<{ port: number; secret: string }> {
  if (started) return { port, secret }
  started = true
  secret = randomBytes(24).toString('hex')

  await new Promise<void>((resolve, reject) => {
    const server = createServer((req, res) => {
      void handleRequest(req, res).catch(() => {
        try {
          send(res, 500, 'server error')
        } catch {
          // ignore
        }
      })
    })
    server.on('error', (e) => reject(e))
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        port = addr.port
        resolve()
      } else {
        reject(new Error('failed to bind mail server'))
      }
    })
  })

  return { port, secret }
}

export function getMailServerInfo(): { port: number; tokenFor: (profileId: string) => string } {
  return { port, tokenFor }
}

export function getMailStatus(profileId: string): MailStatus | null {
  return statuses.get(profileId) ?? null
}

export function getAllMailStatuses(): Record<string, MailStatus> {
  const out: Record<string, MailStatus> = {}
  for (const [k, v] of statuses) out[k] = v
  return out
}

export function clearMailStatus(profileId: string): void {
  statuses.delete(profileId)
}

export function onMailUpdate(cb: MailListener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
