import { useCallback, useRef, useState, type ChangeEvent } from 'react'
import { CATEGORIES, type CategoryId } from '../constants'
import { useTrainer } from '../context/TrainerContext'
import { LoadingPulse } from '../components/LoadingPulse'
import { buildQuestionGenerationSystem, buildQuestionGenerationUser, categoryName } from '../prompts'
import { callClaude, parseJsonArray } from '../utils/anthropic'
import { extractTextFromPdfFiles } from '../utils/pdf'
import { truncateMiddle } from '../utils/truncate'
import { normalizeImportedQuestions } from '../storage'
import type { CategoryContentStatus } from '../types'

function StatusDot({ status }: { status: CategoryContentStatus }) {
  const color =
    status === 'generated'
      ? 'bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.35)]'
      : status === 'loaded'
        ? 'bg-amber-400 shadow-[0_0_0_2px_rgba(251,191,36,0.35)]'
        : 'bg-slate-300'
  return (
    <span
      className={`inline-block h-3 w-3 rounded-full ${color}`}
      title={status === 'generated' ? 'Questions generated' : status === 'loaded' ? 'PDF loaded' : 'No content'}
    />
  )
}

export function SetupScreen() {
  const {
    state,
    setCategoryData,
    setQuestionsForCategory,
  } = useTrainer()
  const [extractingId, setExtractingId] = useState<CategoryId | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genLabel, setGenLabel] = useState('')
  const [genMoreCatIds, setGenMoreCatIds] = useState<Set<CategoryId>>(new Set())
  const [regenCatIds, setRegenCatIds] = useState<Set<CategoryId>>(new Set())
  const [purgeConfirmId, setPurgeConfirmId] = useState<CategoryId | null>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const importRef = useRef<HTMLInputElement | null>(null)

  const onPickFiles = useCallback(
    async (catId: CategoryId, files: FileList | null) => {
      if (!files?.length) return
      const list = Array.from(files).filter((f) => f.name.toLowerCase().endsWith('.pdf'))
      if (!list.length) return
      setExtractingId(catId)
      setGenError(null)
      try {
        const { fullText, pageCount } = await extractTextFromPdfFiles(list)
        setCategoryData(catId, {
          extractedText: fullText,
          pageCount,
          questions: [],
          status: pageCount > 0 || fullText.length > 0 ? 'loaded' : 'empty',
        })
      } catch (e) {
        setGenError(e instanceof Error ? e.message : 'PDF extraction failed.')
      } finally {
        setExtractingId(null)
      }
    },
    [setCategoryData],
  )

  const runGenerateAll = async () => {
    const key = state.apiKey.trim()
    if (!key) {
      setGenError('Please enter your Anthropic API key first.')
      return
    }
    const targets = CATEGORIES.filter(
      (c) => state.categories[c.id].extractedText.trim().length > 0,
    )
    if (!targets.length) {
      setGenError('Upload at least one PDF chapter for a category first.')
      return
    }
    setGenError(null)
    setGenerating(true)
    setGenLabel(`Generating questions for ${targets.length} categor${targets.length === 1 ? 'y' : 'ies'} concurrently… (60 questions each)`)
    try {
      const results = await Promise.allSettled(
        targets.map(async (c) => {
          const text = truncateMiddle(state.categories[c.id].extractedText, 10000)
          const system = buildQuestionGenerationSystem(c.id, 60)
          const userMsg = buildQuestionGenerationUser(c.id, text)
          const raw = await callClaude(key, system, userMsg)
          const parsed = parseJsonArray<{
            question: string
            choices: { A: string; B: string; C: string; D: string }
            correct: string
            explanation: string
          }>(raw)
          const normalized = normalizeImportedQuestions(parsed, c.id)
          setQuestionsForCategory(c.id, normalized)
        }),
      )
      const failures = results
        .map((r, i) => (r.status === 'rejected' ? `${categoryName(targets[i].id)}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}` : null))
        .filter(Boolean)
      if (failures.length) {
        setGenError(`Failed for: ${failures.join(' | ')}`)
      }
      setGenLabel('')
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Generation failed.')
    } finally {
      setGenerating(false)
      setGenLabel('')
    }
  }

  const runGenerateMore = async (catId: CategoryId) => {
    const key = state.apiKey.trim()
    if (!key) {
      setGenError('Please enter your Anthropic API key first.')
      return
    }
    setGenError(null)
    setGenMoreCatIds((prev) => new Set([...prev, catId]))
    try {
      const text = truncateMiddle(state.categories[catId].extractedText, 10000)
      const existing = state.categories[catId].questions.map((q) => q.question)
      const system = buildQuestionGenerationSystem(catId, 30)
      const userMsg = buildQuestionGenerationUser(catId, text, existing)
      const raw = await callClaude(key, system, userMsg)
      const parsed = parseJsonArray<{
        question: string
        choices: { A: string; B: string; C: string; D: string }
        correct: string
        explanation: string
      }>(raw)
      const normalized = normalizeImportedQuestions(parsed, catId)
      const merged = [...state.categories[catId].questions, ...normalized]
      setQuestionsForCategory(catId, merged)
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Generation failed.')
    } finally {
      setGenMoreCatIds((prev) => { const next = new Set(prev); next.delete(catId); return next })
    }
  }

  const purgeCategory = (catId: CategoryId) => {
    setQuestionsForCategory(catId, [])
    setPurgeConfirmId(null)
  }

  const runRegenerateCategory = async (catId: CategoryId) => {
    const key = state.apiKey.trim()
    if (!key) {
      setGenError('Please enter your Anthropic API key first.')
      return
    }
    setGenError(null)
    setRegenCatIds((prev) => new Set([...prev, catId]))
    try {
      const text = truncateMiddle(state.categories[catId].extractedText, 10000)
      const system = buildQuestionGenerationSystem(catId, 60)
      const userMsg = buildQuestionGenerationUser(catId, text)
      const raw = await callClaude(key, system, userMsg)
      const parsed = parseJsonArray<{
        question: string
        choices: { A: string; B: string; C: string; D: string }
        correct: string
        explanation: string
      }>(raw)
      const normalized = normalizeImportedQuestions(parsed, catId)
      setQuestionsForCategory(catId, normalized)
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Regeneration failed.')
    } finally {
      setRegenCatIds((prev) => { const next = new Set(prev); next.delete(catId); return next })
    }
  }

  const exportQuestions = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      questions: Object.fromEntries(
        CATEGORIES.map((c) => [c.id, state.categories[c.id].questions]),
      ),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hce-questions-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // reset so the same file can be re-imported if needed
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as {
          version?: number
          questions?: Record<string, unknown[]>
        }
        if (!data.questions || typeof data.questions !== 'object') {
          throw new Error('Unrecognised file format — missing "questions" key.')
        }
        let total = 0
        for (const c of CATEGORIES) {
          const qs = data.questions[c.id]
          if (Array.isArray(qs) && qs.length > 0) {
            // reuse the same normalizer so IDs are stable
            const normalised = normalizeImportedQuestions(
              qs as Parameters<typeof normalizeImportedQuestions>[0],
              c.id,
            )
            setQuestionsForCategory(c.id, normalised)
            total += normalised.length
          }
        }
        setImportMsg(`Imported ${total} questions across all categories.`)
        setGenError(null)
      } catch (err) {
        setGenError(err instanceof Error ? err.message : 'Import failed.')
        setImportMsg(null)
      }
    }
    reader.readAsText(file)
  }

  const totalQuestions = CATEGORIES.reduce(
    (sum, c) => sum + state.categories[c.id].questions.length,
    0,
  )

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-2xl font-bold text-[#003366]">Setup</h2>
        <p className="mt-1 text-slate-600">
          Save your API key, upload textbook PDFs by category, then generate practice questions.
        </p>
      </header>

      {/* ── Transfer / Offline section ─────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <h3 className="text-sm font-semibold text-slate-800">Transfer question bank</h3>
        <p className="mt-1 text-xs text-slate-500">
          Generate on one machine, export a JSON file, AirDrop/copy it to another device, then
          import — no re-generation needed. Practice mode works fully offline once imported.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={exportQuestions}
            disabled={totalQuestions === 0}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            Export questions
            {totalQuestions > 0 && (
              <span className="ml-2 rounded-full bg-emerald-500 px-2 py-0.5 text-xs">
                {totalQuestions}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Import questions
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
        {importMsg && (
          <p className="mt-3 text-sm font-medium text-emerald-700">{importMsg}</p>
        )}
      </section>

      {generating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[1px]">
          <LoadingPulse label={genLabel || 'Working with Claude…'} />
        </div>
      )}

      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-semibold text-slate-800">HCE categories</h3>
        <button
          type="button"
          onClick={runGenerateAll}
          disabled={generating}
          className="rounded-lg bg-[#CC0000] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#b30000] disabled:opacity-50"
        >
          Generate All Questions (60 per category)
        </button>
      </section>

      {genError && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="flex-1">{genError}</span>
          <button
            type="button"
            className="rounded-md bg-white px-3 py-1.5 text-red-700 ring-1 ring-red-200 hover:bg-red-50"
            onClick={() => void runGenerateAll()}
          >
            Retry
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CATEGORIES.map((c) => {
          const cat = state.categories[c.id]
          const busy = extractingId === c.id
          const genMoreBusy = genMoreCatIds.has(c.id)
          const regenBusy = regenCatIds.has(c.id)
          const qCount = cat.questions.length
          return (
            <div
              key={c.id}
              className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-semibold text-[#003366]">{c.name}</h4>
                <StatusDot status={cat.status} />
              </div>
              <input
                ref={(el) => {
                  inputRefs.current[c.id] = el
                }}
                type="file"
                accept=".pdf,application/pdf"
                multiple
                className="hidden"
                onChange={(e) => void onPickFiles(c.id, e.target.files)}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => inputRefs.current[c.id]?.click()}
                className="mt-3 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60"
              >
                {busy ? 'Extracting…' : 'Upload PDF chapters'}
              </button>
              <p className="mt-3 text-xs text-slate-600">
                {cat.pageCount > 0 ? (
                  <>
                    <span className="font-medium text-slate-800">{cat.pageCount}</span> pages loaded
                  </>
                ) : (
                  'No PDF content yet'
                )}
              </p>
              {qCount > 0 && (
                <p className="mt-1 text-xs font-medium text-emerald-700">
                  {qCount} question{qCount !== 1 ? 's' : ''} saved
                </p>
              )}
              {busy && (
                <div className="mt-2 flex items-center gap-2 text-xs text-[#003366]">
                  <span className="inline-block h-4 w-4 animate-pulse-api rounded-full border-2 border-[#003366] border-t-transparent" />
                  Extracting text…
                </div>
              )}
              {cat.pageCount > 0 && (
                <button
                  type="button"
                  disabled={genMoreBusy || generating || regenBusy}
                  onClick={() => void runGenerateMore(c.id)}
                  className="mt-3 rounded-lg border border-[#003366] bg-white px-3 py-2 text-xs font-semibold text-[#003366] hover:bg-slate-50 disabled:opacity-50"
                >
                  {genMoreBusy ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block h-3 w-3 animate-pulse-api rounded-full border-2 border-[#003366] border-t-transparent" />
                      Generating…
                    </span>
                  ) : (
                    '+ Generate 30 more'
                  )}
                </button>
              )}
              {qCount > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-3 space-y-2">
                  {purgeConfirmId === c.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-600">Delete all {qCount} questions?</span>
                      <button
                        type="button"
                        onClick={() => purgeCategory(c.id)}
                        className="rounded px-2 py-1 text-xs font-semibold text-white bg-red-600 hover:bg-red-700"
                      >
                        Yes, delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setPurgeConfirmId(null)}
                        className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={regenBusy || genMoreBusy || generating}
                      onClick={() => setPurgeConfirmId(c.id)}
                      className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Purge questions
                    </button>
                  )}
                  {cat.extractedText.trim().length > 0 && (
                    <button
                      type="button"
                      disabled={regenBusy || genMoreBusy || generating}
                      onClick={() => void runRegenerateCategory(c.id)}
                      className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                    >
                      {regenBusy ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="inline-block h-3 w-3 animate-pulse-api rounded-full border-2 border-amber-700 border-t-transparent" />
                          Regenerating…
                        </span>
                      ) : (
                        'Purge & regenerate 60 questions'
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
