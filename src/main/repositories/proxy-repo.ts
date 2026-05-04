import { nanoid } from 'nanoid'
import type { ProxyRecord, ProxyType } from '@shared/types'
import { getDb } from '../db'

interface ProxyRow {
  id: string
  name: string
  type: ProxyType
  host: string
  port: number
  username: string | null
  password: string | null
  notes: string | null
  last_ip: string | null
  last_country: string | null
  last_checked_at: number | null
  created_at: number
  updated_at: number
}

function rowToProxy(r: ProxyRow): ProxyRecord {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    host: r.host,
    port: r.port,
    username: r.username,
    password: r.password,
    notes: r.notes,
    lastIp: r.last_ip,
    lastCountry: r.last_country,
    lastCheckedAt: r.last_checked_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function listProxies(): ProxyRecord[] {
  const rows = getDb().prepare('SELECT * FROM proxies ORDER BY created_at DESC').all() as ProxyRow[]
  return rows.map(rowToProxy)
}

export function getProxy(id: string): ProxyRecord | null {
  const row = getDb().prepare('SELECT * FROM proxies WHERE id = ?').get(id) as ProxyRow | undefined
  return row ? rowToProxy(row) : null
}

export interface CreateProxyInput {
  name: string
  type: ProxyType
  host: string
  port: number
  username?: string
  password?: string
  notes?: string
}

export function createProxy(input: CreateProxyInput): ProxyRecord {
  const now = Date.now()
  const id = nanoid(12)
  getDb()
    .prepare(
      `INSERT INTO proxies (id, name, type, host, port, username, password, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.type,
      input.host,
      input.port,
      input.username ?? null,
      input.password ?? null,
      input.notes ?? null,
      now,
      now,
    )
  return getProxy(id)!
}

export function updateProxy(id: string, patch: Partial<ProxyRecord>): ProxyRecord {
  const existing = getProxy(id)
  if (!existing) throw new Error(`Proxy ${id} not found`)
  const merged = { ...existing, ...patch, id, updatedAt: Date.now() }
  getDb()
    .prepare(
      `UPDATE proxies SET
         name = ?, type = ?, host = ?, port = ?, username = ?, password = ?, notes = ?,
         last_ip = ?, last_country = ?, last_checked_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      merged.name,
      merged.type,
      merged.host,
      merged.port,
      merged.username ?? null,
      merged.password ?? null,
      merged.notes ?? null,
      merged.lastIp ?? null,
      merged.lastCountry ?? null,
      merged.lastCheckedAt ?? null,
      merged.updatedAt,
      id,
    )
  return getProxy(id)!
}

export function deleteProxy(id: string): void {
  getDb().prepare('DELETE FROM proxies WHERE id = ?').run(id)
}
