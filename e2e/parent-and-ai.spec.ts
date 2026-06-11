import { test, expect, type Page } from '@playwright/test'

async function goToParent(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /Shyam/ }).click()
  await page.getByRole('button', { name: 'Parent', exact: true }).click()
}

test('parent profile exposes Setup and Settings; students never see them', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Setup', exact: true })).not.toBeVisible()

  await page.getByRole('button', { name: /Shyam/ }).click()
  await page.getByRole('button', { name: 'Parent', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Setup', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
})

test('settings reflects server-side API key status (not configured)', async ({ page }) => {
  // test server runs without ANTHROPIC_API_KEY by design
  await goToParent(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByText('Not configured.')).toBeVisible()
  await expect(page.getByText('ANTHROPIC_API_KEY')).toBeVisible()
})

test('settings shows green state when the server reports a configured key', async ({ page }) => {
  await page.route('**/api/anthropic/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"configured":true}' }),
  )
  await goToParent(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByText('Configured on the server')).toBeVisible()
})

test('no API key ever touches browser storage', async ({ page }) => {
  // seed artifacts an older app version would have left behind
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('hce_trainer_api_key', 'sk-ant-OLD-LEAKED-KEY')
    localStorage.setItem('hce_trainer_v1:Shyam', JSON.stringify({ apiKey: 'sk-ant-OLD-PROFILE-KEY' }))
  })
  await page.reload()
  await page.waitForTimeout(1500)
  const leftovers = await page.evaluate(() =>
    Object.entries(localStorage).filter(([, v]) => String(v).includes('sk-ant')).map(([k]) => k),
  )
  expect(leftovers).toHaveLength(0)
})

test('essay grader evaluates through the server proxy (mocked)', async ({ page }) => {
  const EVALUATION = 'Overall: 8/10. Clear structure, accurate education requirements, add a workplace example.'
  await page.route('**/api/anthropic/v1/messages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: [{ type: 'text', text: EVALUATION }] }),
    }),
  )
  await page.goto('/')
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Essay Grader' }).click()
  await page.locator('textarea').first().fill('Registered nurses provide direct patient care.')
  await page.getByRole('button', { name: 'Evaluate My Essay' }).click()
  await expect(page.getByText(EVALUATION)).toBeVisible({ timeout: 10_000 })
})

test('essay grader surfaces a clear error when no server key is configured', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Essay Grader' }).click()
  await page.locator('textarea').first().fill('Registered nurses provide direct patient care.')
  await page.getByRole('button', { name: 'Evaluate My Essay' }).click()
  await expect(page.getByText(/No Anthropic API key is configured on the server/)).toBeVisible({ timeout: 10_000 })
})
