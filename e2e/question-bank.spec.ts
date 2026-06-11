import { test, expect } from '@playwright/test'

const CATEGORY_IDS = [
  'health-informatics', 'therapeutics', 'diagnostics', 'support-services',
  'biotechnology', 'communication', 'employability-skills',
  'healthcare-laws-ethics', 'safety-infection-control', 'lifespan-development',
]

// The mock test needs questions in every category; drills need a healthy pool.
const MIN_QUESTIONS_PER_CATEGORY = 40

interface Question {
  id: string
  categoryId: string
  question: string
  choices: Record<string, string>
  correct: string
  explanation: string
}

test.describe('question bank integrity (API)', () => {
  test('every category has a healthy number of well-formed questions', async ({ request }) => {
    let total = 0
    for (const cat of CATEGORY_IDS) {
      const res = await request.get(`/api/db/questions/${cat}`)
      expect(res.ok(), `GET questions for ${cat}`).toBe(true)
      const questions = (await res.json()) as Question[]
      expect(questions.length, `${cat} question count`).toBeGreaterThanOrEqual(MIN_QUESTIONS_PER_CATEGORY)
      total += questions.length

      for (const q of questions) {
        expect(q.question.trim(), `${cat}/${q.id} question text`).not.toBe('')
        expect(['A', 'B', 'C', 'D'], `${cat}/${q.id} correct key`).toContain(q.correct)
        for (const key of ['A', 'B', 'C', 'D'] as const) {
          expect((q.choices[key] ?? '').trim(), `${cat}/${q.id} choice ${key}`).not.toBe('')
        }
        expect(q.explanation.trim(), `${cat}/${q.id} explanation`).not.toBe('')
      }
    }
    console.log(`question bank total: ${total} questions across ${CATEGORY_IDS.length} categories`)
  })

  test('no test fixtures leaked into the bank', async ({ request }) => {
    for (const cat of CATEGORY_IDS) {
      const questions = (await (await request.get(`/api/db/questions/${cat}`)).json()) as Question[]
      const seeds = questions.filter((q) => q.question.startsWith('SEED:'))
      expect(seeds, `${cat} leaked seed questions`).toHaveLength(0)
    }
  })

  test('report duplicates and answer-key distribution (informational)', async ({ request }) => {
    const keyCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 }
    const dups: string[] = []
    for (const cat of CATEGORY_IDS) {
      const questions = (await (await request.get(`/api/db/questions/${cat}`)).json()) as Question[]
      const seen = new Set<string>()
      for (const q of questions) {
        keyCounts[q.correct] = (keyCounts[q.correct] ?? 0) + 1
        const norm = q.question.trim().toLowerCase()
        if (seen.has(norm)) dups.push(`${cat}: ${q.question.slice(0, 80)}`)
        seen.add(norm)
      }
    }
    console.log('answer-key distribution:', JSON.stringify(keyCounts))
    if (dups.length) console.log('duplicate questions:\n' + dups.join('\n'))
    // Soft ceiling — a handful of dups is tolerable, a flood means a bad ingest
    expect(dups.length, 'duplicate question count').toBeLessThanOrEqual(5)
  })
})
