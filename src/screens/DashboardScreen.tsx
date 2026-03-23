import { useMemo, useState } from 'react'
import { CATEGORIES, PROFILES } from '../constants'
import { useTrainer, PARENT_PROFILE_ID } from '../context/TrainerContext'
import { categoryName } from '../prompts'
import { loadState } from '../storage'
import { deleteAllRunsFromBackend } from '../utils/db'
import type { CategoryProgress, EssayGrade, MockTestRun, PersistedState, QuestionResult } from '../types'

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

function MockHistoryChart({ runs }: { runs: MockTestRun[] }) {
  const w = 480, h = 140, padL = 36, padR = 12, padT = 16, padB = 24
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const n = runs.length

  const points = runs.map((r, i) => ({
    x: padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW),
    y: padT + innerH - (r.score / 100) * innerH,
    run: r,
  }))
  const polyline = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label="Mock test score history">
      {[25, 50, 75, 100].map((v) => {
        const y = padT + innerH - (v / 100) * innerH
        return (
          <g key={v}>
            <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="#e2e8f0" strokeWidth={1} />
            <text x={padL - 4} y={y} textAnchor="end" dominantBaseline="middle" className="fill-slate-400 text-[9px]">
              {v}%
            </text>
          </g>
        )
      })}
      {n > 1 && <polyline points={polyline} fill="none" stroke="#003366" strokeWidth={2} strokeLinejoin="round" />}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={4} fill={p.run.score === Math.max(...runs.map((r) => r.score)) ? '#CC0000' : '#003366'} />
          <text x={p.x} y={p.y - 7} textAnchor="middle" className="fill-slate-600 text-[9px]">
            {p.run.score}%
          </text>
        </g>
      ))}
    </svg>
  )
}

// ── Question result row (read-only review) ────────────────────────────────────
function ReviewQuestionRow({ qr, index, forceExpand }: { qr: QuestionResult; index: number; forceExpand: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const isOpen = forceExpand || expanded
  const answered = qr.userAnswer !== null
  const correct = answered && qr.userAnswer === qr.correct
  const rowBg = correct
    ? 'border-emerald-200 bg-emerald-50/60'
    : answered
      ? 'border-red-200 bg-red-50/50'
      : 'border-slate-200 bg-slate-50'
  return (
    <div className={`rounded-lg border ${rowBg} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left"
      >
        <span className={`w-5 shrink-0 text-center text-base font-bold ${correct ? 'text-emerald-600' : answered ? 'text-red-600' : 'text-slate-400'}`}>
          {correct ? '✓' : answered ? '✗' : '—'}
        </span>
        <span className="flex-1 text-sm text-slate-800 line-clamp-1">
          <span className="mr-1 font-semibold text-slate-500">{index + 1}.</span>
          {qr.question}
        </span>
        <span className="shrink-0 text-xs text-slate-400 hidden sm:inline">
          {categoryName(qr.categoryId)}
        </span>
        <svg className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="border-t border-slate-200 px-3 pb-3 pt-2">
          <p className="mb-2 text-sm font-medium text-slate-900">{qr.question}</p>
          <div className="space-y-1.5">
            {(['A', 'B', 'C', 'D'] as const).map((k) => {
              const isCorrectChoice = k === qr.correct
              const isUserChoice = k === qr.userAnswer
              const wrongUserChoice = isUserChoice && !isCorrectChoice
              return (
                <div key={k} className={`flex items-start gap-2 rounded px-2.5 py-1.5 text-sm ${isCorrectChoice ? 'bg-emerald-100 text-emerald-900 font-medium' : wrongUserChoice ? 'bg-red-100 text-red-900 font-medium' : 'text-slate-600'}`}>
                  <span className="shrink-0 font-bold">{k}.</span>
                  <span className="flex-1">{qr.choices[k]}</span>
                  {isCorrectChoice && <span className="ml-auto shrink-0 text-xs font-semibold text-emerald-700">Correct</span>}
                  {wrongUserChoice && <span className="ml-auto shrink-0 text-xs font-semibold text-red-700">Your answer</span>}
                </div>
              )
            })}
          </div>
          {qr.explanation && (
            <div className="mt-3 rounded-md bg-white/80 px-3 py-2 text-sm leading-relaxed text-slate-700 ring-1 ring-slate-200">
              <p>
                <span className="font-semibold text-[#003366]">Explanation: </span>
                {qr.explanation}
              </p>
              {qr.source && (
                <p className="mt-1.5 text-xs text-slate-500">
                  <span className="font-semibold">Source: </span>
                  {qr.source}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Essay grade panel (read-only) ─────────────────────────────────────────────
function ReviewEssayGrade({ grade }: { grade: EssayGrade }) {
  const scoreColor = grade.score >= 8 ? 'text-emerald-700' : grade.score >= 6 ? 'text-amber-600' : 'text-red-700'
  const scoreBg = grade.score >= 8 ? 'bg-emerald-50 border-emerald-200' : grade.score >= 6 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'
  return (
    <div className={`rounded-xl border p-4 ${scoreBg}`}>
      <div className="flex items-center gap-3">
        <span className={`text-3xl font-extrabold tabular-nums ${scoreColor}`}>{grade.score}/10</span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI Essay Grade</p>
          <p className="text-sm text-slate-700">{grade.feedback}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Strengths</p>
          <ul className="mt-1 space-y-1">
            {grade.strengths.map((s, i) => (
              <li key={i} className="flex items-start gap-1.5 text-sm text-slate-700">
                <span className="mt-0.5 shrink-0 text-emerald-600">✓</span> {s}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">To improve</p>
          <ul className="mt-1 space-y-1">
            {grade.improvements.map((s, i) => (
              <li key={i} className="flex items-start gap-1.5 text-sm text-slate-700">
                <span className="mt-0.5 shrink-0 text-amber-600">→</span> {s}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

// ── Run review modal ──────────────────────────────────────────────────────────
function RunReviewModal({ run, onClose }: { run: MockTestRun; onClose: () => void }) {
  const [allExpanded, setAllExpanded] = useState(false)
  const questions = run.questions ?? []
  const correctCount = questions.filter((q) => q.userAnswer === q.correct).length

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-8">
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h3 className="text-lg font-bold text-[#003366]">Run Review</h3>
            <p className="text-sm text-slate-500">
              {new Date(run.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
              {' · '}
              <span className="font-semibold text-slate-700">{run.score}%</span>
              {' · '}
              {run.correct}/{run.total} correct
              {run.mode && (
                <>
                  {' · '}
                  {run.mode === 'tough'
                    ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700">Tough</span>
                    : <span className="text-xs">Normal</span>
                  }
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close review"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-6 p-6">
          {/* MC question review */}
          {questions.length > 0 ? (
            <div className="rounded-xl border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h4 className="font-semibold text-[#003366]">
                  Question Review
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    {correctCount}/{questions.length} correct
                  </span>
                </h4>
                <button
                  type="button"
                  onClick={() => setAllExpanded((v) => !v)}
                  className="text-xs font-medium text-[#003366] hover:underline"
                >
                  {allExpanded ? 'Collapse all' : 'Expand all'}
                </button>
              </div>
              <div className="space-y-1 p-3">
                {questions.map((qr, i) => (
                  <ReviewQuestionRow
                    key={qr.questionId}
                    qr={qr}
                    index={i}
                    forceExpand={allExpanded}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm italic text-slate-500">Question details were not saved for this run.</p>
          )}

          {/* Essay section */}
          {run.essayText || run.essayGrade ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <h4 className="font-semibold text-[#003366]">Essay</h4>
              {run.essayPrompt && (
                <p className="text-xs text-slate-500">{run.essayPrompt}</p>
              )}
              {run.essayText && (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{run.essayText}</p>
              )}
              {run.essayGrade && <ReviewEssayGrade grade={run.essayGrade} />}
            </div>
          ) : null}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-[#003366] px-5 py-2 text-sm font-semibold text-white hover:bg-[#002952]"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const STUDENT_PROFILES = PROFILES.filter((p) => p.id !== PARENT_PROFILE_ID)

function DashboardView({
  viewState,
  isReadOnly,
  onReset,
}: {
  viewState: PersistedState
  isReadOnly: boolean
  onReset?: () => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [reviewRun, setReviewRun] = useState<MockTestRun | null>(null)

  const rows = useMemo(
    () =>
      CATEGORIES.map((c) => {
        const p = viewState.categoryProgress[c.id]
        return {
          id: c.id,
          name: c.name,
          attempted: p.attempted,
          pct: pct(p),
          trend: trendArrow(p),
        }
      }),
    [viewState.categoryProgress],
  )

  const radarValues = useMemo(
    () => CATEGORIES.map((c) => pct(viewState.categoryProgress[c.id])),
    [viewState.categoryProgress],
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
    <>
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
              {viewState.totalQuestionsAnswered}
            </li>
            <li>
              <span className="font-medium text-slate-900">Total time practiced:</span>{' '}
              {fmtTime(viewState.totalPracticeSeconds)}
            </li>
            <li>
              <span className="font-medium text-slate-900">Mock test high score:</span>{' '}
              {viewState.mockTestHighScore}%
            </li>
          </ul>
        </div>
      </section>

      {viewState.mockTestHistory.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
          <h3 className="text-sm font-semibold text-[#003366]">Mock test history</h3>
          <p className="mt-0.5 text-xs text-slate-500">{viewState.mockTestHistory.length} run{viewState.mockTestHistory.length !== 1 ? 's' : ''} — best score highlighted in red</p>
          <div className="mt-4">
            <MockHistoryChart runs={viewState.mockTestHistory} />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="border-b border-slate-100 text-slate-500">
                <tr>
                  <th className="pb-2 pr-6 font-medium">Date</th>
                  <th className="pb-2 pr-6 font-medium">Mode</th>
                  <th className="pb-2 pr-6 font-medium">MC Score</th>
                  <th className="pb-2 pr-6 font-medium">Correct / Total</th>
                  <th className="pb-2 pr-6 font-medium">Essay</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {[...viewState.mockTestHistory].reverse().map((r, i) => (
                  <tr key={i} className="border-b border-slate-50 last:border-0">
                    <td className="py-1.5 pr-6 text-slate-600">
                      {new Date(r.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="py-1.5 pr-6">
                      {r.mode === 'tough'
                        ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Tough</span>
                        : <span className="text-xs text-slate-400">{r.mode === 'normal' ? 'Normal' : '—'}</span>
                      }
                    </td>
                    <td className={`py-1.5 pr-6 font-semibold ${r.score === viewState.mockTestHighScore ? 'text-[#CC0000]' : 'text-slate-800'}`}>
                      {r.score}%
                    </td>
                    <td className="py-1.5 pr-6 text-slate-600">{r.correct}/{r.total}</td>
                    <td className="py-1.5 pr-6 text-slate-600">
                      {r.essayGrade ? (
                        <span className={`font-semibold ${r.essayGrade.score >= 8 ? 'text-emerald-700' : r.essayGrade.score >= 6 ? 'text-amber-600' : 'text-red-700'}`}>
                          {r.essayGrade.score}/10
                        </span>
                      ) : r.essayText ? (
                        <span className="text-slate-400 italic">pending</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="py-1.5">
                      {r.questions && r.questions.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setReviewRun(r)}
                          className="rounded px-2 py-0.5 text-xs font-medium text-[#003366] hover:bg-slate-100 hover:underline"
                        >
                          Review
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

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
        <p className="mt-1 text-sm text-slate-600">Bottom three categories — short drills help fast.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {focus.map((f) => (
            <div key={f.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="font-semibold text-slate-900">{f.name}</p>
              <p className="mt-1 text-xs text-slate-500">
                {f.attempted ? `${f.pct}% correct` : 'Not enough data yet'}
              </p>
              {!isReadOnly && (
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
              )}
            </div>
          ))}
        </div>
      </section>

      {!isReadOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
          >
            Reset All Progress
          </button>
        </div>
      )}

      {reviewRun && (
        <RunReviewModal run={reviewRun} onClose={() => setReviewRun(null)} />
      )}

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
                  onReset?.()
                  setConfirmOpen(false)
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function DashboardScreen() {
  const { activeProfile, state, resetAllProgress } = useTrainer()
  const isParent = activeProfile === PARENT_PROFILE_ID

// Parent view: pick which student to view (defaults to first student)
  const [viewingProfileId, setViewingProfileId] = useState<string>(STUDENT_PROFILES[0]!.id)
  const viewState = isParent ? loadState(viewingProfileId as Parameters<typeof loadState>[0]) : state
  const viewingLabel = isParent ? STUDENT_PROFILES.find((p) => p.id === viewingProfileId)?.label : null

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-2xl font-bold text-[#003366]">Progress Dashboard</h2>
        {isParent ? (
          <p className="mt-1 text-slate-600">Viewing read-only progress for a student.</p>
        ) : (
          <p className="mt-1 text-slate-600">See strengths, gaps, and how you are trending.</p>
        )}
      </header>

      {isParent && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-500">Viewing:</span>
          {STUDENT_PROFILES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setViewingProfileId(p.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                viewingProfileId === p.id
                  ? 'bg-[#003366] text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
          {viewingLabel && (
            <span className="ml-2 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
              Read-only
            </span>
          )}
        </div>
      )}


      <DashboardView
        viewState={viewState}
        isReadOnly={isParent}
        onReset={!isParent ? () => { resetAllProgress(); void deleteAllRunsFromBackend(activeProfile) } : undefined}
      />
    </div>
  )
}
