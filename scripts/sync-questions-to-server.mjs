// Sync the local question bank to a running server's database — questions ONLY.
//
// Why this exists: the server's data/hce_trainer.db holds BOTH the question bank
// AND live user data (mock_runs, question_results, progress). Shipping the whole
// .db file (e.g. via `git pull`) would overwrite users' progress. This script
// pushes only the questions, per category, through the server's
// `PUT /api/db/questions/:categoryId` endpoint, which replaces that category's
// questions and leaves all user data intact.
//
// Usage:
//   node scripts/sync-questions-to-server.mjs --url https://trainer.example.com [--db data/hce_trainer.db] [--dry]
//   APP_PASSWORD=... node scripts/sync-questions-to-server.mjs --url https://trainer.example.com
//
// Auth: if the server sets APP_PASSWORD, pass the same value via the APP_PASSWORD
// env var here (basic auth, any username — matches DEPLOY.md).

import Database from 'better-sqlite3'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]])
    return acc
  }, []),
)
const BASE = (args.url || process.env.SYNC_URL || '').replace(/\/$/, '')
const DB_PATH = args.db || 'data/hce_trainer.db'
const DRY = !!args.dry
const PASSWORD = process.env.APP_PASSWORD || ''

if (!BASE) {
  console.error('Missing --url (or SYNC_URL). Example: --url https://trainer.example.com')
  process.exit(1)
}

const CATEGORIES = [
  'health-informatics', 'therapeutics', 'diagnostics', 'support-services', 'biotechnology',
  'communication', 'employability-skills', 'healthcare-laws-ethics', 'safety-infection-control', 'lifespan-development',
]

const headers = { 'Content-Type': 'application/json' }
if (PASSWORD) headers['Authorization'] = 'Basic ' + Buffer.from(`sync:${PASSWORD}`).toString('base64')

const db = new Database(DB_PATH, { readonly: true })
const rows = db.prepare('SELECT id, question, choices, correct, explanation, source FROM questions WHERE category_id = ? ORDER BY rowid')

let total = 0
for (const cat of CATEGORIES) {
  // The PUT handler does JSON.stringify(q.choices), so choices must be an object.
  const questions = rows.all(cat).map((q) => ({
    id: q.id, question: q.question, choices: JSON.parse(q.choices),
    correct: q.correct, explanation: q.explanation, source: q.source ?? null,
  }))
  total += questions.length
  if (DRY) { console.log(`[dry] ${cat}: ${questions.length} questions`); continue }
  const res = await fetch(`${BASE}/api/db/questions/${encodeURIComponent(cat)}`, {
    method: 'PUT', headers, body: JSON.stringify(questions),
  })
  const body = await res.text()
  if (!res.ok) { console.error(`  ✗ ${cat}: HTTP ${res.status} ${body.slice(0, 200)}`); process.exitCode = 1; continue }
  console.log(`  ✓ ${cat}: ${questions.length} synced ${body}`)
}
console.log(`${DRY ? '[dry] ' : ''}done — ${total} questions across ${CATEGORIES.length} categories to ${BASE}`)
