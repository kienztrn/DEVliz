import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Square, Copy, Trash2, Plus, Edit3 } from 'lucide-react'
import toast from 'react-hot-toast'
import type { ProfileRecord } from '@shared/types'
import { useAppStore } from '../store'
import Modal from '../components/Modal'
import ProfileForm from '../components/ProfileForm'

export default function Profiles(): JSX.Element {
  const { t } = useTranslation()
  const profiles = useAppStore((s) => s.profiles)
  const proxies = useAppStore((s) => s.proxies)
  const runningIds = useAppStore((s) => s.runningIds)
  const refreshProfiles = useAppStore((s) => s.refreshProfiles)

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ProfileRecord | null>(null)

  const proxyMap = useMemo(() => new Map(proxies.map((p) => [p.id, p])), [proxies])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return profiles
    return profiles.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.groupName?.toLowerCase().includes(q) ?? false),
    )
  }, [profiles, search])

  const toggleSelect = (id: string): void => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const handleLaunch = async (id: string): Promise<void> => {
    try {
      await window.mbm.profile.launch(id)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleStop = async (id: string): Promise<void> => {
    await window.mbm.profile.stop(id)
  }

  const handleDelete = async (id: string): Promise<void> => {
    if (!confirm(t('profiles.deleteConfirm', { count: 1 }))) return
    await window.mbm.profile.delete(id)
    await refreshProfiles()
    toast.success('Deleted')
  }

  const handleClone = async (id: string): Promise<void> => {
    await window.mbm.profile.clone(id)
    await refreshProfiles()
    toast.success('Cloned')
  }

  const handleLaunchSelected = async (): Promise<void> => {
    if (!selected.size) return
    const results = await window.mbm.profile.launchMany(Array.from(selected))
    const errors = results.filter((r) => r.error)
    if (errors.length) toast.error(`${errors.length} failed`)
    else toast.success(t('common.running'))
  }

  const handleDeleteSelected = async (): Promise<void> => {
    if (!selected.size) return
    if (!confirm(t('profiles.deleteConfirm', { count: selected.size }))) return
    for (const id of selected) await window.mbm.profile.delete(id)
    setSelected(new Set())
    await refreshProfiles()
    toast.success('Deleted')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{t('nav.profiles')}</h1>
        <button onClick={() => setCreateOpen(true)} className="btn-primary">
          <Plus className="h-4 w-4" />
          {t('profiles.new')}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder={t('common.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {selected.size > 0 && (
          <>
            <span className="text-sm text-slate-600">
              {t('profiles.selected', { count: selected.size })}
            </span>
            <button onClick={handleLaunchSelected} className="btn-secondary">
              <Play className="h-4 w-4" />
              {t('profiles.launchSelected')}
            </button>
            <button onClick={handleDeleteSelected} className="btn-danger">
              <Trash2 className="h-4 w-4" />
              {t('profiles.deleteSelected')}
            </button>
          </>
        )}
      </div>

      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">{t('profiles.empty')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) setSelected(new Set(filtered.map((p) => p.id)))
                      else setSelected(new Set())
                    }}
                  />
                </th>
                <th className="px-3 py-2">{t('common.name')}</th>
                <th className="px-3 py-2">{t('common.group')}</th>
                <th className="px-3 py-2">{t('profiles.os')}</th>
                <th className="px-3 py-2">{t('profiles.proxy')}</th>
                <th className="px-3 py-2">{t('common.status')}</th>
                <th className="px-3 py-2 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const proxy = p.proxyId ? proxyMap.get(p.proxyId) : null
                const isRunning = runningIds.has(p.id)
                return (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800">{p.name}</td>
                    <td className="px-3 py-2 text-slate-600">{p.groupName || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{p.fingerprint.os}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {proxy ? `${proxy.host}:${proxy.port}` : t('profiles.none')}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          isRunning
                            ? 'badge bg-emerald-100 text-emerald-700'
                            : 'badge bg-slate-100 text-slate-600'
                        }
                      >
                        {isRunning ? t('common.running') : t('common.idle')}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {isRunning ? (
                          <button
                            onClick={() => handleStop(p.id)}
                            className="btn-ghost"
                            title={t('common.stop')}
                          >
                            <Square className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleLaunch(p.id)}
                            className="btn-ghost"
                            title={t('common.launch')}
                          >
                            <Play className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => setEditing(p)}
                          className="btn-ghost"
                          title={t('common.edit')}
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleClone(p.id)}
                          className="btn-ghost"
                          title={t('common.clone')}
                        >
                          <Copy className="h-4 w-4" />
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
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('profiles.new')}
        size="lg"
      >
        <ProfileForm
          onDone={async () => {
            setCreateOpen(false)
            await refreshProfiles()
          }}
        />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={t('common.edit')} size="lg">
        {editing && (
          <ProfileForm
            initial={editing}
            onDone={async () => {
              setEditing(null)
              await refreshProfiles()
            }}
          />
        )}
      </Modal>
    </div>
  )
}
