// Quick health + drift check of the LIVE question bank on the server.
//
// Pulls every category from the running server and reports: totals, how many
// citations are book-prefixed, leftover textbook/figure references, and the
// "correct answer is the longest option" rate. If a local DB is present it also
// confirms the live bank matches it exactly (per-category content hash).
//
// Usage:
//   node scripts/verify-prod.mjs                         # defaults to the tailnet URL below
//   node scripts/verify-prod.mjs --url https://host      # any server
//   node scripts/verify-prod.mjs --no-compare            # skip the local-vs-live diff

import { createHash } from 'crypto'

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, r) => {
  if (x.startsWith('--')) a.push([x.slice(2), r[i + 1]?.startsWith('--') || r[i + 1] === undefined ? true : r[i + 1]])
  return a
}, []))
const BASE = (args.url || 'https://hce-trainer.tail57f930.ts.net').replace(/\/$/, '')
const COMPARE = !args['no-compare']
const CATS = ['health-informatics', 'therapeutics', 'diagnostics', 'support-services', 'biotechnology',
  'communication', 'employability-skills', 'healthcare-laws-ethics', 'safety-infection-control', 'lifespan-development']
const meta = /\b(according to|in|per|from|shown in|listed in|described in|defined in|based on)\s+(the\s+)?(figure|fig\.?|table|chart|diagram|chapter|textbook|text|book|reading|passage|section|appendix|box|did you know)\b|\bfigure\s*\d|\btable\s*\d|\bdid you know\b|\bthis chapter\b|\bthe textbook\b/i
const hashRow = (q) => createHash('sha1').update(JSON.stringify([q.id, q.question, q.choices, q.correct, q.source])).digest('hex')

// Optional local bank for drift comparison.
let local = null
if (COMPARE) {
  try {
    const { default: Database } = await import('better-sqlite3')
    const db = new Database('data/hce_trainer.db', { readonly: true })
    local = {}
    for (const c of CATS) {
      local[c] = db.prepare('SELECT id, question, choices, correct, source FROM questions WHERE category_id = ? ORDER BY id')
        .all(c).map((r) => hashRow({ ...r, choices: JSON.parse(r.choices) }))
    }
  } catch { console.log('(no local DB / better-sqlite3 — skipping local-vs-live comparison)\n'); local = null }
}

let total = 0, booksrc = 0, metaN = 0, longest = 0, drift = 0
console.log(`LIVE: ${BASE}\n`)
for (const c of CATS) {
  let qs
  try { const r = await fetch(`${BASE}/api/db/questions/${c}`); if (!r.ok) throw new Error(`HTTP ${r.status}`); qs = await r.json() }
  catch (e) { console.log(`  ${c}: UNREACHABLE (${e.message})`); process.exitCode = 1; continue }
  total += qs.length
  for (const q of qs) {
    if (/^(Winger|Marshall),/.test(q.source || '')) booksrc++
    if (meta.test(q.question)) metaN++
    const L = (k) => (q.choices[k] || '').length, o = ['A', 'B', 'C', 'D'].filter((k) => k !== q.correct).map(L)
    if (L(q.correct) > Math.max(...o)) longest++
  }
  let tag = ''
  if (local) {
    const live = qs.map(hashRow).sort(), loc = [...local[c]].sort()
    const same = live.length === loc.length && live.every((h, i) => h === loc[i])
    if (!same) { drift++; tag = `  ⚠ DIFFERS from local (live ${qs.length} / local ${loc.length})` }
    else tag = '  ✓ matches local'
  }
  console.log(`  ${c.padEnd(26)} ${String(qs.length).padStart(3)} questions${tag}`)
}
console.log(`\nLIVE totals: ${total} questions`)
console.log(`  book-prefixed citations : ${booksrc}/${total}`)
console.log(`  textbook/figure references in stems : ${metaN}`)
console.log(`  correct-is-longest-option : ${longest} (${Math.round(100 * longest / total)}%)`)
if (local) console.log(`  local-vs-live : ${drift === 0 ? 'IN SYNC ✓ (all 10 categories match)' : `${drift} categor${drift === 1 ? 'y' : 'ies'} differ ⚠`}`)
