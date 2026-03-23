import { useEffect, useState } from 'react'
import { Layout } from './components/Layout'
import { TrainerProvider } from './context/TrainerContext'
import { SetupScreen } from './screens/SetupScreen'
import { PracticeScreen } from './screens/PracticeScreen'
import { MockTestScreen } from './screens/MockTestScreen'
import { DashboardScreen } from './screens/DashboardScreen'
import { QuickReferenceScreen } from './screens/QuickReferenceScreen'
import type { ScreenId } from './types'

function AppShell() {
  const [screen, setScreen] = useState<ScreenId>('setup')

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
    <Layout screen={screen} onNavigate={setScreen}>
      {screen === 'setup' && <SetupScreen />}
      {screen === 'practice' && <PracticeScreen />}
      {screen === 'mock' && <MockTestScreen />}
      {screen === 'dashboard' && <DashboardScreen />}
      {screen === 'reference' && <QuickReferenceScreen />}
    </Layout>
  )
}

export default function App() {
  return (
    <TrainerProvider>
      <AppShell />
    </TrainerProvider>
  )
}
