import { defineConfig } from '@playwright/test'

// E2E tests run against a dedicated server instance on port 3101 so they never
// collide with a dev/production server on 3001. The server serves the built
// frontend from dist/ — run `npm run build` before `npm run test:e2e`.
// Started without ANTHROPIC_API_KEY on purpose: AI tests mock the proxy route.
// The server runs on a fresh copy of the database (in .e2e/, gitignored) so
// tests that write progress or start a season never touch data/hce_trainer.db.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:3101',
    viewport: { width: 1280, height: 900 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command:
      'mkdir -p .e2e && rm -f .e2e/hce_trainer.db* && ' +
      // SQLite backup (not cp) so pages still in the WAL are included
      `node -e "new (require('better-sqlite3'))('data/hce_trainer.db').backup('.e2e/hce_trainer.db')" && ` +
      'HCE_DB_PATH=.e2e/hce_trainer.db PORT=3101 npx tsx server/index.ts',
    url: 'http://localhost:3101/api/anthropic/status',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
