import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers } from 'lucide-react'
import toast from 'react-hot-toast'
import type { BulkCreateOptions } from '@shared/types'
import { LOCALES, TIMEZONES } from '@shared/fingerprint-pool'
import { useAppStore } from '../store'

const OS_OPTIONS: Array<'win' | 'mac' | 'linux'> = ['win', 'mac', 'linux']

export default function BulkCreate(): JSX.Element {
  const { t } = useTranslation()
  const proxies = useAppStore((s) => s.proxies)
  const refreshProfiles = useAppStore((s) => s.refreshProfiles)

  const [count, setCount] = useState(10)
  const [baseName, setBaseName] = useState('Profile')
  const [groupName, setGroupName] = useState('')
  const [startUrl, setStartUrl] = useState('')
  const [osMix, setOsMix] = useState<Array<'win' | 'mac' | 'linux'>>(['win'])
  const [localePool, setLocalePool] = useState<string[]>(['vi-VN', 'en-US'])
  const [timezonePool, setTimezonePool] = useState<string[]>(['Asia/Ho_Chi_Minh'])
  const [proxyAssignment, setProxyAssignment] =
    useState<BulkCreateOptions['proxyAssignment']>('none')
  const [selectedProxies, setSelectedProxies] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const toggle = <T,>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (count < 1 || count > 1000) {
      toast.error(t('errors.countRange'))
      return
    }
    if (!baseName.trim()) {
      toast.error(t('errors.nameRequired'))
      return
    }
    setBusy(true)
    try {
      const result = await window.mbm.profile.bulkCreate({
        count,
        baseName: baseName.trim(),
        groupName: groupName.trim() || undefined,
        osMix: osMix.length ? osMix : ['win'],
        localePool,
        timezonePool,
        startUrl: startUrl.trim() || undefined,
        proxyAssignment,
        proxyIds: selectedProxies,
      })
      await refreshProfiles()
      toast.success(t('bulk.success', { count: result.length }))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Layers className="h-6 w-6" />
          {t('bulk.title')}
        </h1>
      </div>

      <form onSubmit={submit} className="card p-5 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">{t('bulk.count')}</label>
            <input
              className="input"
              type="number"
              min={1}
              max={1000}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </div>
          <div className="col-span-2">
            <label className="label">{t('bulk.baseName')}</label>
            <input
              className="input"
              value={baseName}
              onChange={(e) => setBaseName(e.target.value)}
            />
            <p className="text-[11px] text-slate-500 mt-1">
              {t('bulk.baseNameHelp').replace('{baseName}', baseName || 'Profile')}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
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
          <div>
            <label className="label">
              {t('profiles.startUrl')}{' '}
              <span className="text-slate-400">({t('common.optional')})</span>
            </label>
            <input
              className="input"
              placeholder="https://..."
              value={startUrl}
              onChange={(e) => setStartUrl(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label">{t('bulk.osMix')}</label>
          <div className="flex gap-2">
            {OS_OPTIONS.map((os) => (
              <label
                key={os}
                className={
                  osMix.includes(os)
                    ? 'badge bg-brand-100 text-brand-700 cursor-pointer px-3 py-1'
                    : 'badge bg-slate-100 text-slate-600 cursor-pointer px-3 py-1'
                }
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={osMix.includes(os)}
                  onChange={() => setOsMix(toggle(osMix, os))}
                />
                {os}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label">{t('bulk.localePool')}</label>
          <div className="flex flex-wrap gap-1.5">
            {LOCALES.map((loc) => (
              <label
                key={loc}
                className={
                  localePool.includes(loc)
                    ? 'badge bg-brand-100 text-brand-700 cursor-pointer'
                    : 'badge bg-slate-100 text-slate-600 cursor-pointer'
                }
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={localePool.includes(loc)}
                  onChange={() => setLocalePool(toggle(localePool, loc))}
                />
                {loc}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label">{t('bulk.timezonePool')}</label>
          <div className="flex flex-wrap gap-1.5">
            {TIMEZONES.map((tz) => (
              <label
                key={tz}
                className={
                  timezonePool.includes(tz)
                    ? 'badge bg-brand-100 text-brand-700 cursor-pointer'
                    : 'badge bg-slate-100 text-slate-600 cursor-pointer'
                }
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={timezonePool.includes(tz)}
                  onChange={() => setTimezonePool(toggle(timezonePool, tz))}
                />
                {tz}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label">{t('bulk.proxyAssignment')}</label>
          <select
            className="input max-w-sm"
            value={proxyAssignment}
            onChange={(e) =>
              setProxyAssignment(e.target.value as BulkCreateOptions['proxyAssignment'])
            }
          >
            <option value="none">{t('bulk.proxyAssignmentNone')}</option>
            <option value="round-robin">{t('bulk.proxyAssignmentRR')}</option>
            <option value="random">{t('bulk.proxyAssignmentRand')}</option>
          </select>
        </div>

        {proxyAssignment !== 'none' && (
          <div>
            <label className="label">{t('bulk.selectProxies')}</label>
            <div className="card max-h-40 overflow-auto p-2 space-y-1">
              {proxies.length === 0 ? (
                <div className="p-2 text-xs text-slate-500">{t('proxies.empty')}</div>
              ) : (
                proxies.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedProxies.includes(p.id)}
                      onChange={() => setSelectedProxies(toggle(selectedProxies, p.id))}
                    />
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-slate-500">
                      ({p.type}) {p.host}:{p.port}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={busy}>
            <Layers className="h-4 w-4" />
            {t('bulk.submit', { count })}
          </button>
        </div>
      </form>
    </div>
  )
}
