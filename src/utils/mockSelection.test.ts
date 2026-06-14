/**
 * Unit tests for mock-test question & essay selection.
 * Run with: npm run test:unit  (executed via tsx, no test framework needed)
 *
 * These import the REAL functions used by MockTestScreen — not reimplementations
 * — so they exercise the exact selection logic that ships.
 */
import assert from 'node:assert/strict'
import { CATEGORIES, MOCK_ESSAY_PROMPTS, type CategoryId } from '../constants'
import type { ChoiceKey, McQuestion, MockTestRun, QuestionResult } from '../types'
import {
  PRIORITY_CORRECT,
  PRIORITY_UNSEEN,
  PRIORITY_WRONG,
  buildMockPaper,
  lastOutcomeByQuestion,
  mockDistribution,
  pickMockEssayPrompt,
  questionPriority,
} from './mockSelection'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log('ok:', name)
}

// ── helpers ────────────────────────────────────────────────────────────────
function q(id: string, categoryId: CategoryId): McQuestion {
  return {
    id,
    categoryId,
    question: `Q ${id}`,
    choices: { A: 'a', B: 'b', C: 'c', D: 'd' },
    correct: 'A',
    explanation: '',
  }
}

function result(questionId: string, categoryId: CategoryId, userAnswer: ChoiceKey | null): QuestionResult {
  return {
    questionId,
    categoryId,
    question: `Q ${questionId}`,
    choices: { A: 'a', B: 'b', C: 'c', D: 'd' },
    correct: 'A', // so userAnswer 'A' = correct, anything else / null = wrong
    userAnswer,
    explanation: '',
  }
}

function run(id: string, date: string, questions: QuestionResult[], essayPrompt?: string): MockTestRun {
  return { id, date, score: 0, correct: 0, total: questions.length, questions, essayPrompt }
}

const CAT = CATEGORIES[0]!.id

// ── lastOutcomeByQuestion ────────────────────────────────────────────────────
test('lastOutcomeByQuestion: maps correct/wrong, skip counts as wrong', () => {
  const outcomes = lastOutcomeByQuestion([
    run('r1', '2026-01-01', [
      result('q1', CAT, 'A'), // correct
      result('q2', CAT, 'B'), // wrong
      result('q3', CAT, null), // skipped -> wrong
    ]),
  ])
  assert.equal(outcomes.get('q1'), 'correct')
  assert.equal(outcomes.get('q2'), 'wrong')
  assert.equal(outcomes.get('q3'), 'wrong')
  assert.equal(outcomes.get('never-seen'), undefined)
})

test('lastOutcomeByQuestion: later run overrides earlier (most-recent wins)', () => {
  const outcomes = lastOutcomeByQuestion([
    run('r1', '2026-01-01', [result('q1', CAT, 'B')]), // wrong first
    run('r2', '2026-02-01', [result('q1', CAT, 'A')]), // then correct
  ])
  assert.equal(outcomes.get('q1'), 'correct')
})

// ── questionPriority ─────────────────────────────────────────────────────────
test('questionPriority: wrong < unseen < correct', () => {
  const outcomes = new Map<string, 'correct' | 'wrong'>([
    ['w', 'wrong'],
    ['c', 'correct'],
  ])
  assert.equal(questionPriority(q('w', CAT), outcomes), PRIORITY_WRONG)
  assert.equal(questionPriority(q('u', CAT), outcomes), PRIORITY_UNSEEN)
  assert.equal(questionPriority(q('c', CAT), outcomes), PRIORITY_CORRECT)
  assert.ok(PRIORITY_WRONG < PRIORITY_UNSEEN && PRIORITY_UNSEEN < PRIORITY_CORRECT)
})

// ── mockDistribution ─────────────────────────────────────────────────────────
test('mockDistribution: sums to total, 10 cats, spread evenly (35 -> 3-4)', () => {
  for (const total of [35, 40, 30, 37]) {
    const d = mockDistribution(total)
    assert.equal(d.length, 10)
    assert.equal(d.reduce((a, b) => a + b, 0), total)
    const base = Math.floor(total / 10)
    assert.ok(d.every((n) => n === base || n === base + 1))
  }
})

// ── buildMockPaper (the integration point) ───────────────────────────────────
function fullBank(perCat: number): Record<CategoryId, McQuestion[]> {
  const byCat = {} as Record<CategoryId, McQuestion[]>
  for (const c of CATEGORIES) byCat[c.id] = Array.from({ length: perCat }, (_, i) => q(`${c.id}-${i}`, c.id))
  return byCat
}

test('buildMockPaper: produces `total` unique questions across categories', () => {
  const bank = fullBank(20)
  for (let t = 0; t < 200; t++) {
    const paper = buildMockPaper(bank, 35, new Map())
    assert.equal(paper.length, 35)
    assert.equal(new Set(paper.map((p) => p.id)).size, 35)
  }
})

test('buildMockPaper: re-drills mistakes first, never serves mastered while unseen remain', () => {
  const bank = fullBank(20) // 20 per category, plenty unseen
  // Mark, within the first category, 2 wrong + 1 skip, and 3 already-correct.
  const wrongIds = [`${CAT}-0`, `${CAT}-1`]
  const skipId = `${CAT}-2`
  const correctIds = [`${CAT}-3`, `${CAT}-4`, `${CAT}-5`]
  const history = [
    run('r1', '2026-01-01', [
      ...wrongIds.map((id) => result(id, CAT, 'B')),
      result(skipId, CAT, null),
      ...correctIds.map((id) => result(id, CAT, 'A')),
    ]),
  ]
  const outcomes = lastOutcomeByQuestion(history)
  const mistakes = new Set([...wrongIds, skipId])

  for (let t = 0; t < 300; t++) {
    const paper = buildMockPaper(bank, 35, outcomes)
    const fromCat = paper.filter((p) => p.categoryId === CAT).map((p) => p.id)
    // every mistake that fits in this category's slot count must appear...
    const served = new Set(fromCat)
    for (const id of mistakes) assert.ok(served.has(id), `mistake ${id} should be re-drilled`)
    // ...and no already-mastered question while 14 unseen still exist in the cat.
    for (const id of correctIds) assert.ok(!served.has(id), `mastered ${id} should not be served`)
  }
})

test('buildMockPaper: falls back to mastered questions when a category is exhausted', () => {
  // Category has exactly 3 questions, all previously answered correctly, and we
  // still need >=3 from it — selection must recycle rather than under-fill.
  const bank = fullBank(3)
  const correctEverywhere: MockTestRun[] = [
    run(
      'r1',
      '2026-01-01',
      CATEGORIES.flatMap((c) => bank[c.id].map((qq) => result(qq.id, c.id, 'A'))),
    ),
  ]
  const outcomes = lastOutcomeByQuestion(correctEverywhere)
  const paper = buildMockPaper(bank, 30, outcomes) // needs 3 per cat, only 3 exist
  assert.equal(paper.length, 30)
  assert.equal(new Set(paper.map((p) => p.id)).size, 30)
})

// ── pickMockEssayPrompt ──────────────────────────────────────────────────────
test('pickMockEssayPrompt: returns a prompt from the pool', () => {
  const p = pickMockEssayPrompt([])
  assert.ok((MOCK_ESSAY_PROMPTS as readonly string[]).includes(p))
})

test('pickMockEssayPrompt: never repeats within a full rotation window', () => {
  for (let trial = 0; trial < 500; trial++) {
    const history: MockTestRun[] = []
    const seq: string[] = []
    for (let i = 0; i < 30; i++) {
      const p = pickMockEssayPrompt(history)
      seq.push(p)
      history.push(run(`r${i}`, `2026-01-${i + 1}`, [], p))
    }
    for (let i = 1; i < seq.length; i++) {
      const prev = seq.lastIndexOf(seq[i]!, i - 1)
      if (prev >= 0) {
        assert.ok(i - prev >= MOCK_ESSAY_PROMPTS.length, `prompt repeated after only ${i - prev} tests`)
      }
    }
  }
})

test('pickMockEssayPrompt: 3 back-to-back tests yield 3 distinct prompts', () => {
  for (let trial = 0; trial < 1000; trial++) {
    const history: MockTestRun[] = []
    const got: string[] = []
    for (let i = 0; i < 3; i++) {
      const p = pickMockEssayPrompt(history)
      got.push(p)
      history.push(run(`r${i}`, `2026-01-${i + 1}`, [], p))
    }
    assert.equal(new Set(got).size, 3)
  }
})

console.log(`\n${passed} tests passed`)
