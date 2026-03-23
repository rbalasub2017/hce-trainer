import type { ReactNode } from 'react'
import type { ScreenId } from '../types'

const NAV: { id: ScreenId; label: string }[] = [
  { id: 'setup', label: 'Setup' },
  { id: 'practice', label: 'Practice' },
  { id: 'mock', label: 'Full Mock Test' },
  { id: 'dashboard', label: 'Progress Dashboard' },
  { id: 'reference', label: 'Quick Reference' },
]

export function Layout({
  screen,
  onNavigate,
  children,
}: {
  screen: ScreenId
  onNavigate: (s: ScreenId) => void
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-black/10 bg-[#003366] text-white shadow-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-8">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-bold tracking-tight">HCE Trainer</h1>
            <span className="hidden text-xs text-white/75 sm:inline">HOSA Health Career Exploration</span>
          </div>
          <nav className="flex flex-wrap gap-1 md:justify-end">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  screen === item.id
                    ? 'bg-white/15 text-white ring-1 ring-white/25'
                    : 'text-white/90 hover:bg-white/10'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1 bg-white">
        <div className="screen-enter mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">{children}</div>
      </main>
    </div>
  )
}
