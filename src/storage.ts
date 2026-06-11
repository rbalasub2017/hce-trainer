import { CATEGORIES, GLOBAL_API_KEY_STORAGE_KEY, STORAGE_KEY, type CategoryId, type ProfileId } from './constants'
import type { CategoryPersisted, CategoryProgress, McQuestion, PersistedState } from './types'

function profileKey(profile: ProfileId): string {
  return `${STORAGE_KEY}:${profile}`
}

function emptyCategory(): CategoryPersisted {
  return {
    extractedText: '',
    pageCount: 0,
    questions: [],
    status: 'empty',
  }
}

function emptyProgress(): CategoryProgress {
  return { attempted: 0, correct: 0, sessions: [] }
}

export function defaultPersistedState(): PersistedState {
  const categories = {} as Record<CategoryId, CategoryPersisted>
  const categoryProgress = {} as Record<CategoryId, CategoryProgress>
  for (const c of CATEGORIES) {
    categories[c.id] = emptyCategory()
    categoryProgress[c.id] = emptyProgress()
  }
  return {
    categories,
    categoryProgress,
    mockTestHighScore: 0,
    mockTestHistory: [],
    totalPracticeSeconds: 0,
    totalQuestionsAnswered: 0,
    starredQuestionIds: [],
    essayPrompt: '',
    essayDraft: '',
  }
}

export function loadState(profile: ProfileId): PersistedState {
  try {
    // Prefer profile-scoped key; fall back to legacy key only for Shyam (migration)
    const raw = localStorage.getItem(profileKey(profile))
      ?? (profile === 'Shyam' ? localStorage.getItem(STORAGE_KEY) : null)
    if (!raw) return defaultPersistedState()
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    // Scrub API keys persisted by older app versions — the key now lives only
    // on the server, never in the browser.
    localStorage.removeItem(GLOBAL_API_KEY_STORAGE_KEY)
    const legacy = parsed as { apiKey?: string }
    if (legacy.apiKey) {
      delete legacy.apiKey
      localStorage.setItem(profileKey(profile), JSON.stringify(parsed))
    }
    const base = defaultPersistedState()
    const merged: PersistedState = {
      ...base,
      ...parsed,
      categories: { ...base.categories },
      categoryProgress: { ...base.categoryProgress },
    }
    for (const c of CATEGORIES) {
      merged.categories[c.id] = {
        ...base.categories[c.id],
        ...parsed.categories?.[c.id],
        questions: parsed.categories?.[c.id]?.questions ?? base.categories[c.id].questions,
      }
      merged.categoryProgress[c.id] = {
        ...base.categoryProgress[c.id],
        ...parsed.categoryProgress?.[c.id],
        sessions: parsed.categoryProgress?.[c.id]?.sessions ?? [],
      }
    }
    merged.mockTestHistory = (parsed.mockTestHistory ?? []).map((r) => ({
      ...r,
      // Backfill id for runs created before this field was added
      id: r.id ?? crypto.randomUUID(),
    }))
    merged.starredQuestionIds = parsed.starredQuestionIds ?? []
    merged.essayPrompt = parsed.essayPrompt ?? ''
    merged.essayDraft = parsed.essayDraft ?? ''
    return merged
  } catch {
    return defaultPersistedState()
  }
}

export function saveState(profile: ProfileId, state: PersistedState): void {
  localStorage.setItem(profileKey(profile), JSON.stringify(state))
}

export function makeQuestionId(): string {
  return crypto.randomUUID()
}

export function normalizeImportedQuestions(
  items: Array<{
    question: string
    choices: Record<string, string>
    correct: string
    explanation: string
    source?: string
  }>,
  categoryId: CategoryId,
): McQuestion[] {
  const keys = ['A', 'B', 'C', 'D'] as const
  return items.map((q) => {
    const choices = {
      A: String(q.choices?.A ?? ''),
      B: String(q.choices?.B ?? ''),
      C: String(q.choices?.C ?? ''),
      D: String(q.choices?.D ?? ''),
    }
    let correct = String(q.correct ?? 'A').toUpperCase() as McQuestion['correct']
    if (!keys.includes(correct as 'A')) correct = 'A'
    return {
      id: makeQuestionId(),
      categoryId,
      question: q.question,
      choices,
      correct,
      explanation: q.explanation ?? '',
      source: q.source ? String(q.source) : undefined,
    }
  })
}
