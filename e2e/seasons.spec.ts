import { test, expect, type Page } from '@playwright/test'

// Starting a season advances the season for the whole server. playwright.config
// runs the server on a throwaway copy of the database, so this is safe here.

async function switchProfile(page: Page, from: string, to: string) {
  const header = page.getByRole('banner')
  await header.getByRole('button', { name: new RegExp(from) }).click()
  await header.getByRole('button', { name: to, exact: true }).click()
}

function nextSeason(season: string): string {
  const start = Number.parseInt(season, 10) + 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

const OLD_PROGRESS = {
  categoryProgress: {
    diagnostics: { attempted: 5, correct: 4, sessions: [{ date: '2026-06-12T15:00:00.000Z', attempted: 5, correct: 4 }] },
  },
  mockTestHighScore: 80,
  mockTestHistory: [{ id: 'e2e-season-run', date: '2026-06-14T15:00:00.000Z', score: 80, correct: 4, total: 5 }],
  totalPracticeSeconds: 600,
  totalQuestionsAnswered: 5,
}

test('starting a new season archives progress and keeps it viewable', async ({ page, request }) => {
  const { current } = await (await request.get('/api/db/seasons?profile=test')).json() as { current: string }
  const next = nextSeason(current)

  // Last season's progress for 'test', on the server and on this "device"
  await request.put('/api/db/progress', { data: { ...OLD_PROGRESS, profile: 'test', resetAt: new Date().toISOString() } })
  await page.goto('/')
  await page.evaluate((p) => localStorage.setItem('hce_trainer_v1:test', JSON.stringify({ ...p, resetAt: null })), OLD_PROGRESS)

  // Parent starts the new season
  await page.reload()
  await switchProfile(page, 'Shyam', 'Parent')
  await page.getByRole('button', { name: 'Progress Dashboard', exact: true }).click()
  await page.getByRole('button', { name: 'Test', exact: true }).click()
  await expect(page.locator('li', { hasText: 'Total questions answered:' })).toContainText('5')
  await page.getByRole('button', { name: `Start ${next} season` }).click()
  await page.getByRole('button', { name: `Start ${next}`, exact: true }).click()

  await expect(page.getByRole('button', { name: `${next} (current)` })).toBeVisible()
  await expect(page.locator('li', { hasText: 'Total questions answered:' })).toContainText(': 0')

  // Last season is still there, read-only
  await page.getByRole('button', { name: current, exact: true }).click()
  await expect(page.getByText('Past season — read-only')).toBeVisible()
  await expect(page.locator('li', { hasText: 'Total questions answered:' })).toContainText('5')
  await expect(page.getByRole('cell', { name: '4/5', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Reset .* Progress/ })).not.toBeVisible()

  // A second start for the same season is refused
  expect((await request.post('/api/db/seasons', { data: { from: current } })).status()).toBe(409)

  // The student's device still holds last season locally: it must wipe it,
  // not push it into the new season.
  await switchProfile(page, 'Parent', 'Test')
  await page.getByRole('button', { name: 'Progress Dashboard', exact: true }).click()
  await expect(page.locator('li', { hasText: 'Total questions answered:' })).toContainText(': 0')
  await page.waitForTimeout(1500)
  const live = await (await request.get('/api/db/progress?profile=test')).json() as { totalQuestionsAnswered: number }
  expect(live.totalQuestionsAnswered).toBe(0)

  // The student can browse their own past season too
  await page.getByRole('button', { name: current, exact: true }).click()
  await expect(page.locator('li', { hasText: 'Total questions answered:' })).toContainText('5')
})
