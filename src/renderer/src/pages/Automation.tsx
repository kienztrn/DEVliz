import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mail, Play, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import type { AutomationProgressDto } from '@shared/ipc'
import { useAppStore } from '../store'
import Modal from '../components/Modal'

interface LogEntry extends AutomationProgressDto {
  key: string
}

export default function Automation(): JSX.Element {
  const { t } = useTranslation()
  const profiles = useAppStore((s) => s.profiles)
  const runningIds = useAppStore((s) => s.runningIds)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<LogEntry[]>([])
  const [search, setSearch] = useState('')
  const logRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const off = window.mbm.automation.onProgress((progress) => {
      setLog((prev) => {
        const key = `${progress.profileId}:${progress.commandId}:${progress.ts}:${progress.phase}:${progress.index ?? 0}`
        const next = [...prev, { ...progress, key }]
        return next.length > 500 ? next.slice(next.length - 500) : next
      })
    })
    return () => {
      off()
    }
  }, [])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [log])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return profiles
    return profiles.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.groupName?.toLowerCase().includes(q) ?? false),
    )
  }, [profiles, search])

  const toggle = (id: string): void => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const allSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id))
  const toggleAll = (): void => {
    if (allSelected) {
      const next = new Set(selected)
      for (const p of filtered) next.delete(p.id)
      setSelected(next)
    } else {
      const next = new Set(selected)
      for (const p of filtered) next.add(p.id)
      setSelected(next)
    }
  }

  const handleRunClick = (): void => {
    if (selected.size === 0) {
      toast.error(t('automation.selectAtLeastOne'))
      return
    }
    setConfirmOpen(true)
  }

  const handleConfirm = async (): Promise<void> => {
    setConfirmOpen(false)
    setBusy(true)
    try {
      const ids = Array.from(selected)
      const results = await window.mbm.automation.gmailRun(ids)
      const launched = results.filter((r) => r.launched).length
      const errors = results.filter((r) => r.error).length
      if (errors > 0) {
        toast.error(t('automation.runWithErrors', { errors }))
      } else if (launched > 0) {
        toast.success(t('automation.runStartedLaunched', { count: launched }))
      } else {
        toast.success(t('automation.runStartedQueued', { count: results.length }))
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles])

  const phaseLabel = (phase: AutomationProgressDto['phase']): string => {
    return t(`automation.phase.${phase}`, { defaultValue: phase })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('automation.title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('automation.subtitle')}</p>
        </div>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-brand-50 p-2 text-brand-700">
            <Mail className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-slate-900">
              {t('automation.gmail.title')}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{t('automation.gmail.description')}</p>
          </div>
          <button
            onClick={handleRunClick}
            disabled={busy || selected.size === 0}
            className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            <Play className="h-4 w-4" />
            {t('automation.runButton')}
            {selected.size > 0 && ` (${selected.size})`}
          </button>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder={t('common.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-xs rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <button onClick={toggleAll} className="text-sm text-brand-600 hover:text-brand-700">
            {allSelected ? t('automation.deselectAll') : t('automation.selectAll')}
          </button>
          {selected.size > 0 && (
            <span className="text-sm text-slate-500">
              {t('profiles.selected', { count: selected.size })}
            </span>
          )}
        </div>

        <div className="rounded-md border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 w-10"></th>
                <th className="px-3 py-2">{t('common.name')}</th>
                <th className="px-3 py-2">{t('common.group')}</th>
                <th className="px-3 py-2">{t('common.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                    {t('profiles.empty')}
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-900">{p.name}</td>
                  <td className="px-3 py-2 text-slate-500">{p.groupName || '—'}</td>
                  <td className="px-3 py-2">
                    {runningIds.has(p.id) ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        ● {t('common.running')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        ○ {t('common.idle')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">{t('automation.logTitle')}</h2>
          <button
            onClick={() => setLog([])}
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('automation.clearLog')}
          </button>
        </div>
        <div
          ref={logRef}
          className="max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2 text-xs font-mono"
        >
          {log.length === 0 ? (
            <div className="text-slate-400 text-center py-6">{t('automation.logEmpty')}</div>
          ) : (
            log.map((entry) => {
              const profile = profileMap.get(entry.profileId)
              const isError = entry.phase === 'error' || entry.phase === 'launch-failed'
              return (
                <div key={entry.key} className={isError ? 'text-rose-600' : 'text-slate-700'}>
                  <span className="text-slate-400">{new Date(entry.ts).toLocaleTimeString()}</span>{' '}
                  <span className="font-semibold">[{profile?.name ?? entry.profileId}]</span>{' '}
                  <span>{phaseLabel(entry.phase)}</span>
                  {entry.index !== undefined && entry.total !== undefined && (
                    <span className="text-slate-400">
                      {' '}
                      ({entry.index}/{entry.total})
                    </span>
                  )}
                  {entry.subject && <span className="text-slate-500"> — {entry.subject}</span>}
                  {entry.message && <span className="text-slate-500"> — {entry.message}</span>}
                </div>
              )
            })
          )}
        </div>
      </section>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('automation.confirmTitle')}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            {t('automation.confirmMessage', { count: selected.size })}
          </p>
          <ul className="text-xs text-slate-500 list-disc pl-5 space-y-1">
            <li>{t('automation.confirmHint1')}</li>
            <li>{t('automation.confirmHint2')}</li>
            <li>{t('automation.confirmHint3')}</li>
          </ul>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={() => setConfirmOpen(false)}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleConfirm}
              className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              {t('common.confirm')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
