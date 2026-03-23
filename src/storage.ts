import { CATEGORIES, STORAGE_KEY, type CategoryId } from './constants'
import type { CategoryPersisted, CategoryProgress, McQuestion, PersistedState } from './types'

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
    apiKey: '',
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

export function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultPersistedState()
    const parsed = JSON.parse(raw) as Partial<PersistedState>
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
    merged.mockTestHistory = parsed.mockTestHistory ?? []
    merged.starredQuestionIds = parsed.starredQuestionIds ?? []
    merged.essayPrompt = parsed.essayPrompt ?? ''
    merged.essayDraft = parsed.essayDraft ?? ''
    return merged
  } catch {
    return defaultPersistedState()
  }
}

export function saveState(state: PersistedState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
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
    }
  })
}
