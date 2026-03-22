import { useCallback, useRef, useState } from 'react'
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
    setApiKey,
    setCategoryData,
    setQuestionsForCategory,
  } = useTrainer()
  const [extractingId, setExtractingId] = useState<CategoryId | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genLabel, setGenLabel] = useState('')
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

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
    try {
      for (const c of targets) {
        setGenLabel(`Generating questions for ${categoryName(c.id)}…`)
        const text = truncateMiddle(state.categories[c.id].extractedText, 6000)
        const system = buildQuestionGenerationSystem(c.id)
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
      }
      setGenLabel('')
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Generation failed.')
    } finally {
      setGenerating(false)
      setGenLabel('')
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-2xl font-bold text-[#003366]">Setup</h2>
        <p className="mt-1 text-slate-600">
          Save your API key, upload textbook PDFs by category, then generate practice questions.
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <label className="block text-sm font-semibold text-slate-800">Anthropic API key</label>
        <p className="mt-1 text-xs text-slate-500">
          Stored only in your browser (localStorage). Use the Vite dev proxy to avoid CORS issues.
        </p>
        <input
          type="password"
          autoComplete="off"
          value={state.apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-api03-…"
          className="mt-3 w-full max-w-xl rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-[#003366] focus:ring-2"
        />
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
          Generate All Questions
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
              {busy && (
                <div className="mt-2 flex items-center gap-2 text-xs text-[#003366]">
                  <span className="inline-block h-4 w-4 animate-pulse-api rounded-full border-2 border-[#003366] border-t-transparent" />
                  Extracting text…
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
