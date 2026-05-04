import type { AppSettings } from '@shared/types'
import { getDb } from '../db'

const DEFAULTS: AppSettings = {
  language: 'vi',
  theme: 'system',
  chromiumPath: null,
  profilesDir: null,
}

export function getSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as Array<{
    key: string
    value: string
  }>
  const map = new Map(rows.map((r) => [r.key, r.value]))
  return {
    language: (map.get('language') as AppSettings['language']) || DEFAULTS.language,
    theme: (map.get('theme') as AppSettings['theme']) || DEFAULTS.theme,
    chromiumPath: map.get('chromiumPath') || DEFAULTS.chromiumPath,
    profilesDir: map.get('profilesDir') || DEFAULTS.profilesDir,
  }
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const stmt = getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) continue
    stmt.run(key, String(value))
  }
  return getSettings()
}
