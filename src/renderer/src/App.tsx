import { useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Profiles from './pages/Profiles'
import Proxies from './pages/Proxies'
import BulkCreate from './pages/BulkCreate'
import SettingsPage from './pages/Settings'
import { useAppStore } from './store'

export default function App(): JSX.Element {
  const init = useAppStore((s) => s.init)
  const settings = useAppStore((s) => s.settings)
  const { i18n } = useTranslation()

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (settings?.language && i18n.language !== settings.language) {
      void i18n.changeLanguage(settings.language)
    }
  }, [settings?.language, i18n])

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/profiles" element={<Profiles />} />
        <Route path="/bulk" element={<BulkCreate />} />
        <Route path="/proxies" element={<Proxies />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
