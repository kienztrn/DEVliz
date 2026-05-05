import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import type { ProxyRecord, ProxyType } from '@shared/types'

const TYPES: ProxyType[] = ['http', 'https', 'socks5']

interface Props {
  initial?: ProxyRecord
  onDone(created?: ProxyRecord): void | Promise<void>
}

export default function ProxyForm({ initial, onDone }: Props): JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<ProxyType>(initial?.type ?? 'http')
  const [host, setHost] = useState(initial?.host ?? '')
  const [port, setPort] = useState<number | ''>(initial?.port ?? '')
  const [username, setUsername] = useState(initial?.username ?? '')
  const [password, setPassword] = useState(initial?.password ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!host.trim()) {
      toast.error(t('errors.hostRequired'))
      return
    }
    const portNum = Number(port)
    if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
      toast.error(t('errors.portRange'))
      return
    }
    setBusy(true)
    try {
      let created: ProxyRecord | undefined
      if (initial) {
        created = await window.mbm.proxy.update(initial.id, {
          name: name.trim() || `${host}:${portNum}`,
          type,
          host: host.trim(),
          port: portNum,
          username: username || null,
          password: password || null,
          notes: notes || null,
        })
      } else {
        created = await window.mbm.proxy.create({
          name: name.trim() || `${host}:${portNum}`,
          type,
          host: host.trim(),
          port: portNum,
          username: username || undefined,
          password: password || undefined,
          notes: notes || undefined,
        })
      }
      toast.success('Saved')
      await onDone(created)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">{t('common.name')}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">{t('proxies.type')}</label>
          <select
            className="input"
            value={type}
            onChange={(e) => setType(e.target.value as ProxyType)}
          >
            {TYPES.map((tp) => (
              <option key={tp} value={tp}>
                {tp}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="label">{t('proxies.host')}</label>
          <input className="input" value={host} onChange={(e) => setHost(e.target.value)} />
        </div>
        <div>
          <label className="label">{t('proxies.port')}</label>
          <input
            className="input"
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">{t('proxies.username')}</label>
          <input
            className="input"
            value={username ?? ''}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('proxies.password')}</label>
          <input
            className="input"
            type="password"
            value={password ?? ''}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="label">{t('common.notes')}</label>
        <textarea
          className="input min-h-[60px]"
          value={notes ?? ''}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={busy}>
          {t('common.save')}
        </button>
      </div>
    </form>
  )
}
