import { nanoid } from 'nanoid'
import type { FingerprintConfig, ProfileRecord } from '@shared/types'
import { getDb } from '../db'

interface ProfileRow {
  id: string
  name: string
  group_name: string | null
  notes: string | null
  proxy_id: string | null
  fingerprint: string
  start_url: string | null
  cookie_jar: string | null
  status: 'idle' | 'running'
  last_launched_at: number | null
  created_at: number
  updated_at: number
}

function rowToProfile(r: ProfileRow): ProfileRecord {
  return {
    id: r.id,
    name: r.name,
    groupName: r.group_name,
    notes: r.notes,
    proxyId: r.proxy_id,
    fingerprint: JSON.parse(r.fingerprint) as FingerprintConfig,
    startUrl: r.start_url,
    cookieJar: r.cookie_jar,
    status: r.status,
    lastLaunchedAt: r.last_launched_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function listProfiles(): ProfileRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM profiles ORDER BY created_at DESC')
    .all() as ProfileRow[]
  return rows.map(rowToProfile)
}

export function getProfile(id: string): ProfileRecord | null {
  const row = getDb().prepare('SELECT * FROM profiles WHERE id = ?').get(id) as
    | ProfileRow
    | undefined
  return row ? rowToProfile(row) : null
}

export interface CreateProfileInput {
  name: string
  groupName?: string | null
  notes?: string | null
  proxyId?: string | null
  fingerprint: FingerprintConfig
  startUrl?: string | null
}

export function createProfile(input: CreateProfileInput): ProfileRecord {
  const now = Date.now()
  const id = nanoid(12)
  getDb()
    .prepare(
      `INSERT INTO profiles (id, name, group_name, notes, proxy_id, fingerprint, start_url, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.groupName ?? null,
      input.notes ?? null,
      input.proxyId ?? null,
      JSON.stringify(input.fingerprint),
      input.startUrl ?? null,
      now,
      now,
    )
  return getProfile(id)!
}

export function updateProfile(id: string, patch: Partial<ProfileRecord>): ProfileRecord {
  const existing = getProfile(id)
  if (!existing) throw new Error(`Profile ${id} not found`)
  const merged = { ...existing, ...patch, id, updatedAt: Date.now() }
  getDb()
    .prepare(
      `UPDATE profiles SET
         name = ?, group_name = ?, notes = ?, proxy_id = ?, fingerprint = ?,
         start_url = ?, cookie_jar = ?, status = ?, last_launched_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      merged.name,
      merged.groupName ?? null,
      merged.notes ?? null,
      merged.proxyId ?? null,
      JSON.stringify(merged.fingerprint),
      merged.startUrl ?? null,
      merged.cookieJar ?? null,
      merged.status,
      merged.lastLaunchedAt ?? null,
      merged.updatedAt,
      id,
    )
  return getProfile(id)!
}

export function deleteProfile(id: string): void {
  getDb().prepare('DELETE FROM profiles WHERE id = ?').run(id)
}

export function setProfileStatus(
  id: string,
  status: 'idle' | 'running',
  lastLaunchedAt?: number | null,
): void {
  const updateAt = Date.now()
  if (lastLaunchedAt !== undefined) {
    getDb()
      .prepare('UPDATE profiles SET status = ?, last_launched_at = ?, updated_at = ? WHERE id = ?')
      .run(status, lastLaunchedAt ?? null, updateAt, id)
  } else {
    getDb()
      .prepare('UPDATE profiles SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, updateAt, id)
  }
}
