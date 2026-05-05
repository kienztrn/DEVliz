import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Shuffle } from 'lucide-react'
import toast from 'react-hot-toast'
import type { FingerprintConfig, ProfileRecord } from '@shared/types'
import { useAppStore } from '../store'

interface Props {
  initial?: ProfileRecord
  onDone(): void | Promise<void>
}

const OS_OPTIONS: FingerprintConfig['os'][] = ['win', 'mac', 'linux', 'android', 'ios']
const WEBRTC_OPTIONS: FingerprintConfig['webrtcMode'][] = ['disabled', 'proxy-only', 'real']

export default function ProfileForm({ initial, onDone }: Props): JSX.Element {
  const { t } = useTranslation()
  const proxies = useAppStore((s) => s.proxies)

  const [name, setName] = useState(initial?.name ?? '')
  const [groupName, setGroupName] = useState(initial?.groupName ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [proxyId, setProxyId] = useState<string | ''>(initial?.proxyId ?? '')
  const [startUrl, setStartUrl] = useState(initial?.startUrl ?? '')
  const [fp, setFp] = useState<FingerprintConfig | null>(initial?.fingerprint ?? null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!fp) {
      void window.mbm.fingerprint.random('win').then(setFp)
    }
  }, [fp])

  const randomize = async (os: FingerprintConfig['os']): Promise<void> => {
    const next = await window.mbm.fingerprint.random(os)
    setFp(next)
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!name.trim()) {
      toast.error(t('errors.nameRequired'))
      return
    }
    if (!fp) return
    setBusy(true)
    try {
      if (initial) {
        await window.mbm.profile.update(initial.id, {
          name: name.trim(),
          groupName: groupName.trim() || null,
          notes: notes.trim() || null,
          proxyId: proxyId || null,
          startUrl: startUrl.trim() || null,
          fingerprint: fp,
        })
      } else {
        await window.mbm.profile.create({
          name: name.trim(),
          groupName: groupName.trim() || undefined,
          notes: notes.trim() || undefined,
          proxyId: proxyId || null,
          startUrl: startUrl.trim() || undefined,
          fingerprint: fp,
        })
      }
      toast.success('Saved')
      await onDone()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!fp) return <div className="text-sm text-slate-500">Loading...</div>

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">{t('common.name')}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">
            {t('common.group')} <span className="text-slate-400">({t('common.optional')})</span>
          </label>
          <input
            className="input"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">{t('profiles.proxy')}</label>
          <select className="input" value={proxyId} onChange={(e) => setProxyId(e.target.value)}>
            <option value="">{t('profiles.none')}</option>
            {proxies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.type}) — {p.host}:{p.port}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('profiles.startUrl')}</label>
          <input
            className="input"
            placeholder="https://..."
            value={startUrl}
            onChange={(e) => setStartUrl(e.target.value)}
          />
        </div>
      </div>

      <div className="card p-3 space-y-3 bg-slate-50">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">{t('profiles.fingerprint')}</h3>
          <button type="button" onClick={() => randomize(fp.os)} className="btn-ghost text-xs">
            <Shuffle className="h-3.5 w-3.5" /> {t('profiles.randomize')}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">{t('profiles.os')}</label>
            <select
              className="input"
              value={fp.os}
              onChange={(e) => void randomize(e.target.value as FingerprintConfig['os'])}
            >
              {OS_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t('profiles.locale')}</label>
            <input
              className="input"
              value={fp.locale}
              onChange={(e) => setFp({ ...fp, locale: e.target.value })}
            />
          </div>
          <div>
            <label className="label">{t('profiles.timezone')}</label>
            <input
              className="input"
              value={fp.timezone}
              onChange={(e) => setFp({ ...fp, timezone: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="label">{t('profiles.userAgent')}</label>
          <input
            className="input font-mono text-xs"
            value={fp.userAgent}
            onChange={(e) => setFp({ ...fp, userAgent: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">{t('profiles.screen')}</label>
            <div className="flex gap-1">
              <input
                className="input"
                type="number"
                value={fp.screen.width}
                onChange={(e) =>
                  setFp({ ...fp, screen: { ...fp.screen, width: Number(e.target.value) } })
                }
              />
              <input
                className="input"
                type="number"
                value={fp.screen.height}
                onChange={(e) =>
                  setFp({ ...fp, screen: { ...fp.screen, height: Number(e.target.value) } })
                }
              />
            </div>
          </div>
          <div>
            <label className="label">CPU / RAM</label>
            <div className="flex gap-1">
              <input
                className="input"
                type="number"
                value={fp.hardwareConcurrency}
                onChange={(e) => setFp({ ...fp, hardwareConcurrency: Number(e.target.value) })}
              />
              <input
                className="input"
                type="number"
                value={fp.deviceMemory}
                onChange={(e) => setFp({ ...fp, deviceMemory: Number(e.target.value) })}
              />
            </div>
          </div>
          <div>
            <label className="label">{t('profiles.webrtc')}</label>
            <select
              className="input"
              value={fp.webrtcMode}
              onChange={(e) =>
                setFp({ ...fp, webrtcMode: e.target.value as FingerprintConfig['webrtcMode'] })
              }
            >
              {WEBRTC_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">WebGL Vendor</label>
            <input
              className="input text-xs"
              value={fp.webgl.vendor}
              onChange={(e) => setFp({ ...fp, webgl: { ...fp.webgl, vendor: e.target.value } })}
            />
          </div>
          <div>
            <label className="label">WebGL Renderer</label>
            <input
              className="input text-xs"
              value={fp.webgl.renderer}
              onChange={(e) => setFp({ ...fp, webgl: { ...fp.webgl, renderer: e.target.value } })}
            />
          </div>
        </div>
      </div>

      <div>
        <label className="label">{t('common.notes')}</label>
        <textarea
          className="input min-h-[60px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {t('common.save')}
        </button>
      </div>
    </form>
  )
}
