import { useEffect, useState } from 'react'
import { Layout } from './components/Layout'
import { TrainerProvider, PARENT_PROFILE_ID } from './context/TrainerContext'
import { SetupScreen } from './screens/SetupScreen'
import { PracticeScreen } from './screens/PracticeScreen'
import { MockTestScreen } from './screens/MockTestScreen'
import { DashboardScreen } from './screens/DashboardScreen'
import { QuickReferenceScreen } from './screens/QuickReferenceScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { ACTIVE_PROFILE_KEY, PROFILES, type ProfileId } from './constants'
import type { ScreenId } from './types'

function AppShell({
  activeProfile,
  onSwitchProfile,
}: {
  activeProfile: ProfileId
  onSwitchProfile: (id: ProfileId) => void
}) {
  const [screen, setScreen] = useState<ScreenId>(
    activeProfile === PARENT_PROFILE_ID ? 'setup' : 'practice',
  )

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ screen?: ScreenId; category?: string }>).detail
      if (d?.screen) setScreen(d.screen)
      if (d?.category) sessionStorage.setItem('hce_drill_category', d.category)
    }
    window.addEventListener('hce-navigate', h as EventListener)
    return () => window.removeEventListener('hce-navigate', h as EventListener)
  }, [])

  return (
    <Layout
      screen={screen}
      onNavigate={setScreen}
      activeProfile={activeProfile}
      onSwitchProfile={onSwitchProfile}
    >
      {screen === 'setup' && <SetupScreen />}
      {screen === 'practice' && <PracticeScreen />}
      {screen === 'mock' && <MockTestScreen />}
      {screen === 'dashboard' && <DashboardScreen />}
      {screen === 'reference' && <QuickReferenceScreen />}
      {screen === 'settings' && <SettingsScreen />}
    </Layout>
  )
}

export default function App() {
  const [activeProfile, setActiveProfile] = useState<ProfileId>(() => {
    const stored = localStorage.getItem(ACTIVE_PROFILE_KEY)
    return (PROFILES.some((p) => p.id === stored) ? stored : 'Shyam') as ProfileId
  })

  const handleSwitchProfile = (id: ProfileId) => {
    localStorage.setItem(ACTIVE_PROFILE_KEY, id)
    setActiveProfile(id)
  }

  return (
    <TrainerProvider key={activeProfile} profile={activeProfile}>
      <AppShell activeProfile={activeProfile} onSwitchProfile={handleSwitchProfile} />
    </TrainerProvider>
  )
}
