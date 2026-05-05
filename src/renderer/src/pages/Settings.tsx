import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import type { AppSettings } from '@shared/types'
import { useAppStore } from '../store'

export default function SettingsPage(): JSX.Element {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const refreshSettings = useAppStore((s) => s.refreshSettings)

  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (settings) setDraft(settings)
  }, [settings])

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
            placeholder="C:/Program Files/Google/Chrome/Application/chrome.exe"
            value={draft.chromiumPath ?? ''}
            onChange={(e) => setDraft({ ...draft, chromiumPath: e.target.value || null })}
          />
          <p className="text-[11px] text-slate-500 mt-1">{t('settings.chromiumPathHelp')}</p>
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
    </div>
  )
}
