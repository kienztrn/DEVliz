import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  const userData = app.getPath('userData')
  mkdirSync(userData, { recursive: true })
  const dbPath = join(userData, 'mbm.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS proxies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT,
      password TEXT,
      notes TEXT,
      last_ip TEXT,
      last_country TEXT,
      last_checked_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      group_name TEXT,
      notes TEXT,
      proxy_id TEXT REFERENCES proxies(id) ON DELETE SET NULL,
      fingerprint TEXT NOT NULL,
      start_url TEXT,
      cookie_jar TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      last_launched_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_profiles_group ON profiles(group_name);
    CREATE INDEX IF NOT EXISTS idx_profiles_proxy ON profiles(proxy_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}
