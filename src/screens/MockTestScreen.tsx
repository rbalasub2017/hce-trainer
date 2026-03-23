import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { CATEGORIES, DEFAULT_ESSAY_PROMPT, type CategoryId } from '../constants'
import { useTrainer } from '../context/TrainerContext'
import type { ChoiceKey, McQuestion, PersistedState } from '../types'
import { pickRandom, shuffleInPlace } from '../utils/shuffle'
import { categoryName } from '../prompts'

const MOCK_SECONDS = 60 * 60       // 60 min — HOSA SLC standard (MC + essay)
const MOCK_TOTAL = 35               // 35 MC questions
const TOUGH_MOCK_SECONDS = 45 * 60  // 45 min — tougher training
const TOUGH_MOCK_TOTAL = 40         // 40 questions — tougher training

function mockDistribution(total: number): number[] {
  const base = Math.floor(total / 10)
  const counts = Array.from({ length: 10 }, () => base)
  const extra = total - base * 10
  const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
  shuffleInPlace(order)
  for (let i = 0; i < extra; i++) counts[order[i]!] += 1
  return counts
}

function buildMockPaper(byCategory: Record<CategoryId, McQuestion[]>, total: number): McQuestion[] {
  const dist = mockDistribution(total)
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

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

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

type Phase = 'idle' | 'active' | 'done'
type View = 'mc' | 'essay'

export function MockTestScreen() {
  const {
    state,
    recordMockResults,
    addPracticeTime,
    addQuestionsAnswered,
    setMockHighScore,
    addMockTestRun,
  } = useTrainer()

  const [toughMode, setToughMode] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [view, setView] = useState<View>('mc')

  // ── MC state ──────────────────────────────────────────────────────────────
  const [mockPaper, setMockPaper] = useState<McQuestion[]>([])
  const [mockIdx, setMockIdx] = useState(0)
  const [mockAnswers, setMockAnswers] = useState<Partial<Record<string, ChoiceKey>>>({})
  const [mockByCategory, setMockByCategory] = useState<
    Record<CategoryId, { correct: number; attempted: number }>
  >(() => {
    const z = {} as Record<CategoryId, { correct: number; attempted: number }>
    for (const c of CATEGORIES) z[c.id] = { correct: 0, attempted: 0 }
    return z
  })

  // ── Shared timer ──────────────────────────────────────────────────────────
  const [remaining, setRemaining] = useState(MOCK_SECONDS)
  const [startTime, setStartTime] = useState<number | null>(null)

  // ── Essay state ───────────────────────────────────────────────────────────
  const [essayDraft, setEssayDraft] = useState('')
  const [essayPrompt] = useState(state.essayPrompt.trim() || DEFAULT_ESSAY_PROMPT)
  const [uploadedImage, setUploadedImage] = useState<{ base64: string; mediaType: string; preview: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Refs for finalize ─────────────────────────────────────────────────────
  const paperRef = useRef(mockPaper)
  const answersRef = useRef(mockAnswers)
  const startRef = useRef(startTime)
  const essayDraftRef = useRef(essayDraft)
  const gradingDoneRef = useRef(false)

  useLayoutEffect(() => {
    paperRef.current = mockPaper
    answersRef.current = mockAnswers
    startRef.current = startTime
    essayDraftRef.current = essayDraft
  })

  const finalize = useCallback(() => {
    if (gradingDoneRef.current) return
    const paper = paperRef.current
    const answers = answersRef.current
    if (!paper.length) return
    gradingDoneRef.current = true

    const byCat = {} as Record<CategoryId, { correct: number; attempted: number }>
    for (const c of CATEGORIES) byCat[c.id] = { correct: 0, attempted: 0 }
    let totalCorrect = 0
    for (const q of paper) {
      const ok = answers[q.id] === q.correct
      if (ok) totalCorrect++
      byCat[q.categoryId].attempted++
      if (ok) byCat[q.categoryId].correct++
    }
    const total = paper.length
    const pct = total ? Math.round((totalCorrect / total) * 100) : 0
    setMockByCategory(byCat)
    recordMockResults(byCat)
    addQuestionsAnswered(total)
    const maxSec = paper.length > MOCK_TOTAL ? TOUGH_MOCK_SECONDS : MOCK_SECONDS
    const elapsed = startRef.current
      ? Math.min(maxSec, Math.round((Date.now() - startRef.current) / 1000))
      : 0
    addPracticeTime(elapsed)
    setMockHighScore(pct)
    addMockTestRun({ date: new Date().toISOString(), score: pct, correct: totalCorrect, total })
    setPhase('done')
  }, [recordMockResults, addQuestionsAnswered, addPracticeTime, setMockHighScore, addMockTestRun])

  // ── Timer ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'active') return
    const id = window.setInterval(() => {
      setRemaining((r) => (r <= 0 ? 0 : r - 1))
    }, 1000)
    return () => window.clearInterval(id)
  }, [phase])

  useEffect(() => {
    if (phase !== 'active' || remaining > 0) return
    queueMicrotask(() => finalize())
  }, [phase, remaining, finalize])

  // ── Handwritten upload ────────────────────────────────────────────────────
  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const [header, base64] = dataUrl.split(',')
      const mediaType = header.replace('data:', '').replace(';base64', '')
      setUploadedImage({ base64, mediaType, preview: dataUrl })
    }
    reader.readAsDataURL(file)
  }

  const clearImage = () => {
    setUploadedImage(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  const startMock = () => {
    const total = toughMode ? TOUGH_MOCK_TOTAL : MOCK_TOTAL
    const seconds = toughMode ? TOUGH_MOCK_SECONDS : MOCK_SECONDS
    const minPerCat = toughMode ? 4 : 3
    const byCat = {} as Record<CategoryId, McQuestion[]>
    for (const c of CATEGORIES) byCat[c.id] = state.categories[c.id].questions
    const allHave = CATEGORIES.every((c) => byCat[c.id].length >= minPerCat)
    if (!allHave) {
      window.alert(
        `You need at least ${minPerCat} questions per category. Generate more in Setup.`,
      )
      return
    }
    gradingDoneRef.current = false
    const paper = buildMockPaper(byCat, total)
    setMockPaper(paper)
    setMockIdx(0)
    setMockAnswers({})
    setRemaining(seconds)
    setStartTime(Date.now())
    const empty = {} as Record<CategoryId, { correct: number; attempted: number }>
    for (const c of CATEGORIES) empty[c.id] = { correct: 0, attempted: 0 }
    setMockByCategory(empty)
    setEssayDraft('')
    setUploadedImage(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setView('mc')
    setPhase('active')
  }

  const reset = () => {
    setPhase('idle')
    setMockPaper([])
    setMockIdx(0)
    setMockAnswers({})
    gradingDoneRef.current = false
  }

  const currentMock = mockPaper[mockIdx]
  const mockProgress = mockPaper.length ? ((mockIdx + 1) / mockPaper.length) * 100 : 0
  const answeredCount = Object.keys(mockAnswers).length

  const timerColor =
    remaining <= 120
      ? 'animate-pulse bg-[#CC0000]'
      : remaining <= 300
        ? 'bg-amber-500'
        : 'bg-[#003366]'

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#003366]">Full Mock Test</h2>
          <p className="mt-1 text-slate-600">
            {toughMode ? TOUGH_MOCK_TOTAL : MOCK_TOTAL} multiple-choice questions + essay,{' '}
            {toughMode ? TOUGH_MOCK_SECONDS / 60 : MOCK_SECONDS / 60} minutes total — matches HOSA
            SLC format.
          </p>
        </div>
        {phase === 'active' && (
          <span
            className={`self-start rounded-lg px-4 py-2 font-mono text-sm font-bold text-white tabular-nums ${timerColor}`}
          >
            {formatTime(remaining)}
          </span>
        )}
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        {/* ── Idle ──────────────────────────────────────────────────────── */}
        {phase === 'idle' && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Ready to begin?</h3>
                <p className="mt-1 text-sm text-slate-600">
                  The test has two parts: {toughMode ? TOUGH_MOCK_TOTAL : MOCK_TOTAL} multiple-choice
                  questions and a timed essay. Both share the{' '}
                  {toughMode ? TOUGH_MOCK_SECONDS / 60 : MOCK_SECONDS / 60}-minute clock. You can
                  switch between them at any time — your answers are never lost.
                </p>
                {!toughMode && (
                  <p className="mt-1 text-xs text-slate-400">
                    Matches official HOSA SLC format (35 MC + essay / 60 min).
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={startMock}
                className="shrink-0 rounded-lg bg-[#CC0000] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#b30000]"
              >
                Start Mock Test
              </button>
            </div>

            {/* Tough Mode toggle */}
            <div
              className={`flex items-start gap-4 rounded-xl border p-4 transition-colors ${
                toughMode ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <button
                type="button"
                role="switch"
                aria-checked={toughMode}
                onClick={() => setToughMode((v) => !v)}
                className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                  toughMode ? 'border-amber-500 bg-amber-500' : 'border-slate-300 bg-white'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    toughMode ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Tough Mode{' '}
                  {toughMode && (
                    <span className="ml-1 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
                      ON
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {TOUGH_MOCK_TOTAL} questions · {TOUGH_MOCK_SECONDS / 60} minutes — trains you
                  under harder constraints than the real test so the actual SLC feels easier.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Active (MC + Essay with switcher) ─────────────────────────── */}
        {phase === 'active' && (
          <div className="space-y-5">
            {/* Tab switcher */}
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setView('mc')}
                  className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
                    view === 'mc'
                      ? 'bg-[#003366] text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Multiple Choice
                  <span
                    className={`ml-2 rounded-full px-1.5 py-0.5 text-xs font-bold ${
                      view === 'mc' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {answeredCount}/{mockPaper.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setView('essay')}
                  className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
                    view === 'essay'
                      ? 'bg-[#003366] text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Essay
                  {(essayDraft.trim() || uploadedImage) && (
                    <span
                      className={`ml-2 inline-block h-2 w-2 rounded-full ${
                        view === 'essay' ? 'bg-emerald-300' : 'bg-emerald-500'
                      }`}
                    />
                  )}
                </button>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Abandon this test? Your progress will not be saved.')) {
                      reset()
                    }
                  }}
                  className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  Abandon
                </button>
                <button
                  type="button"
                  onClick={finalize}
                  className="rounded-lg bg-[#CC0000] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#b30000]"
                >
                  Submit Test
                </button>
              </div>
            </div>

            {/* ── MC view ─────────────────────────────────────────────── */}
            {view === 'mc' && currentMock && (
              <div>
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-[#003366] transition-all duration-300"
                      style={{ width: `${mockProgress}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-slate-700 sm:ml-4">
                    Question {mockIdx + 1} of {mockPaper.length}
                  </span>
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
                            setMockAnswers((prev) => ({ ...prev, [currentMock.id]: k }))
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

                <div className="mt-4 flex justify-between gap-3">
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
                      onClick={() => setView('essay')}
                      className="rounded-lg bg-[#003366] px-5 py-2 text-sm font-semibold text-white hover:bg-[#002952]"
                    >
                      Go to Essay
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── Essay view ──────────────────────────────────────────── */}
            {view === 'essay' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-[#003366]/20 bg-[#003366]/5 p-4">
                  <p className="text-sm font-semibold text-[#003366]">Essay Prompt</p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-800">{essayPrompt}</p>
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-slate-800">Your essay</label>
                  <span className="text-xs text-slate-500">Type below <span className="mx-1 font-bold">or</span> upload a photo of your handwritten essay</span>
                </div>

                {/* Handwritten upload */}
                <div>
                  {uploadedImage ? (
                    <div className="relative rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <img src={uploadedImage.preview} alt="Uploaded handwritten essay" className="max-h-64 w-full rounded object-contain" />
                      <button
                        type="button"
                        onClick={clearImage}
                        className="absolute right-2 top-2 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 shadow ring-1 ring-slate-200 hover:bg-red-50 hover:text-red-700"
                      >
                        Remove
                      </button>
                      <p className="mt-2 text-center text-xs text-slate-500">Handwritten essay uploaded — Claude will read and grade it, including legibility.</p>
                    </div>
                  ) : (
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 hover:border-[#003366] hover:bg-slate-100">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                      <span>Upload a photo of your handwritten essay <span className="text-slate-400">(JPG, PNG, HEIC)</span></span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={handleImageUpload}
                      />
                    </label>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-xs font-medium text-slate-400">or type your essay</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                <textarea
                  value={essayDraft}
                  onChange={(e) => { setEssayDraft(e.target.value); if (e.target.value) clearImage() }}
                  placeholder="Write your essay here…"
                  rows={14}
                  disabled={!!uploadedImage}
                  className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm leading-relaxed outline-none ring-[#003366] focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
            )}
          </div>
        )}

        {/* ── Done ──────────────────────────────────────────────────────── */}
        {phase === 'done' && (
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Results</h3>
            <p className="mt-2 text-slate-700">
              Multiple Choice:{' '}
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

            {uploadedImage ? (
              <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
                <h4 className="font-semibold text-[#003366]">Your Essay</h4>
                <p className="mt-1 text-xs text-slate-500">{essayPrompt}</p>
                <img src={uploadedImage.preview} alt="Submitted handwritten essay" className="mt-3 max-h-96 w-full rounded object-contain" />
                <p className="mt-2 text-center text-xs text-slate-500">Handwritten essay — includes legibility in scoring.</p>
              </div>
            ) : essayDraft.trim() ? (
              <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
                <h4 className="font-semibold text-[#003366]">Your Essay</h4>
                <p className="mt-1 text-xs text-slate-500">{essayPrompt}</p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                  {essayDraft}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm italic text-slate-500">No essay was submitted.</p>
            )}

            <button
              type="button"
              onClick={reset}
              className="mt-6 rounded-lg bg-[#003366] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#002952]"
            >
              Back to start
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
