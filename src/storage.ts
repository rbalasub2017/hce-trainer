import { CATEGORIES, GLOBAL_API_KEY_STORAGE_KEY, STORAGE_KEY, type CategoryId, type ProfileId } from './constants'
import type { CategoryPersisted, CategoryProgress, McQuestion, MockTestRun, PersistedState, ProgressSlice, SyncedProgress } from './types'

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
    resetAt: null,
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

export function progressSlice(state: PersistedState): ProgressSlice {
  return {
    categoryProgress: state.categoryProgress,
    mockTestHighScore: state.mockTestHighScore,
    mockTestHistory: state.mockTestHistory,
    totalPracticeSeconds: state.totalPracticeSeconds,
    totalQuestionsAnswered: state.totalQuestionsAnswered,
  }
}

export function hasProgress(p: ProgressSlice): boolean {
  return (
    p.totalQuestionsAnswered > 0 ||
    p.totalPracticeSeconds > 0 ||
    p.mockTestHistory.length > 0 ||
    Object.values(p.categoryProgress).some((c) => c.attempted > 0)
  )
}

/** Fill in anything missing from a server-synced slice (e.g. categories added
 *  after the slice was written) so consumers can index it safely. Carries the
 *  reset epoch through untouched. */
export function normalizeProgressSlice(raw: Partial<SyncedProgress>): SyncedProgress {
  const categoryProgress = {} as Record<CategoryId, CategoryProgress>
  for (const c of CATEGORIES) {
    const p = raw.categoryProgress?.[c.id]
    categoryProgress[c.id] = {
      ...emptyProgress(),
      ...p,
      sessions: p?.sessions ?? [],
    }
  }
  return {
    categoryProgress,
    mockTestHighScore: raw.mockTestHighScore ?? 0,
    mockTestHistory: raw.mockTestHistory ?? [],
    totalPracticeSeconds: raw.totalPracticeSeconds ?? 0,
    totalQuestionsAnswered: raw.totalQuestionsAnswered ?? 0,
    resetAt: raw.resetAt ?? null,
  }
}

/** Monotonic merge of two progress slices. Counts take the max and history is
 *  unioned, so the result is never smaller than either input — this is what
 *  lets the server accumulate across devices instead of last-writer-wins
 *  clobbering. The only way progress decreases is an explicit reset (handled
 *  separately via the reset epoch). */
function mergeCategoryProgress(a: CategoryProgress, b: CategoryProgress): CategoryProgress {
  // Counts move together as one lineage; take the record that did more work so
  // attempted/correct stay consistent rather than mixing the two.
  const lead = a.attempted >= b.attempted ? a : b
  const seen = new Set<string>()
  const sessions = [...(a.sessions ?? []), ...(b.sessions ?? [])]
    .filter((s) => {
      const k = `${s.date}|${s.attempted}|${s.correct}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((x, y) => x.date.localeCompare(y.date))
    .slice(-10)
  return { attempted: lead.attempted, correct: lead.correct, sessions }
}

export function mergeProgress(a: ProgressSlice, b: ProgressSlice): ProgressSlice {
  const categoryProgress = {} as Record<CategoryId, CategoryProgress>
  for (const c of CATEGORIES) {
    categoryProgress[c.id] = mergeCategoryProgress(a.categoryProgress[c.id], b.categoryProgress[c.id])
  }
  const byId = new Map<string, MockTestRun>()
  for (const r of [...a.mockTestHistory, ...b.mockTestHistory]) {
    const existing = byId.get(r.id)
    // Prefer the copy that already carries a graded essay.
    if (!existing || (!existing.essayGrade && r.essayGrade)) byId.set(r.id, r)
  }
  const mockTestHistory = [...byId.values()].sort((x, y) => x.date.localeCompare(y.date))
  return {
    categoryProgress,
    mockTestHighScore: Math.max(a.mockTestHighScore, b.mockTestHighScore),
    mockTestHistory,
    totalPracticeSeconds: Math.max(a.totalPracticeSeconds, b.totalPracticeSeconds),
    totalQuestionsAnswered: Math.max(a.totalQuestionsAnswered, b.totalQuestionsAnswered),
  }
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
