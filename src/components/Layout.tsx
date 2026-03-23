import { useEffect, useRef, useState } from 'react'
import { PROFILES, type ProfileId } from '../constants'
import type { ReactNode } from 'react'
import type { ScreenId } from '../types'

const NAV: { id: ScreenId; label: string; parentOnly?: boolean }[] = [
  { id: 'setup', label: 'Setup', parentOnly: true },
  { id: 'practice', label: 'Practice' },
  { id: 'mock', label: 'Full Mock Test' },
  { id: 'dashboard', label: 'Progress Dashboard' },
  { id: 'reference', label: 'Quick Reference' },
  { id: 'settings', label: 'Settings', parentOnly: true },
]

function ProfileSwitcher({
  activeProfile,
  onSwitch,
}: {
  activeProfile: ProfileId
  onSwitch: (id: ProfileId) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
        </svg>
        {activeProfile}
        <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {PROFILES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onSwitch(p.id); setOpen(false) }}
              className={`flex w-full items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
                p.id === activeProfile
                  ? 'bg-[#003366] font-semibold text-white'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Layout({
  screen,
  onNavigate,
  activeProfile,
  onSwitchProfile,
  children,
}: {
  screen: ScreenId
  onNavigate: (s: ScreenId) => void
  activeProfile: ProfileId
  onSwitchProfile: (id: ProfileId) => void
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
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <nav className="flex flex-wrap gap-1">
              {NAV.filter((item) => !item.parentOnly || activeProfile === 'Parent').map((item) => (
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
            <div className="hidden h-5 w-px bg-white/20 md:block" />
            <ProfileSwitcher activeProfile={activeProfile} onSwitch={onSwitchProfile} />
          </div>
        </div>
      </header>
      <main className="flex-1 bg-white">
        <div className="screen-enter mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">{children}</div>
      </main>
    </div>
  )
}
