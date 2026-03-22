import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CATEGORIES, type CategoryId } from '../constants'
import { useTrainer } from '../context/TrainerContext'
import { LoadingPulse } from '../components/LoadingPulse'
import type { ChoiceKey, McQuestion, PersistedState } from '../types'
import { pickRandom, shuffleInPlace } from '../utils/shuffle'
import { categoryName, buildCramSheetSystem, buildCramSheetUser } from '../prompts'
import { callClaude } from '../utils/anthropic'

const MOCK_SECONDS = 60 * 60
const MOCK_TOTAL = 35
const ADAPTIVE_MIN_ATTEMPTS = 10

// ── Mock helpers ──────────────────────────────────────────────────────────────

function mockDistribution(): number[] {
  const counts = Array.from({ length: 10 }, () => 3)
  const extra = MOCK_TOTAL - 30
  const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
  shuffleInPlace(order)
  for (let i = 0; i < extra; i++) counts[order[i]!] += 1
  return counts
}

function buildMockPaper(byCategory: Record<CategoryId, McQuestion[]>): McQuestion[] {
  const dist = mockDistribution()
  const out: McQuestion[] = []
  CATEGORIES.forEach((c, idx) => {
    const need = dist[idx]!
    const pool = byCategory[c.id]
    const picked = pickRandom(pool, need)
    out.push(...picked)
  })
  shuffleInPlace(out)
  return out
}

function weakestCategoryId(
  progress: PersistedState['categoryProgress'],
  hasQuestions: (id: CategoryId) => boolean,
): CategoryId | null {
  let worst: { id: CategoryId; pct: number } | null = null
  for (const c of CATEGORIES) {
    if (!hasQuestions(c.id)) continue
    const p = progress[c.id]
    if (p.attempted <= 0) continue
    const pct = p.correct / p.attempted
    if (!worst || pct < worst.pct) worst = { id: c.id, pct }
  }
  if (worst) return worst.id
  const fallback = CATEGORIES.map((c) => c.id).filter(hasQuestions)
  if (!fallback.length) return null
  return fallback[Math.floor(Math.random() * fallback.length)]!
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

// ── Adaptive helpers ──────────────────────────────────────────────────────────

type AdaptiveStats = Record<CategoryId, { correct: number; attempted: number }>

function emptyAdaptiveStats(): AdaptiveStats {
  const z = {} as AdaptiveStats
  for (const c of CATEGORIES) z[c.id] = { correct: 0, attempted: 0 }
  return z
}

function isAdaptiveUnlocked(progress: PersistedState['categoryProgress']): boolean {
  return CATEGORIES.every((c) => progress[c.id].attempted >= ADAPTIVE_MIN_ATTEMPTS)
}

function adaptiveWeight(prog: PersistedState['categoryProgress'][CategoryId]): number {
  if (prog.attempted === 0) return 2
  const pct = prog.correct / prog.attempted
  if (pct < 0.7) return 3
  if (pct > 0.85) return 1
  return 2
}

function buildAdaptivePool(
  categories: PersistedState['categories'],
  progress: PersistedState['categoryProgress'],
): McQuestion[] {
  const pool: McQuestion[] = []
  for (const c of CATEGORIES) {
    const qs = categories[c.id].questions
    if (!qs.length) continue
    const w = adaptiveWeight(progress[c.id])
    for (let i = 0; i < w; i++) pool.push(...qs)
  }
  shuffleInPlace(pool)
  return pool
}

function weakestInStats(stats: AdaptiveStats): CategoryId | null {
  let worst: { id: CategoryId; pct: number } | null = null
  for (const c of CATEGORIES) {
    const s = stats[c.id]
    if (!s || s.attempted === 0) continue
    const pct = s.correct / s.attempted
    if (!worst || pct < worst.pct) worst = { id: c.id, pct }
  }
  return worst?.id ?? null
}

// ── MockResultsChart ──────────────────────────────────────────────────────────

function MockResultsChart({
  byCategory,
}: {
  byCategory: Record<CategoryId, { correct: number; attempted: number }>
}) {
  const rows = CATEGORIES.map((c) => {
    const r = byCategory[c.id]
    const pct = r.attempted ? Math.round((r.correct / r.attempted) * 100) : 0
    return { id: c.id, name: c.name, pct, attempted: r.attempted }
  })
  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
      <h4 className="font-semibold text-[#003366]">Score by category</h4>
      <svg
        viewBox="0 0 640 220"
        className="mt-4 h-auto w-full"
        role="img"
        aria-label="Bar chart of percent correct per category"
      >
        {rows.map((row, i) => {
          const barW = 52
          const gap = 8
          const x = 16 + i * (barW + gap)
          const h = (row.pct / 100) * 120
          const y = 140 - h
          return (
            <g key={row.id}>
              <rect x={x} y={y} width={barW} height={h} fill="#003366" rx={4} opacity={0.9} />
              <text x={x + barW / 2} y={158} textAnchor="middle" className="fill-slate-600 text-[9px]">
                {row.pct}%
              </text>
              <text x={x + barW / 2} y={178} textAnchor="middle" className="fill-slate-500 text-[8px]">
                {row.name.length > 12 ? `${row.name.slice(0, 10)}…` : row.name}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── PracticeScreen ────────────────────────────────────────────────────────────

export function PracticeScreen() {
  const {
    state,
    recordDrillSession,
    recordMockResults,
    addPracticeTime,
    addQuestionsAnswered,
    setMockHighScore,
  } = useTrainer()

  const [practiceMode, setPracticeMode] = useState<'drill' | 'mock' | 'adaptive'>('drill')

  const hasQuestions = useCallback(
    (id: CategoryId) => state.categories[id].questions.length > 0,
    [state.categories],
  )

  // ── Drill state ───────────────────────────────────────────────────────────

  const [drillSelect, setDrillSelect] = useState<string>(() => {
    if (typeof window === 'undefined') return 'health-informatics'
    const v = sessionStorage.getItem('hce_drill_category')
    sessionStorage.removeItem('hce_drill_category')
    const ok = v && (v === 'weakest' || CATEGORIES.some((c) => c.id === v))
    return ok ? v : 'health-informatics'
  })
  const [drillBatch, setDrillBatch] = useState<McQuestion[]>([])
  const [drillAnswers, setDrillAnswers] = useState<Partial<Record<string, ChoiceKey>>>({})
  const [drillChecked, setDrillChecked] = useState(false)
  const [drillCategoryId, setDrillCategoryId] = useState<CategoryId | null>(null)
  const [drillStart, setDrillStart] = useState<number | null>(null)

  const startDrill = useCallback(() => {
    const cat: CategoryId | null =
      drillSelect === 'weakest'
        ? weakestCategoryId(state.categoryProgress, hasQuestions)
        : (drillSelect as CategoryId)
    if (!cat) {
      window.alert('No questions available. Generate questions in Setup first.')
      return
    }
    const pool = state.categories[cat].questions
    if (!pool.length) {
      window.alert('This category has no questions yet.')
      return
    }
    const batch = pickRandom(pool, 5)
    setDrillCategoryId(cat)
    setDrillBatch(batch)
    setDrillAnswers({})
    setDrillChecked(false)
    setDrillStart(Date.now())
  }, [drillSelect, state.categories, state.categoryProgress, hasQuestions])

  const submitDrillCheck = () => {
    if (!drillCategoryId || !drillBatch.length) return
    let correct = 0
    for (const q of drillBatch) {
      if (drillAnswers[q.id] === q.correct) correct++
    }
    setDrillChecked(true)
    const elapsed = drillStart ? Math.max(1, Math.round((Date.now() - drillStart) / 1000)) : 0
    addPracticeTime(elapsed)
    addQuestionsAnswered(drillBatch.length)
    recordDrillSession(drillCategoryId, correct, drillBatch.length)
  }

  // ── Mock state ────────────────────────────────────────────────────────────

  const [mockPhase, setMockPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [mockPaper, setMockPaper] = useState<McQuestion[]>([])
  const [mockIdx, setMockIdx] = useState(0)
  const [mockAnswers, setMockAnswers] = useState<Partial<Record<string, ChoiceKey>>>({})
  const [mockRemaining, setMockRemaining] = useState(MOCK_SECONDS)
  const [mockByCategory, setMockByCategory] = useState<
    Record<CategoryId, { correct: number; attempted: number }>
  >(() => {
    const z = {} as Record<CategoryId, { correct: number; attempted: number }>
    for (const c of CATEGORIES) z[c.id] = { correct: 0, attempted: 0 }
    return z
  })
  const [mockStart, setMockStart] = useState<number | null>(null)

  const mockPaperRef = useRef(mockPaper)
  const mockAnswersRef = useRef(mockAnswers)
  const mockStartRef = useRef(mockStart)
  const mockPhaseRef = useRef(mockPhase)
  const gradingDoneRef = useRef(false)

  useLayoutEffect(() => {
    mockPaperRef.current = mockPaper
    mockAnswersRef.current = mockAnswers
    mockStartRef.current = mockStart
    mockPhaseRef.current = mockPhase
  })

  const finalizeMock = useCallback(() => {
    if (gradingDoneRef.current) return
    const paper = mockPaperRef.current
    const answers = mockAnswersRef.current
    if (!paper.length || mockPhaseRef.current !== 'running') return
    gradingDoneRef.current = true

    const byCat = {} as Record<CategoryId, { correct: number; attempted: number }>
    for (const c of CATEGORIES) byCat[c.id] = { correct: 0, attempted: 0 }
    let totalCorrect = 0
    for (const q of paper) {
      const ok = answers[q.id] === q.correct
      if (ok) totalCorrect++
      const cid = q.categoryId
      byCat[cid].attempted++
      if (ok) byCat[cid].correct++
    }
    const total = paper.length
    const pct = total ? Math.round((totalCorrect / total) * 100) : 0
    setMockByCategory(byCat)
    recordMockResults(byCat)
    addQuestionsAnswered(total)
    const start = mockStartRef.current
    const elapsed = start ? Math.min(MOCK_SECONDS, Math.round((Date.now() - start) / 1000)) : 0
    addPracticeTime(elapsed)
    setMockHighScore(pct)
    setMockPhase('done')
  }, [recordMockResults, addQuestionsAnswered, addPracticeTime, setMockHighScore])

  const startMock = () => {
    const byCat = {} as Record<CategoryId, McQuestion[]>
    for (const c of CATEGORIES) byCat[c.id] = state.categories[c.id].questions
    const allHave = CATEGORIES.every((c) => byCat[c.id].length >= 3)
    if (!allHave) {
      window.alert(
        'You need at least 3 questions per category for a balanced mock. Generate more in Setup.',
      )
      return
    }
    gradingDoneRef.current = false
    const paper = buildMockPaper(byCat)
    setMockPaper(paper)
    setMockIdx(0)
    setMockAnswers({})
    setMockRemaining(MOCK_SECONDS)
    setMockPhase('running')
    setMockStart(Date.now())
    const empty = {} as Record<CategoryId, { correct: number; attempted: number }>
    for (const c of CATEGORIES) empty[c.id] = { correct: 0, attempted: 0 }
    setMockByCategory(empty)
  }

  useEffect(() => {
    if (mockPhase !== 'running') return
    const id = window.setInterval(() => {
      setMockRemaining((r) => (r <= 0 ? 0 : r - 1))
    }, 1000)
    return () => window.clearInterval(id)
  }, [mockPhase])

  useEffect(() => {
    if (mockPhase !== 'running' || mockRemaining > 0) return
    queueMicrotask(() => finalizeMock())
  }, [mockPhase, mockRemaining, finalizeMock])

  const currentMock = mockPaper[mockIdx]
  const mockProgress = mockPaper.length ? ((mockIdx + 1) / mockPaper.length) * 100 : 0

  // ── Adaptive state ────────────────────────────────────────────────────────

  const adaptiveUnlocked = isAdaptiveUnlocked(state.categoryProgress)

  const [adaptivePhase, setAdaptivePhase] = useState<
    'idle' | 'question' | 'answered' | 'checkpoint'
  >('idle')
  const [adaptiveQueue, setAdaptiveQueue] = useState<McQuestion[]>([])
  const [adaptiveQueueIdx, setAdaptiveQueueIdx] = useState(0)
  const [adaptiveSelected, setAdaptiveSelected] = useState<ChoiceKey | null>(null)
  const [adaptiveSessionTotal, setAdaptiveSessionTotal] = useState(0)
  const [adaptiveSessionStats, setAdaptiveSessionStats] =
    useState<AdaptiveStats>(emptyAdaptiveStats)

  const currentAdaptiveQ = adaptiveQueue[adaptiveQueueIdx] ?? null

  const startAdaptive = useCallback(() => {
    const pool = buildAdaptivePool(state.categories, state.categoryProgress)
    if (!pool.length) {
      window.alert('No questions available. Generate questions in Setup first.')
      return
    }
    setAdaptiveQueue(pool)
    setAdaptiveQueueIdx(0)
    setAdaptiveSelected(null)
    setAdaptiveSessionTotal(0)
    setAdaptiveSessionStats(emptyAdaptiveStats())
    setAdaptivePhase('question')
  }, [state.categories, state.categoryProgress])

  const submitAdaptiveAnswer = useCallback(() => {
    if (!adaptiveSelected || !currentAdaptiveQ) return
    const correct = adaptiveSelected === currentAdaptiveQ.correct
    const newTotal = adaptiveSessionTotal + 1
    setAdaptiveSessionTotal(newTotal)
    setAdaptiveSessionStats((prev) => ({
      ...prev,
      [currentAdaptiveQ.categoryId]: {
        attempted: prev[currentAdaptiveQ.categoryId].attempted + 1,
        correct: prev[currentAdaptiveQ.categoryId].correct + (correct ? 1 : 0),
      },
    }))
    recordDrillSession(currentAdaptiveQ.categoryId, correct ? 1 : 0, 1)
    addQuestionsAnswered(1)
    setAdaptivePhase('answered')
  }, [
    adaptiveSelected,
    currentAdaptiveQ,
    adaptiveSessionTotal,
    recordDrillSession,
    addQuestionsAnswered,
  ])

  const advanceAdaptiveQueue = useCallback(() => {
    const nextIdx = adaptiveQueueIdx + 1
    if (nextIdx >= adaptiveQueue.length) {
      const pool = buildAdaptivePool(state.categories, state.categoryProgress)
      setAdaptiveQueue(pool)
      setAdaptiveQueueIdx(0)
    } else {
      setAdaptiveQueueIdx(nextIdx)
    }
    setAdaptiveSelected(null)
    setAdaptivePhase('question')
  }, [adaptiveQueueIdx, adaptiveQueue.length, state.categories, state.categoryProgress])

  const nextAdaptiveQuestion = useCallback(() => {
    // adaptiveSessionTotal was already incremented in submitAdaptiveAnswer
    if (adaptiveSessionTotal % 5 === 0) {
      setAdaptivePhase('checkpoint')
      return
    }
    advanceAdaptiveQueue()
  }, [adaptiveSessionTotal, advanceAdaptiveQueue])

  // ── Cram Sheet state ──────────────────────────────────────────────────────

  const [cramContent, setCramContent] = useState<string | null>(null)
  const [cramLoading, setCramLoading] = useState(false)
  const [cramError, setCramError] = useState<string | null>(null)

  const generateCramSheet = useCallback(async () => {
    const key = state.apiKey.trim()
    if (!key) {
      window.alert('Add your Anthropic API key on the Setup screen first.')
      return
    }
    setCramLoading(true)
    setCramError(null)
    try {
      const categoriesText = CATEGORIES.map((c) => ({
        name: c.name,
        text: state.categories[c.id].extractedText,
      }))
      const result = await callClaude(
        key,
        buildCramSheetSystem(),
        buildCramSheetUser(categoriesText),
      )
      setCramContent(result.trim())
    } catch (e) {
      setCramError(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setCramLoading(false)
    }
  }, [state.apiKey, state.categories])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {cramLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[1px]">
          <LoadingPulse label="Generating cram sheet…" />
        </div>
      )}

      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between print:hidden">
        <div>
          <h2 className="text-2xl font-bold text-[#003366]">Practice</h2>
          <p className="mt-1 text-slate-600">
            Category drills, adaptive practice, or a full timed mock exam.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setPracticeMode('drill')}
            className={`rounded-md px-4 py-2 text-sm font-semibold ${
              practiceMode === 'drill' ? 'bg-[#003366] text-white' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            Category Drill
          </button>
          <button
            type="button"
            onClick={() => setPracticeMode('adaptive')}
            className={`rounded-md px-4 py-2 text-sm font-semibold ${
              practiceMode === 'adaptive'
                ? 'bg-[#003366] text-white'
                : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            Adaptive
          </button>
          <button
            type="button"
            onClick={() => setPracticeMode('mock')}
            className={`rounded-md px-4 py-2 text-sm font-semibold ${
              practiceMode === 'mock' ? 'bg-[#003366] text-white' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            Full Mock Test
          </button>
        </div>
      </header>

      {/* ── Category Drill ──────────────────────────────────────────────────── */}
      {practiceMode === 'drill' && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6 print:hidden">
          <div className="flex flex-col gap-4 md:flex-row md:items-end">
            <div className="flex-1">
              <label className="text-sm font-semibold text-slate-800">Category</label>
              <select
                value={drillSelect}
                onChange={(e) => setDrillSelect(e.target.value)}
                className="mt-2 w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-[#003366] focus:ring-2"
              >
                <option value="weakest">Weakest — auto pick</option>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={startDrill}
              className="rounded-lg bg-[#CC0000] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#b30000]"
            >
              Load 5 questions
            </button>
          </div>

          {drillBatch.length > 0 && (
            <div className="mt-8 space-y-6">
              {drillCategoryId && (
                <p className="text-sm text-slate-600">
                  Practicing:{' '}
                  <span className="font-semibold text-[#003366]">
                    {categoryName(drillCategoryId)}
                  </span>
                </p>
              )}
              {drillBatch.map((q, i) => (
                <div key={q.id} className="rounded-lg border border-slate-100 bg-slate-50/80 p-4">
                  <p className="font-medium text-slate-900">
                    {i + 1}. {q.question}
                  </p>
                  <div className="mt-3 space-y-2">
                    {(['A', 'B', 'C', 'D'] as const).map((k) => (
                      <label
                        key={k}
                        className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                          drillChecked
                            ? q.correct === k
                              ? 'border-emerald-400 bg-emerald-50'
                              : drillAnswers[q.id] === k && q.correct !== k
                                ? 'border-red-300 bg-red-50'
                                : 'border-slate-200 bg-white'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="radio"
                          className="mt-1"
                          name={q.id}
                          checked={drillAnswers[q.id] === k}
                          disabled={drillChecked}
                          onChange={() =>
                            setDrillAnswers((prev) => ({
                              ...prev,
                              [q.id]: k,
                            }))
                          }
                        />
                        <span>
                          <span className="font-semibold text-[#003366]">{k}.</span> {q.choices[k]}
                        </span>
                      </label>
                    ))}
                  </div>
                  {drillChecked && (
                    <p className="mt-3 text-sm text-slate-700">
                      <span className="font-semibold text-[#003366]">Explanation: </span>
                      {q.explanation}
                    </p>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap gap-3">
                {!drillChecked ? (
                  <button
                    type="button"
                    onClick={submitDrillCheck}
                    className="rounded-lg bg-[#003366] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#002952]"
                  >
                    Check Answers
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={startDrill}
                    className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    New set
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Adaptive Mode ───────────────────────────────────────────────────── */}
      {practiceMode === 'adaptive' && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6 print:hidden">
          {!adaptiveUnlocked ? (
            /* Locked — show per-category progress toward unlock */
            <div className="py-4 text-center">
              <p className="text-lg font-semibold text-slate-700">Adaptive Mode is locked</p>
              <p className="mt-2 text-sm text-slate-500">
                Answer at least{' '}
                <span className="font-semibold">{ADAPTIVE_MIN_ATTEMPTS}</span> questions in each of
                the 10 categories to unlock smart weighted practice.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {CATEGORIES.map((c) => {
                  const p = state.categoryProgress[c.id]
                  const done = p.attempted >= ADAPTIVE_MIN_ATTEMPTS
                  return (
                    <div
                      key={c.id}
                      className={`rounded-lg border px-3 py-2 text-center text-xs ${
                        done
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                          : 'border-slate-200 bg-slate-50 text-slate-600'
                      }`}
                    >
                      <div className="font-semibold">
                        {done ? '✓' : `${p.attempted}/${ADAPTIVE_MIN_ATTEMPTS}`}
                      </div>
                      <div className="mt-0.5 truncate">{c.name}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : adaptivePhase === 'idle' ? (
            /* Idle — show category weights and start button */
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-slate-900">Adaptive Practice</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Weak categories (&lt;70% accuracy) get 3× more questions. Strong ones (&gt;85%)
                  get 1×. A checkpoint card appears every 5 questions.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {CATEGORIES.map((c) => {
                    const p = state.categoryProgress[c.id]
                    const w = adaptiveWeight(p)
                    const pct = p.attempted ? Math.round((p.correct / p.attempted) * 100) : 0
                    const color =
                      w === 3
                        ? 'border-red-200 bg-red-50 text-red-800'
                        : w === 1
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                    return (
                      <span
                        key={c.id}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${color}`}
                      >
                        {c.name} — {pct}% · {w}×
                      </span>
                    )
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={startAdaptive}
                className="shrink-0 rounded-lg bg-[#CC0000] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#b30000]"
              >
                Start Adaptive Session
              </button>
            </div>
          ) : adaptivePhase === 'checkpoint' ? (
            /* Checkpoint card */
            <div className="rounded-xl border-2 border-[#003366] bg-[#003366]/5 p-6 text-center">
              <p className="text-2xl font-bold text-[#003366]">Checkpoint!</p>
              <p className="mt-3 text-base text-slate-700">
                You've answered{' '}
                <span className="font-bold text-[#003366]">{adaptiveSessionTotal}</span> questions.
              </p>
              {weakestInStats(adaptiveSessionStats) !== null ? (
                <p className="mt-1 text-base text-slate-700">
                  Your weakest area right now is{' '}
                  <span className="font-bold text-[#CC0000]">
                    {categoryName(weakestInStats(adaptiveSessionStats)!)}
                  </span>
                  . Keep going!
                </p>
              ) : (
                <p className="mt-1 text-base text-slate-700">Keep going — you're doing great!</p>
              )}
              <div className="mt-6 flex justify-center gap-3">
                <button
                  type="button"
                  onClick={advanceAdaptiveQueue}
                  className="rounded-lg bg-[#003366] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#002952]"
                >
                  Continue
                </button>
                <button
                  type="button"
                  onClick={() => setAdaptivePhase('idle')}
                  className="rounded-lg border border-slate-300 bg-white px-6 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  End Session
                </button>
              </div>
            </div>
          ) : currentAdaptiveQ ? (
            /* Question / answered view */
            <div>
              <div className="mb-4 flex items-center justify-between text-sm">
                <span className="font-medium text-slate-600">
                  Question{' '}
                  <span className="font-bold text-[#003366]">
                    {adaptivePhase === 'question' ? adaptiveSessionTotal + 1 : adaptiveSessionTotal}
                  </span>{' '}
                  in session
                </span>
                <span className="text-xs text-slate-400">
                  Next checkpoint at {Math.ceil((adaptiveSessionTotal + 1) / 5) * 5}
                </span>
              </div>

              <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#CC0000]">
                  {categoryName(currentAdaptiveQ.categoryId)}
                </p>
                <p className="mt-2 font-medium text-slate-900">{currentAdaptiveQ.question}</p>
                <div className="mt-4 space-y-2">
                  {(['A', 'B', 'C', 'D'] as const).map((k) => (
                    <label
                      key={k}
                      className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                        adaptivePhase === 'answered'
                          ? currentAdaptiveQ.correct === k
                            ? 'border-emerald-400 bg-emerald-50'
                            : adaptiveSelected === k && currentAdaptiveQ.correct !== k
                              ? 'border-red-300 bg-red-50'
                              : 'border-slate-200 bg-white'
                          : adaptiveSelected === k
                            ? 'border-[#003366] bg-blue-50'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        className="mt-1"
                        name="adaptive-q"
                        value={k}
                        checked={adaptiveSelected === k}
                        disabled={adaptivePhase === 'answered'}
                        onChange={() => setAdaptiveSelected(k)}
                      />
                      <span>
                        <span className="font-semibold text-[#003366]">{k}.</span>{' '}
                        {currentAdaptiveQ.choices[k]}
                      </span>
                    </label>
                  ))}
                </div>
                {adaptivePhase === 'answered' && (
                  <p className="mt-3 text-sm text-slate-700">
                    <span className="font-semibold text-[#003366]">Explanation: </span>
                    {currentAdaptiveQ.explanation}
                  </p>
                )}
              </div>

              <div className="mt-4 flex gap-3">
                {adaptivePhase === 'question' ? (
                  <button
                    type="button"
                    onClick={submitAdaptiveAnswer}
                    disabled={!adaptiveSelected}
                    className="rounded-lg bg-[#003366] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#002952] disabled:opacity-40"
                  >
                    Submit Answer
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={nextAdaptiveQuestion}
                    className="rounded-lg bg-[#003366] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#002952]"
                  >
                    Next Question
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAdaptivePhase('idle')}
                  className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  End Session
                </button>
              </div>
            </div>
          ) : null}
        </section>
      )}

      {/* ── Full Mock Test ──────────────────────────────────────────────────── */}
      {practiceMode === 'mock' && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6 print:hidden">
          {mockPhase === 'idle' && (
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Full mock test</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {MOCK_TOTAL} questions (3–4 per category), {MOCK_SECONDS / 60} minutes, no
                  feedback until the end.
                </p>
              </div>
              <button
                type="button"
                onClick={startMock}
                className="rounded-lg bg-[#CC0000] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#b30000]"
              >
                Start Mock Test
              </button>
            </div>
          )}

          {mockPhase === 'running' && currentMock && (
            <div>
              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-[#003366] transition-all duration-300"
                    style={{ width: `${mockProgress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <span className="text-sm font-medium text-slate-700">
                    Question {mockIdx + 1} of {mockPaper.length}
                  </span>
                  <span className="rounded-lg bg-[#003366] px-3 py-1.5 font-mono text-sm font-bold text-white tabular-nums">
                    {formatTime(mockRemaining)}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-4">
                <p className="font-medium text-slate-900">{currentMock.question}</p>
                <p className="mt-1 text-xs text-slate-500">{categoryName(currentMock.categoryId)}</p>
                <div className="mt-4 space-y-2">
                  {(['A', 'B', 'C', 'D'] as const).map((k) => (
                    <label
                      key={k}
                      className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
                    >
                      <input
                        type="radio"
                        className="mt-1"
                        name={currentMock.id}
                        checked={mockAnswers[currentMock.id] === k}
                        onChange={() =>
                          setMockAnswers((prev) => ({
                            ...prev,
                            [currentMock.id]: k,
                          }))
                        }
                      />
                      <span>
                        <span className="font-semibold text-[#003366]">{k}.</span>{' '}
                        {currentMock.choices[k]}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap justify-between gap-3">
                <button
                  type="button"
                  disabled={mockIdx === 0}
                  onClick={() => setMockIdx((i) => Math.max(0, i - 1))}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-40"
                >
                  Previous
                </button>
                {mockIdx < mockPaper.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setMockIdx((i) => i + 1)}
                    className="rounded-lg bg-[#003366] px-5 py-2 text-sm font-semibold text-white hover:bg-[#002952]"
                  >
                    Next
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => finalizeMock()}
                    className="rounded-lg bg-[#CC0000] px-5 py-2 text-sm font-semibold text-white hover:bg-[#b30000]"
                  >
                    Submit test
                  </button>
                )}
              </div>
            </div>
          )}

          {mockPhase === 'done' && (
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Results</h3>
              <p className="mt-2 text-slate-700">
                Overall:{' '}
                {(() => {
                  let c = 0
                  let t = 0
                  for (const q of mockPaper) {
                    t++
                    if (mockAnswers[q.id] === q.correct) c++
                  }
                  return (
                    <span className="font-bold text-[#003366]">
                      {c}/{t} ({t ? Math.round((c / t) * 100) : 0}%)
                    </span>
                  )
                })()}
              </p>
              <MockResultsChart byCategory={mockByCategory} />
              <button
                type="button"
                onClick={() => {
                  setMockPhase('idle')
                  setMockPaper([])
                  setMockIdx(0)
                  setMockAnswers({})
                }}
                className="mt-6 rounded-lg bg-[#003366] px-5 py-2.5 text-sm font-semibold text-white"
              >
                Back to start
              </button>
            </div>
          )}
        </section>
      )}

      {/* ── Cram Sheet Generator ────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6 print:shadow-none">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between print:hidden">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Cram Sheet Generator</h3>
            <p className="mt-1 text-sm text-slate-500">
              Claude reads all 10 categories' PDF content and produces a 1-page bullet-point cheat
              sheet of the most testable facts.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void generateCramSheet()}
            disabled={cramLoading}
            className="shrink-0 rounded-lg bg-[#CC0000] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#b30000] disabled:opacity-50"
          >
            Generate Cram Sheet
          </button>
        </div>

        {cramError && (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 print:hidden">
            <span className="flex-1">{cramError}</span>
            <button
              type="button"
              onClick={() => setCramError(null)}
              className="rounded-md bg-white px-3 py-1.5 text-red-700 ring-1 ring-red-200"
            >
              Dismiss
            </button>
          </div>
        )}

        {cramContent && (
          <div className="mt-6">
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm leading-relaxed text-slate-800 whitespace-pre-wrap print:border-none print:p-0 print:text-base">
              {cramContent}
            </div>
            <div className="mt-4 flex gap-3 print:hidden">
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-lg bg-[#003366] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#002952]"
              >
                Print
              </button>
              <button
                type="button"
                onClick={() => setCramContent(null)}
                className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
