import { useCallback, useState } from 'react'
import { CATEGORIES, type CategoryId } from '../constants'
import { useTrainer } from '../context/TrainerContext'
import { LoadingPulse } from '../components/LoadingPulse'
import { EssayCoachScreen } from './EssayCoachScreen'
import type { ChoiceKey, McQuestion, PersistedState } from '../types'
import { pickRandom, shuffleInPlace } from '../utils/shuffle'
import { categoryName } from '../prompts'

const ADAPTIVE_MIN_ATTEMPTS = 10

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

// ── PracticeScreen ────────────────────────────────────────────────────────────

export function PracticeScreen() {
  const {
    state,
    recordDrillSession,
    addPracticeTime,
    addQuestionsAnswered,
  } = useTrainer()

  const [practiceMode, setPracticeMode] = useState<'drill' | 'adaptive' | 'essay'>('drill')

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
  const [drillCount, setDrillCount] = useState(5)
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
    const batch = pickRandom(pool, drillCount)
    setDrillCategoryId(cat)
    setDrillBatch(batch)
    setDrillAnswers({})
    setDrillChecked(false)
    setDrillStart(Date.now())
  }, [drillSelect, drillCount, state.categories, state.categoryProgress, hasQuestions])

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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between print:hidden">
        <div>
          <h2 className="text-2xl font-bold text-[#003366]">Practice</h2>
          <p className="mt-1 text-slate-600">
            Category drills, adaptive practice, or essay coaching.
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
            onClick={() => setPracticeMode('essay')}
            className={`rounded-md px-4 py-2 text-sm font-semibold ${
              practiceMode === 'essay' ? 'bg-[#003366] text-white' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            Essay Coach
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
            <div>
              <label className="text-sm font-semibold text-slate-800">Questions</label>
              <select
                value={drillCount}
                onChange={(e) => setDrillCount(Number(e.target.value))}
                className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-[#003366] focus:ring-2"
              >
                {[5, 10, 15, 20].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={startDrill}
              className="rounded-lg bg-[#CC0000] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#b30000]"
            >
              Load {drillCount} questions
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
                    <div className="mt-3 text-sm text-slate-700">
                      <p>
                        <span className="font-semibold text-[#003366]">Explanation: </span>
                        {q.explanation}
                      </p>
                      {q.source && (
                        <p className="mt-1 text-xs text-slate-500">
                          <span className="font-semibold">Source: </span>
                          {q.source}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap gap-3">
                {!drillChecked ? (
                  <>
                    <button
                      type="button"
                      onClick={submitDrillCheck}
                      className="rounded-lg bg-[#003366] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#002952]"
                    >
                      Check Answers
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDrillBatch([])
                        setDrillAnswers({})
                        setDrillChecked(false)
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </>
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
                  <div className="mt-3 text-sm text-slate-700">
                    <p>
                      <span className="font-semibold text-[#003366]">Explanation: </span>
                      {currentAdaptiveQ.explanation}
                    </p>
                    {currentAdaptiveQ.source && (
                      <p className="mt-1 text-xs text-slate-500">
                        <span className="font-semibold">Source: </span>
                        {currentAdaptiveQ.source}
                      </p>
                    )}
                  </div>
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

      {/* ── Essay Coach ──────────────────────────────────────────────────────── */}
      {practiceMode === 'essay' && <EssayCoachScreen />}

    </div>
  )
}
