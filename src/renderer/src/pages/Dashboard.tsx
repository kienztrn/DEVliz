import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Layers, Globe, Plus, Upload } from 'lucide-react'
import { useAppStore } from '../store'

export default function Dashboard(): JSX.Element {
  const { t } = useTranslation()
  const profiles = useAppStore((s) => s.profiles)
  const proxies = useAppStore((s) => s.proxies)
  const runningIds = useAppStore((s) => s.runningIds)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('app.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('dashboard.welcome')}</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label={t('dashboard.profiles')} value={profiles.length} />
        <StatCard label={t('dashboard.proxies')} value={proxies.length} />
        <StatCard label={t('dashboard.running')} value={runningIds.size} />
      </div>

      <div className="card p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-3">
          {t('dashboard.quickActions')}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link to="/profiles" className="btn-primary">
            <Plus className="h-4 w-4" />
            {t('dashboard.createProfile')}
          </Link>
          <Link to="/bulk" className="btn-secondary">
            <Layers className="h-4 w-4" />
            {t('dashboard.bulkCreate')}
          </Link>
          <Link to="/proxies" className="btn-secondary">
            <Globe className="h-4 w-4" />
            {t('dashboard.addProxy')}
          </Link>
          <Link to="/proxies" className="btn-secondary">
            <Upload className="h-4 w-4" />
            {t('dashboard.importProxy')}
          </Link>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="card p-5">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-slate-900">{value}</div>
    </div>
  )
}
