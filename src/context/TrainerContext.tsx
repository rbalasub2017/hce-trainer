import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { CategoryId, ProfileId } from '../constants'
import { CATEGORIES } from '../constants'
export const PARENT_PROFILE_ID: ProfileId = 'Parent'
import { loadState, saveState, saveGlobalApiKey, defaultPersistedState } from '../storage'
import type { CategoryPersisted, McQuestion, MockTestRun, PersistedState } from '../types'
import { fetchQuestionsFromServer, saveQuestionsToServer } from '../utils/db'

type TrainerContextValue = {
  activeProfile: ProfileId
  state: PersistedState
  setApiKey: (key: string) => void
  setCategoryData: (id: CategoryId, patch: Partial<CategoryPersisted>) => void
  setQuestionsForCategory: (id: CategoryId, questions: McQuestion[]) => void
  recordDrillSession: (id: CategoryId, correct: number, attempted: number) => void
  recordMockResults: (byCategory: Record<CategoryId, { correct: number; attempted: number }>) => void
  addPracticeTime: (seconds: number) => void
  addQuestionsAnswered: (n: number) => void
  setMockHighScore: (pct: number) => void
  addMockTestRun: (run: MockTestRun) => void
  updateMockTestRun: (id: string, patch: Partial<MockTestRun>) => void
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

export function TrainerProvider({ profile, children }: { profile: ProfileId; children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(() => loadState(profile))

  useEffect(() => {
    saveState(profile, state)
  }, [profile, state])

  // On mount: sync with the shared server question bank.
  //   Parent  → push local questions up (Parent is the source of truth for content)
  //   Student → always pull from server (stay in sync with whatever Parent has published)
  // Runs once per profile switch; localStorage stays as offline fallback.
  useEffect(() => {
    const isParent = profile === PARENT_PROFILE_ID
    const snapshot = loadState(profile)
    for (const cat of CATEGORIES) {
      const local = snapshot.categories[cat.id]
      if (isParent) {
        // Parent: push any questions they have so students can access them
        if (local.status !== 'empty' && local.questions.length > 0) {
          void saveQuestionsToServer(cat.id, local.questions)
        }
      } else {
        // Student: always pull from server — picks up new questions Parent generates
        fetchQuestionsFromServer(cat.id).then((questions) => {
          if (!questions) return
          setState((s) => ({
            ...s,
            categories: {
              ...s.categories,
              [cat.id]: { ...s.categories[cat.id], questions, status: 'generated' },
            },
          }))
        })
      }
    }
  }, [profile]) // re-run when profile switches

  const setApiKey = useCallback((apiKey: string) => {
    saveGlobalApiKey(apiKey)
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
    if (questions.length > 0) void saveQuestionsToServer(id, questions)
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

  const addMockTestRun = useCallback((run: MockTestRun) => {
    setState((s) => ({
      ...s,
      mockTestHighScore: Math.max(s.mockTestHighScore, run.score),
      mockTestHistory: [...s.mockTestHistory, run],
    }))
  }, [])

  const updateMockTestRun = useCallback((id: string, patch: Partial<MockTestRun>) => {
    setState((s) => ({
      ...s,
      mockTestHistory: s.mockTestHistory.map((r) =>
        r.id === id ? { ...r, ...patch } : r,
      ),
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
      activeProfile: profile,
      state,
      setApiKey,
      setCategoryData,
      setQuestionsForCategory,
      recordDrillSession,
      recordMockResults,
      addPracticeTime,
      addQuestionsAnswered,
      setMockHighScore,
      addMockTestRun,
      updateMockTestRun,
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
      addMockTestRun,
      updateMockTestRun,
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
