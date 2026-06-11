import { test, expect, type Page } from '@playwright/test'

// Mocked Anthropic grading response — keeps tests deterministic and free.
const MOCK_GRADE = {
  content: [{
    type: 'text',
    text: JSON.stringify({
      score: 8,
      feedback: 'Strong essay covering role, education, environment, and importance.',
      strengths: ['Clear structure', 'Accurate education requirements'],
      improvements: ['Add a specific workplace example'],
    }),
  }],
}

async function mockAnthropicProxy(page: Page) {
  await page.route('**/api/anthropic/v1/messages', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_GRADE) }),
  )
}

async function switchProfile(page: Page, from: string, to: string) {
  await page.getByRole('button', { name: new RegExp(from) }).click()
  await page.getByRole('button', { name: to, exact: true }).click()
}

test.describe('student flows', () => {
  test.afterAll(async ({ request }) => {
    // Mock runs in this suite are recorded under the 'test' profile — wipe them
    await request.delete('/api/db/runs?profile=test')
  })

  test('fresh load syncs the question bank from the server', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Practice' })).toBeVisible()
    // banner only shows when no questions could be loaded
    await expect(page.getByText('No questions loaded yet')).not.toBeVisible()
    await expect
      .poll(async () => page.evaluate(() => {
        const raw = localStorage.getItem('hce_trainer_v1:Shyam')
        if (!raw) return 0
        const s = JSON.parse(raw) as { categories: Record<string, { questions: unknown[] }> }
        return Object.values(s.categories).reduce((n, c) => n + c.questions.length, 0)
      }), { timeout: 15_000 })
      .toBeGreaterThan(500)
  })

  test('category drill: load, answer, check', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1500) // let mount sync land
    await page.locator('select').first().selectOption({ label: 'Diagnostics' })
    await page.getByRole('button', { name: /Load \d+ questions/ }).click()

    const radios = page.locator('section input[type=radio]')
    await expect(radios).toHaveCount(20) // 5 questions x 4 choices
    for (let q = 0; q < 5; q++) await radios.nth(q * 4).check()

    await page.getByRole('button', { name: 'Check Answers' }).click()
    await expect(page.getByText('Explanation:')).toHaveCount(5)
  })

  test('full mock test: 35 questions + essay, results, persistence, dashboard', async ({ page, request }) => {
    await mockAnthropicProxy(page)
    await page.goto('/')
    await page.waitForTimeout(1500)
    // run under the 'test' profile so cleanup can't touch real history
    await switchProfile(page, 'Shyam', 'Test')
    await page.waitForTimeout(1500)

    await page.getByRole('button', { name: 'Full Mock Test', exact: true }).click()
    await page.getByRole('button', { name: 'Start Mock Test' }).click()
    await expect(page.getByText(/Question 1 of/)).toBeVisible()

    for (let i = 0; i < 35; i++) {
      await page.locator('input[type=radio]').nth(i % 4).check()
      const next = page.getByRole('button', { name: 'Next', exact: true })
      if (await next.isVisible()) await next.click()
      else await page.getByRole('button', { name: 'Go to Essay' }).click()
    }

    await expect(page.getByText('Essay Prompt')).toBeVisible()
    await page.locator('textarea').first().fill(
      'A registered nurse provides direct patient care in the Therapeutic Services cluster. ' +
      'Becoming an RN requires a nursing degree and passing the NCLEX-RN.',
    )
    page.on('dialog', (d) => d.accept())
    await page.getByRole('button', { name: 'Submit Test' }).click()

    // MC results + mocked essay grade render
    await expect(page.getByText(/Multiple Choice: \d+\/35/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('8/10')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Strong essay covering role, education, environment, and importance.')).toBeVisible()

    // run persisted server-side with the essay grade
    const runs = (await (await request.get('/api/db/runs?profile=test')).json()) as Array<{
      total: number
      essay_score: number | null
    }>
    expect(runs.length).toBeGreaterThanOrEqual(1)
    expect(runs[0].total).toBe(35)
    expect(runs[0].essay_score).toBe(8)

    // dashboard shows the run
    await page.getByRole('button', { name: 'Progress Dashboard', exact: true }).click()
    await expect(page.getByText(/35/).first()).toBeVisible()
  })
})
