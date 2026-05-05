import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Edit3, FlaskConical, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import type { ProxyRecord } from '@shared/types'
import { useAppStore } from '../store'
import Modal from '../components/Modal'
import ProxyForm from '../components/ProxyForm'

export default function Proxies(): JSX.Element {
  const { t } = useTranslation()
  const proxies = useAppStore((s) => s.proxies)
  const refreshProxies = useAppStore((s) => s.refreshProxies)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ProxyRecord | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')

  const handleTest = async (id: string): Promise<void> => {
    const t0 = toast.loading(t('proxies.testing'))
    try {
      const r = await window.mbm.proxy.test(id)
      toast.dismiss(t0)
      if (r.success) {
        toast.success(t('proxies.testOk', { ip: r.ip, country: r.country, ms: r.latencyMs }))
      } else {
        toast.error(t('proxies.testFail', { error: r.error }))
      }
      await refreshProxies()
    } catch (e) {
      toast.dismiss(t0)
      toast.error((e as Error).message)
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    if (!confirm('Delete?')) return
    await window.mbm.proxy.delete(id)
    await refreshProxies()
  }

  const handleImport = async (): Promise<void> => {
    const r = await window.mbm.proxy.import(importText)
    toast.success(t('proxies.importResult', { added: r.added, skipped: r.skipped }))
    setImportOpen(false)
    setImportText('')
    await refreshProxies()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{t('nav.proxies')}</h1>
        <div className="flex gap-2">
          <button onClick={() => setImportOpen(true)} className="btn-secondary">
            <Upload className="h-4 w-4" />
            {t('common.import')}
          </button>
          <button onClick={() => setOpen(true)} className="btn-primary">
            <Plus className="h-4 w-4" />
            {t('proxies.new')}
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        {proxies.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">{t('proxies.empty')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">{t('common.name')}</th>
                <th className="px-3 py-2">{t('proxies.type')}</th>
                <th className="px-3 py-2">{t('proxies.host')}</th>
                <th className="px-3 py-2">{t('proxies.port')}</th>
                <th className="px-3 py-2">{t('proxies.lastIp')}</th>
                <th className="px-3 py-2">{t('proxies.country')}</th>
                <th className="px-3 py-2 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {proxies.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800">{p.name}</td>
                  <td className="px-3 py-2 text-slate-600 uppercase">{p.type}</td>
                  <td className="px-3 py-2 text-slate-600">{p.host}</td>
                  <td className="px-3 py-2 text-slate-600">{p.port}</td>
                  <td className="px-3 py-2 text-slate-600">{p.lastIp ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{p.lastCountry ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleTest(p.id)}
                        className="btn-ghost"
                        title={t('common.test')}
                      >
                        <FlaskConical className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setEditing(p)}
                        className="btn-ghost"
                        title={t('common.edit')}
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="btn-ghost text-rose-600"
                        title={t('common.delete')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={t('proxies.new')}>
        <ProxyForm
          onDone={async () => {
            setOpen(false)
            await refreshProxies()
          }}
        />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={t('common.edit')}>
        {editing && (
          <ProxyForm
            initial={editing}
            onDone={async () => {
              setEditing(null)
              await refreshProxies()
            }}
          />
        )}
      </Modal>
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title={t('proxies.importTitle')}
      >
        <p className="text-xs text-slate-500 mb-2">{t('proxies.importHelp')}</p>
        <textarea
          className="input font-mono text-xs min-h-[200px]"
          placeholder="1.2.3.4:8080:user:pass"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={() => setImportOpen(false)} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button onClick={handleImport} className="btn-primary" disabled={!importText.trim()}>
            {t('common.import')}
          </button>
        </div>
      </Modal>
    </div>
  )
}
