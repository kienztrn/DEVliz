import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'

export interface MailStatus {
  profileId: string
  unread: number
  email: string | null
  label: string | null
  updatedAt: number
}

export interface AutomationCommand {
  id: string
  type: 'gmail-rotate-unread'
  profileId: string
  options?: {
    maxItems?: number
    minOpenMs?: number
    maxOpenMs?: number
    minReadMs?: number
    maxReadMs?: number
  }
  createdAt: number
}

export interface AutomationProgress {
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
  index?: number
  total?: number
  subject?: string
  message?: string
  ts: number
}

type MailListener = (status: MailStatus) => void
type AutomationListener = (progress: AutomationProgress) => void

const statuses = new Map<string, MailStatus>()
const listeners = new Set<MailListener>()
const automationListeners = new Set<AutomationListener>()
const pendingCommands = new Map<string, AutomationCommand[]>()
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

function emitProgress(progress: AutomationProgress): void {
  for (const l of automationListeners) {
    try {
      l(progress)
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

function handleCommandFetch(
  req: IncomingMessage,
  res: ServerResponse,
  profileId: string,
  token: string,
): void {
  if (token !== tokenFor(profileId)) {
    send(res, 403, 'forbidden')
    return
  }
  if (req.method !== 'GET') {
    send(res, 405, 'method not allowed')
    return
  }
  const queue = pendingCommands.get(profileId)
  const next = queue && queue.length ? queue.shift()! : null
  if (queue && queue.length === 0) pendingCommands.delete(profileId)
  send(res, 200, JSON.stringify({ command: next }), 'application/json')
}

async function handleAutomationProgress(
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
  let payload: Partial<AutomationProgress> & { commandId?: unknown; phase?: unknown }
  try {
    const body = await parseBody(req)
    payload = JSON.parse(body) as typeof payload
  } catch {
    send(res, 400, 'bad json')
    return
  }
  const phaseStr = String(payload.phase ?? '')
  const allowedPhases: AutomationProgress['phase'][] = [
    'started',
    'opening',
    'reading',
    'done-item',
    'finished',
    'no-unread',
    'error',
    'dismiss-popup',
  ]
  if (!(allowedPhases as string[]).includes(phaseStr)) {
    send(res, 400, 'bad phase')
    return
  }
  const progress: AutomationProgress = {
    profileId,
    commandId: typeof payload.commandId === 'string' ? payload.commandId.slice(0, 64) : '',
    phase: phaseStr as AutomationProgress['phase'],
    index: typeof payload.index === 'number' ? payload.index : undefined,
    total: typeof payload.total === 'number' ? payload.total : undefined,
    subject: typeof payload.subject === 'string' ? payload.subject.slice(0, 200) : undefined,
    message: typeof payload.message === 'string' ? payload.message.slice(0, 500) : undefined,
    ts: Date.now(),
  }
  emitProgress(progress)
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
  const cmd = url.match(/^\/api\/command\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9]{1,64})\b/)
  if (cmd) {
    handleCommandFetch(req, res, cmd[1], cmd[2])
    return
  }
  const prog = url.match(
    /^\/api\/automation-progress\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9]{1,64})\b/,
  )
  if (prog) {
    await handleAutomationProgress(req, res, prog[1], prog[2])
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

export function enqueueCommand(profileId: string, command: AutomationCommand): void {
  const queue = pendingCommands.get(profileId) ?? []
  queue.push(command)
  pendingCommands.set(profileId, queue)
}

export function onAutomationProgress(cb: AutomationListener): () => void {
  automationListeners.add(cb)
  return () => automationListeners.delete(cb)
}

export function clearCommandsFor(profileId: string): void {
  pendingCommands.delete(profileId)
}
