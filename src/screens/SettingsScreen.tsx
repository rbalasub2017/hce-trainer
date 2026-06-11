import { useEffect, useState } from 'react'

export function SettingsScreen() {
  // null = checking, then true/false from the server
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/anthropic/status')
      .then((r) => r.json() as Promise<{ configured: boolean }>)
      .then((s) => setKeyConfigured(s.configured))
      .catch(() => setKeyConfigured(false))
  }, [])

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-2xl font-bold text-[#003366]">Settings</h2>
        <p className="mt-1 text-slate-600">
          The Anthropic API key used to generate questions and grade essays is configured on the
          server, never in the browser.
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <h3 className="text-sm font-semibold text-slate-800">Anthropic API key</h3>
        {keyConfigured === null && (
          <p className="mt-2 text-sm text-slate-500">Checking server…</p>
        )}
        {keyConfigured === true && (
          <p className="mt-2 inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Configured on the server — question generation and essay grading are available.
          </p>
        )}
        {keyConfigured === false && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <p className="font-medium">Not configured.</p>
            <p className="mt-1">
              Set the <code className="rounded bg-amber-100 px-1 font-mono text-xs">ANTHROPIC_API_KEY</code>{' '}
              environment variable where the server runs and restart it. Practice and mock tests
              work without it; question generation and essay grading need it.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
