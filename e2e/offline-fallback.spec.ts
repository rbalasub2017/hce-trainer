import { test, expect } from '@playwright/test'

// Simulates the API server being unreachable by aborting /api/db/questions
// requests at the browser level — exercises the offline-fallback code paths
// without touching the real server process.

const SEED_QUESTIONS = [
  {
    id: 'seed-1', categoryId: 'diagnostics', question: 'SEED: What does CBC stand for?',
    choices: { A: 'Complete Blood Count', B: 'Cardiac Bypass Check', C: 'Clinical Body Chart', D: 'Central Blood Culture' },
    correct: 'A', explanation: 'CBC = complete blood count.',
  },
  {
    id: 'seed-2', categoryId: 'diagnostics', question: 'SEED: Normal oral body temperature?',
    choices: { A: '95.6F', B: '98.6F', C: '101.2F', D: '96.8F' },
    correct: 'B', explanation: '98.6F / 37C is normal.',
  },
]

test('sync banner, Parent-localStorage fallback, and recovery when server returns', async ({ page }) => {
  await page.route('**/api/db/questions/**', (route) => route.abort())

  // 1. Server "down", nothing stored → banner shows
  await page.goto('/')
  const banner = page.getByText('No questions loaded yet')
  await expect(banner).toBeVisible()

  // 2. Sync with nothing available → banner stays, button cycles
  const syncBtn = page.getByRole('button', { name: /Sync questions|Syncing/ })
  await syncBtn.click()
  await expect(syncBtn).toHaveText('Syncing…')
  await expect(syncBtn).toHaveText('Sync questions', { timeout: 5_000 })
  await expect(banner).toBeVisible()

  // 3. Seed Parent's localStorage → Sync pulls the offline fallback
  await page.evaluate((qs) => {
    localStorage.setItem('hce_trainer_v1:Parent', JSON.stringify({
      categories: { diagnostics: { extractedText: '', pageCount: 0, questions: qs, status: 'generated' } },
    }))
  }, SEED_QUESTIONS)
  await syncBtn.click()
  await expect(banner).not.toBeVisible({ timeout: 5_000 })

  // fallback questions are actually drillable
  await page.locator('select').first().selectOption({ label: 'Diagnostics' })
  await page.getByRole('button', { name: /Load \d+ questions/ }).click()
  await expect(page.getByText('SEED: What does CBC stand for?')).toBeVisible()

  // 4. Server "returns" → reload re-syncs the full bank over the fallback
  await page.unroute('**/api/db/questions/**')
  await page.reload()
  await expect
    .poll(async () => page.evaluate(() => {
      const raw = localStorage.getItem('hce_trainer_v1:Shyam')
      if (!raw) return 0
      const s = JSON.parse(raw) as { categories: Record<string, { questions: unknown[] }> }
      return Object.values(s.categories).reduce((n, c) => n + c.questions.length, 0)
    }), { timeout: 15_000 })
    .toBeGreaterThan(500)
})

test('fresh student profile mount falls back to Parent localStorage while offline', async ({ page }) => {
  await page.route('**/api/db/questions/**', (route) => route.abort())
  await page.goto('/')
  await page.evaluate((qs) => {
    localStorage.setItem('hce_trainer_v1:Parent', JSON.stringify({
      categories: { diagnostics: { extractedText: '', pageCount: 0, questions: qs, status: 'generated' } },
    }))
  }, SEED_QUESTIONS)

  // switch to the fresh 'test' profile — mount effect should pick up the fallback
  await page.getByRole('button', { name: /Shyam/ }).click()
  await page.getByRole('button', { name: 'Test', exact: true }).click()
  await expect(page.getByText('No questions loaded yet')).not.toBeVisible({ timeout: 5_000 })
  await expect
    .poll(async () => page.evaluate(() => {
      const raw = localStorage.getItem('hce_trainer_v1:test')
      if (!raw) return 0
      const s = JSON.parse(raw) as { categories: Record<string, { questions: unknown[] }> }
      return Object.values(s.categories).reduce((n, c) => n + c.questions.length, 0)
    }), { timeout: 10_000 })
    .toBe(2)
})
