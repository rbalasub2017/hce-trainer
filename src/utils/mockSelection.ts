import { CATEGORIES, MOCK_ESSAY_PROMPTS, type CategoryId } from '../constants'
import type { McQuestion, MockTestRun } from '../types'
import { pickByPriority, shuffleInPlace } from './shuffle'

// Question-selection priority tiers. Lower is served first, so a new paper
// re-drills past mistakes, then covers unseen material, and only recycles
// already-mastered questions once the first two tiers are exhausted.
export const PRIORITY_WRONG = 0   // answered incorrectly or skipped on the most recent attempt
export const PRIORITY_UNSEEN = 1  // never served in a mock test
export const PRIORITY_CORRECT = 2 // answered correctly on the most recent attempt

// Reduce all mock history to each question's most-recent outcome. A timed-out
// skip (no answer) counts as wrong, since mastery was never demonstrated.
export function lastOutcomeByQuestion(history: MockTestRun[]): Map<string, 'correct' | 'wrong'> {
  const outcome = new Map<string, 'correct' | 'wrong'>()
  // history is chronological, so later runs overwrite earlier ones.
  for (const run of history) {
    for (const qr of run.questions ?? []) {
      outcome.set(qr.questionId, qr.userAnswer === qr.correct ? 'correct' : 'wrong')
    }
  }
  return outcome
}

export function questionPriority(q: McQuestion, outcomes: Map<string, 'correct' | 'wrong'>): number {
  const o = outcomes.get(q.id)
  if (o === undefined) return PRIORITY_UNSEEN
  return o === 'correct' ? PRIORITY_CORRECT : PRIORITY_WRONG
}

// Rotate the essay prompt: avoid the ones used by the most recent runs so the
// same topic doesn't come up every time. Falls back to the full pool once every
// prompt has been cycled through.
export function pickMockEssayPrompt(history: MockTestRun[]): string {
  const recent = new Set(
    history
      .slice(-(MOCK_ESSAY_PROMPTS.length - 1))
      .map((r) => r.essayPrompt)
      .filter((p): p is string => !!p),
  )
  const fresh = MOCK_ESSAY_PROMPTS.filter((p) => !recent.has(p))
  const pool = fresh.length ? fresh : [...MOCK_ESSAY_PROMPTS]
  return pool[Math.floor(Math.random() * pool.length)]!
}

export function mockDistribution(total: number): number[] {
  const base = Math.floor(total / 10)
  const counts = Array.from({ length: 10 }, () => base)
  const extra = total - base * 10
  const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
  shuffleInPlace(order)
  for (let i = 0; i < extra; i++) counts[order[i]!] += 1
  return counts
}

export function buildMockPaper(
  byCategory: Record<CategoryId, McQuestion[]>,
  total: number,
  outcomes: Map<string, 'correct' | 'wrong'>,
): McQuestion[] {
  const dist = mockDistribution(total)
  const out: McQuestion[] = []
  CATEGORIES.forEach((c, idx) => {
    const need = dist[idx]!
    const pool = byCategory[c.id]
    const picked = pickByPriority(pool, need, (q) => questionPriority(q, outcomes))
    out.push(...picked)
  })
  shuffleInPlace(out)
  return out
}
