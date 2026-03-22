import { useMemo, useState } from 'react'
import { CATEGORIES, type CategoryId } from '../constants'
import { useTrainer } from '../context/TrainerContext'
import type { McQuestion } from '../types'
import { categoryName } from '../prompts'

function FlashCard({
  q,
  starred,
  onToggleStar,
}: {
  q: McQuestion
  starred: boolean
  onToggleStar: () => void
}) {
  const [flipped, setFlipped] = useState(false)

  return (
    <div className="flip-inner relative min-h-[200px] w-full max-w-xl">
      <div
        role="button"
        tabIndex={0}
        aria-pressed={flipped}
        onClick={() => setFlipped(!flipped)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setFlipped((f) => !f)
          }
        }}
        className="relative h-full w-full cursor-pointer text-left outline-none ring-[#003366] focus-visible:ring-2"
      >
        <div className={`flip-card relative min-h-[200px] w-full ${flipped ? 'flipped' : ''}`}>
          <div className="flip-face absolute inset-0 flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-md">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#CC0000]">
                {categoryName(q.categoryId)}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleStar()
                }}
                className="text-xl leading-none text-amber-400 hover:text-amber-500"
                aria-label={starred ? 'Remove bookmark' : 'Bookmark'}
              >
                {starred ? '★' : '☆'}
              </button>
            </div>
            <p className="mt-3 flex-1 text-sm font-medium text-slate-900">{q.question}</p>
            <p className="mt-4 text-xs text-slate-500">Click to flip</p>
          </div>
          <div className="flip-face flip-back absolute inset-0 flex flex-col rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-md">
            <p className="text-sm font-semibold text-[#003366]">
              Correct: {q.correct} — {q.choices[q.correct]}
            </p>
            <p className="mt-3 flex-1 text-sm text-slate-800">{q.explanation}</p>
            <p className="mt-4 text-xs text-slate-500">Click to flip back</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function QuickReferenceScreen() {
  const { state, toggleStar } = useTrainer()
  const [filterCat, setFilterCat] = useState<CategoryId | 'all'>('all')
  const [starredOnly, setStarredOnly] = useState(false)
  const [query, setQuery] = useState('')

  const allQuestions: McQuestion[] = useMemo(() => {
    const out: McQuestion[] = []
    for (const c of CATEGORIES) out.push(...state.categories[c.id].questions)
    return out
  }, [state.categories])

  const filtered = useMemo(() => {
    let list = allQuestions
    if (filterCat !== 'all') list = list.filter((q) => q.categoryId === filterCat)
    if (starredOnly) list = list.filter((q) => state.starredQuestionIds.includes(q.id))
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((x) => x.question.toLowerCase().includes(q))
    return list
  }, [allQuestions, filterCat, starredOnly, query, state.starredQuestionIds])

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-2xl font-bold text-[#003366]">Quick Reference</h2>
        <p className="mt-1 text-slate-600">Searchable flashcards built from your generated questions.</p>
      </header>

      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:flex-wrap md:items-end">
        <div className="min-w-[200px] flex-1">
          <label className="text-xs font-semibold uppercase text-slate-500">Search</label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search questions…"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-[#003366] focus:ring-2"
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase text-slate-500">Category</label>
          <select
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value as CategoryId | 'all')}
            className="mt-1 w-full min-w-[200px] rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-[#003366] focus:ring-2"
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-800">
          <input
            type="checkbox"
            checked={starredOnly}
            onChange={(e) => setStarredOnly(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-[#003366] focus:ring-[#003366]"
          />
          Starred only
        </label>
      </section>

      <div className="space-y-8">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-600">
            No cards match. Generate questions in Setup, or adjust filters.
          </p>
        ) : (
          filtered.map((q) => (
            <FlashCard
              key={q.id}
              q={q}
              starred={state.starredQuestionIds.includes(q.id)}
              onToggleStar={() => toggleStar(q.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}
