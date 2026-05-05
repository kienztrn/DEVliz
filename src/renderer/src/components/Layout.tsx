import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard, Users, Globe, Layers, Settings } from 'lucide-react'
import { cn } from '../lib/cn'

const navItems = [
  { to: '/', key: 'dashboard', icon: LayoutDashboard },
  { to: '/profiles', key: 'profiles', icon: Users },
  { to: '/bulk', key: 'bulk', icon: Layers },
  { to: '/proxies', key: 'proxies', icon: Globe },
  { to: '/settings', key: 'settings', icon: Settings },
] as const

export default function Layout(): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex h-full bg-slate-50">
      <aside className="w-56 border-r border-slate-200 bg-white p-3 flex flex-col">
        <div className="px-2 py-3">
          <div className="text-base font-semibold text-slate-900">{t('app.title')}</div>
          <div className="text-xs text-slate-500 mt-0.5">{t('app.subtitle')}</div>
        </div>
        <nav className="mt-2 flex flex-col gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {t(`nav.${item.key}`)}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto px-2 py-2 text-[10px] text-slate-400">v0.1.0 · MIT License</div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
