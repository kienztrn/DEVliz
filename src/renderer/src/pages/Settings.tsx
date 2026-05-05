import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCw } from 'lucide-react'
import toast from 'react-hot-toast'
import type { DetectedBrowserDto } from '@shared/ipc'
import type { AppSettings } from '@shared/types'
import { useAppStore } from '../store'

export default function SettingsPage(): JSX.Element {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const refreshSettings = useAppStore((s) => s.refreshSettings)

  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [detected, setDetected] = useState<DetectedBrowserDto | null>(null)

  useEffect(() => {
    if (settings) setDraft(settings)
  }, [settings])

  useEffect(() => {
    let cancelled = false
    const probe = async (): Promise<void> => {
      const path = draft?.chromiumPath ?? null
      try {
        const info = await window.mbm.system.detectBrowser(path)
        if (!cancelled) setDetected(info)
      } catch {
        if (!cancelled) setDetected(null)
      }
    }
    void probe()
    return () => {
      cancelled = true
    }
  }, [draft?.chromiumPath])

  if (!draft) return <div className="text-sm text-slate-500">Loading...</div>

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.mbm.settings.update(draft)
      await refreshSettings()
      toast.success('Saved')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">{t('settings.title')}</h1>
      <div className="card p-5 space-y-4 max-w-2xl">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">{t('settings.language')}</label>
            <select
              className="input"
              value={draft.language}
              onChange={(e) =>
                setDraft({ ...draft, language: e.target.value as AppSettings['language'] })
              }
            >
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
            </select>
          </div>
          <div>
            <label className="label">{t('settings.theme')}</label>
            <select
              className="input"
              value={draft.theme}
              onChange={(e) =>
                setDraft({ ...draft, theme: e.target.value as AppSettings['theme'] })
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">{t('settings.chromiumPath')}</label>
          <input
            className="input"
            placeholder="C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe"
            value={draft.chromiumPath ?? ''}
            onChange={(e) => setDraft({ ...draft, chromiumPath: e.target.value || null })}
          />
          <p className="text-[11px] text-slate-500 mt-1">{t('settings.chromiumPathHelp')}</p>
          {detected ? (
            detected.path ? (
              <div className="mt-2 inline-flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 text-[11px]">
                <span className="font-medium text-emerald-700">
                  {t(`settings.detectedBrowser.${detected.source}`)}:
                </span>
                <span className="font-semibold text-emerald-900">
                  {detected.brand ?? 'Browser'}
                </span>
                <span className="text-emerald-700/70 truncate max-w-[28rem]" title={detected.path}>
                  {detected.path}
                </span>
              </div>
            ) : (
              <div className="mt-2 inline-flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[11px] text-amber-800">
                <span className="font-medium">{t('settings.detectedBrowser.none')}</span>
              </div>
            )
          ) : null}
        </div>
        <div>
          <label className="label">{t('settings.profilesDir')}</label>
          <input
            className="input"
            value={draft.profilesDir ?? ''}
            onChange={(e) => setDraft({ ...draft, profilesDir: e.target.value || null })}
          />
          <p className="text-[11px] text-slate-500 mt-1">{t('settings.profilesDirHelp')}</p>
        </div>
        <div className="flex justify-end">
          <button onClick={save} className="btn-primary" disabled={busy}>
            {t('common.save')}
          </button>
        </div>
      </div>

      <div className="card p-5 space-y-3 max-w-2xl">
        <h2 className="text-base font-semibold text-slate-900">{t('settings.troubleshoot')}</h2>
        <p className="text-xs text-slate-500">{t('settings.reloadUiHelp')}</p>
        <div>
          <button type="button" onClick={() => window.location.reload()} className="btn-secondary">
            <RotateCw className="h-4 w-4" />
            {t('settings.reloadUi')}
          </button>
        </div>
      </div>
    </div>
  )
}
