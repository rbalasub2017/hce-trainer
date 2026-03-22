import type { CategoryId } from './constants'

export type ChoiceKey = 'A' | 'B' | 'C' | 'D'

export interface McQuestion {
  id: string
  categoryId: CategoryId
  question: string
  choices: Record<ChoiceKey, string>
  correct: ChoiceKey
  explanation: string
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

export interface PersistedState {
  apiKey: string
  categories: Record<CategoryId, CategoryPersisted>
  categoryProgress: Record<CategoryId, CategoryProgress>
  mockTestHighScore: number
  totalPracticeSeconds: number
  totalQuestionsAnswered: number
  starredQuestionIds: string[]
  essayPrompt: string
  essayDraft: string
}

export type ScreenId = 'setup' | 'practice' | 'essay' | 'dashboard' | 'reference'
