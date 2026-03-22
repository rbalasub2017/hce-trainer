import { useMemo, useState } from 'react'
import { CATEGORIES } from '../constants'
import { useTrainer } from '../context/TrainerContext'
import type { CategoryProgress } from '../types'

function pct(p: CategoryProgress): number {
  return p.attempted > 0 ? Math.round((p.correct / p.attempted) * 100) : 0
}

function trendArrow(p: CategoryProgress): string {
  const s = p.sessions
  if (s.length < 2) return '—'
  const a = s[s.length - 1]!
  const b = s[s.length - 2]!
  const pa = a.attempted ? a.correct / a.attempted : 0
  const pb = b.attempted ? b.correct / b.attempted : 0
  if (pa > pb + 0.01) return '↑'
  if (pa < pb - 0.01) return '↓'
  return '→'
}

function RadarChart({ values }: { values: number[] }) {
  const cx = 120
  const cy = 120
  const rMax = 90
  const n = 10
  const points = values.map((v, i) => {
    const ang = (-Math.PI / 2) + (2 * Math.PI * i) / n
    const rr = (v / 100) * rMax
    const x = cx + rr * Math.cos(ang)
    const y = cy + rr * Math.sin(ang)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  const poly = points.join(' ')

  const axis = CATEGORIES.map((c, i) => {
    const ang = (-Math.PI / 2) + (2 * Math.PI * i) / n
    const x2 = cx + rMax * Math.cos(ang)
    const y2 = cy + rMax * Math.sin(ang)
    const lx = cx + (rMax + 12) * Math.cos(ang)
    const ly = cy + (rMax + 12) * Math.sin(ang)
    return (
      <g key={c.id}>
        <line x1={cx} y1={cy} x2={x2} y2={y2} stroke="#cbd5e1" strokeWidth={1} />
        <text
          x={lx}
          y={ly}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-slate-600 text-[7px]"
        >
          {c.name.length > 16 ? `${c.name.slice(0, 14)}…` : c.name}
        </text>
      </g>
    )
  })

  return (
    <svg viewBox="0 0 240 240" className="mx-auto h-auto max-w-full" role="img" aria-label="Radar chart of category performance">
      {[0.25, 0.5, 0.75, 1].map((s) => (
        <circle
          key={s}
          cx={cx}
          cy={cy}
          r={rMax * s}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={1}
        />
      ))}
      {axis}
      <polygon fill="rgba(0,51,102,0.2)" stroke="#003366" strokeWidth={2} points={poly} />
    </svg>
  )
}

export function DashboardScreen() {
  const { state, resetAllProgress } = useTrainer()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const rows = useMemo(
    () =>
      CATEGORIES.map((c) => {
        const p = state.categoryProgress[c.id]
        return {
          id: c.id,
          name: c.name,
          attempted: p.attempted,
          pct: pct(p),
          trend: trendArrow(p),
        }
      }),
    [state.categoryProgress],
  )

  const radarValues = useMemo(
    () => CATEGORIES.map((c) => pct(state.categoryProgress[c.id])),
    [state.categoryProgress],
  )

  const focus = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      if (a.attempted === 0 && b.attempted > 0) return -1
      if (b.attempted === 0 && a.attempted > 0) return 1
      return a.pct - b.pct
    })
    return sorted.slice(0, 3)
  }, [rows])

  const fmtTime = (sec: number) => {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-2xl font-bold text-[#003366]">Progress Dashboard</h2>
        <p className="mt-1 text-slate-600">See strengths, gaps, and how you are trending.</p>
      </header>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-[#003366]">Category balance</h3>
          <RadarChart values={radarValues} />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-[#003366]">Summary</h3>
          <ul className="mt-4 space-y-3 text-sm text-slate-700">
            <li>
              <span className="font-medium text-slate-900">Total questions answered:</span>{' '}
              {state.totalQuestionsAnswered}
            </li>
            <li>
              <span className="font-medium text-slate-900">Total time practiced:</span>{' '}
              {fmtTime(state.totalPracticeSeconds)}
            </li>
            <li>
              <span className="font-medium text-slate-900">Mock test high score:</span>{' '}
              {state.mockTestHighScore}%
            </li>
          </ul>
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Questions attempted</th>
              <th className="px-4 py-3">% Correct</th>
              <th className="px-4 py-3">Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
                <td className="px-4 py-3 text-slate-700">{r.attempted}</td>
                <td className="px-4 py-3 text-slate-700">{r.pct}%</td>
                <td className="px-4 py-3 text-lg text-[#003366]">{r.trend}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-[#CC0000]/30 bg-red-50/40 p-4 md:p-6">
        <h3 className="text-lg font-semibold text-[#003366]">Focus Zone</h3>
        <p className="mt-1 text-sm text-slate-600">Your bottom three categories — short drills help fast.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {focus.map((f) => (
            <div key={f.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="font-semibold text-slate-900">{f.name}</p>
              <p className="mt-1 text-xs text-slate-500">
                {f.attempted ? `${f.pct}% correct` : 'Not enough data yet'}
              </p>
              <button
                type="button"
                className="mt-3 w-full rounded-lg bg-[#003366] px-3 py-2 text-xs font-semibold text-white hover:bg-[#002952]"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent('hce-navigate', { detail: { screen: 'practice', category: f.id } }),
                  )
                }}
              >
                Drill 10 more questions
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
        >
          Reset All Progress
        </button>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h4 className="text-lg font-semibold text-slate-900">Reset all progress?</h4>
            <p className="mt-2 text-sm text-slate-600">
              This clears scores, practice time totals, starred cards, and mock high score. Your API key, uploaded PDFs,
              and generated questions stay saved.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium"
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-[#CC0000] px-4 py-2 text-sm font-semibold text-white"
                onClick={() => {
                  resetAllProgress()
                  setConfirmOpen(false)
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
