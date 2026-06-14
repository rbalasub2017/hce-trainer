import type { CategoryId } from './constants'

export type ChoiceKey = 'A' | 'B' | 'C' | 'D'

export interface McQuestion {
  id: string
  categoryId: CategoryId
  question: string
  choices: Record<ChoiceKey, string>
  correct: ChoiceKey
  explanation: string
  source?: string
}

export type CategoryContentStatus = 'empty' | 'loaded' | 'generated'

export interface CategoryPersisted {
  extractedText: string
  pageCount: number
  questions: McQuestion[]
  status: CategoryContentStatus
}

export interface CategorySessionSnapshot {
  date: string
  attempted: number
  correct: number
}

export interface CategoryProgress {
  attempted: number
  correct: number
  sessions: CategorySessionSnapshot[]
}

export interface QuestionResult {
  questionId: string
  categoryId: CategoryId
  question: string
  choices: Record<ChoiceKey, string>
  correct: ChoiceKey
  userAnswer: ChoiceKey | null  // null = skipped
  explanation: string
  source?: string
}

export interface EssayGrade {
  score: number        // 1–10
  feedback: string     // 2–3 sentence narrative
  strengths: string[]
  improvements: string[]
}

export interface MockTestRun {
  id: string           // crypto.randomUUID()
  date: string         // ISO timestamp
  score: number        // overall % correct (0–100)
  correct: number
  total: number
  mode?: 'normal' | 'tough'
  questions?: QuestionResult[]
  essayPrompt?: string
  essayText?: string
  essayGrade?: EssayGrade
}

export interface PersistedState {
  categories: Record<CategoryId, CategoryPersisted>
  categoryProgress: Record<CategoryId, CategoryProgress>
  mockTestHighScore: number
  mockTestHistory: MockTestRun[]
  totalPracticeSeconds: number
  totalQuestionsAnswered: number
  starredQuestionIds: string[]
  essayPrompt: string
  essayDraft: string
  /** Last reset epoch this device has acknowledged. The server stamps a fresh
   *  timestamp on every parent-triggered reset; a device whose epoch is older
   *  wipes its local progress and stops re-pushing, so a reset can't be undone
   *  by a stale device replaying its old data. */
  resetAt?: string | null
}

/** The slice of PersistedState that is synced to the server per profile, so
 *  progress earned in one browser is visible from any other device. */
export type ProgressSlice = Pick<
  PersistedState,
  'categoryProgress' | 'mockTestHighScore' | 'mockTestHistory' | 'totalPracticeSeconds' | 'totalQuestionsAnswered'
>

/** What actually crosses the wire to/from the server: the progress slice plus
 *  the reset epoch that guards against stale devices resurrecting wiped data. */
export type SyncedProgress = ProgressSlice & { resetAt?: string | null }

export type ScreenId = 'setup' | 'practice' | 'mock' | 'essay' | 'dashboard' | 'reference' | 'settings'
