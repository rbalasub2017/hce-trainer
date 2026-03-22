import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { CategoryId } from '../constants'
import { CATEGORIES } from '../constants'
import { loadState, saveState, defaultPersistedState } from '../storage'
import type { CategoryPersisted, McQuestion, PersistedState } from '../types'

type TrainerContextValue = {
  state: PersistedState
  setApiKey: (key: string) => void
  setCategoryData: (id: CategoryId, patch: Partial<CategoryPersisted>) => void
  setQuestionsForCategory: (id: CategoryId, questions: McQuestion[]) => void
  recordDrillSession: (id: CategoryId, correct: number, attempted: number) => void
  recordMockResults: (byCategory: Record<CategoryId, { correct: number; attempted: number }>) => void
  addPracticeTime: (seconds: number) => void
  addQuestionsAnswered: (n: number) => void
  setMockHighScore: (pct: number) => void
  toggleStar: (questionId: string) => void
  setEssayPrompt: (s: string) => void
  setEssayDraft: (s: string) => void
  resetAllProgress: () => void
}

const TrainerContext = createContext<TrainerContextValue | null>(null)

function pushSession(
  prev: PersistedState['categoryProgress'][CategoryId],
  correct: number,
  attempted: number,
): PersistedState['categoryProgress'][CategoryId] {
  const snap = {
    date: new Date().toISOString(),
    attempted,
    correct,
  }
  const sessions = [...(prev.sessions ?? []), snap].slice(-10)
  return {
    attempted: prev.attempted + attempted,
    correct: prev.correct + correct,
    sessions,
  }
}

export function TrainerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(() => loadState())

  useEffect(() => {
    saveState(state)
  }, [state])

  const setApiKey = useCallback((apiKey: string) => {
    setState((s) => ({ ...s, apiKey }))
  }, [])

  const setCategoryData = useCallback((id: CategoryId, patch: Partial<CategoryPersisted>) => {
    setState((s) => ({
      ...s,
      categories: {
        ...s.categories,
        [id]: { ...s.categories[id], ...patch },
      },
    }))
  }, [])

  const setQuestionsForCategory = useCallback((id: CategoryId, questions: McQuestion[]) => {
    setState((s) => ({
      ...s,
      categories: {
        ...s.categories,
        [id]: {
          ...s.categories[id],
          questions,
          status: questions.length > 0 ? 'generated' : s.categories[id].status,
        },
      },
    }))
  }, [])

  const recordDrillSession = useCallback((id: CategoryId, correct: number, attempted: number) => {
    setState((s) => ({
      ...s,
      categoryProgress: {
        ...s.categoryProgress,
        [id]: pushSession(s.categoryProgress[id], correct, attempted),
      },
    }))
  }, [])

  const recordMockResults = useCallback(
    (byCategory: Record<CategoryId, { correct: number; attempted: number }>) => {
      setState((s) => {
        const next = { ...s.categoryProgress }
        for (const c of CATEGORIES) {
          const r = byCategory[c.id]
          if (r && r.attempted > 0) {
            next[c.id] = pushSession(next[c.id], r.correct, r.attempted)
          }
        }
        return { ...s, categoryProgress: next }
      })
    },
    [],
  )

  const addPracticeTime = useCallback((seconds: number) => {
    setState((s) => ({
      ...s,
      totalPracticeSeconds: s.totalPracticeSeconds + seconds,
    }))
  }, [])

  const addQuestionsAnswered = useCallback((n: number) => {
    setState((s) => ({
      ...s,
      totalQuestionsAnswered: s.totalQuestionsAnswered + n,
    }))
  }, [])

  const setMockHighScore = useCallback((pct: number) => {
    setState((s) => ({
      ...s,
      mockTestHighScore: Math.max(s.mockTestHighScore, pct),
    }))
  }, [])

  const toggleStar = useCallback((questionId: string) => {
    setState((s) => {
      const set = new Set(s.starredQuestionIds)
      if (set.has(questionId)) set.delete(questionId)
      else set.add(questionId)
      return { ...s, starredQuestionIds: [...set] }
    })
  }, [])

  const setEssayPrompt = useCallback((essayPrompt: string) => {
    setState((s) => ({ ...s, essayPrompt }))
  }, [])

  const setEssayDraft = useCallback((essayDraft: string) => {
    setState((s) => ({ ...s, essayDraft }))
  }, [])

  const resetAllProgress = useCallback(() => {
    setState((prev) => {
      const fresh = defaultPersistedState()
      return {
        ...fresh,
        apiKey: prev.apiKey,
        categories: prev.categories,
        essayPrompt: prev.essayPrompt,
        essayDraft: prev.essayDraft,
      }
    })
  }, [])

  const value = useMemo(
    () => ({
      state,
      setApiKey,
      setCategoryData,
      setQuestionsForCategory,
      recordDrillSession,
      recordMockResults,
      addPracticeTime,
      addQuestionsAnswered,
      setMockHighScore,
      toggleStar,
      setEssayPrompt,
      setEssayDraft,
      resetAllProgress,
    }),
    [
      state,
      setApiKey,
      setCategoryData,
      setQuestionsForCategory,
      recordDrillSession,
      recordMockResults,
      addPracticeTime,
      addQuestionsAnswered,
      setMockHighScore,
      toggleStar,
      setEssayPrompt,
      setEssayDraft,
      resetAllProgress,
    ],
  )

  return <TrainerContext.Provider value={value}>{children}</TrainerContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- hook paired with TrainerProvider
export function useTrainer() {
  const ctx = useContext(TrainerContext)
  if (!ctx) throw new Error('useTrainer must be used within TrainerProvider')
  return ctx
}
