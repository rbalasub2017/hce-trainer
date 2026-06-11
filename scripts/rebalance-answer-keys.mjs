// One-off maintenance: shuffle each question's answer choices so the correct
// key is evenly distributed across A-D, and remove exact-duplicate questions.
//
// Safety: runs in a single transaction. Before committing it verifies, for
// every question, that (a) the set of choice texts is unchanged and (b) the
// correct key still points at the same answer TEXT as before. Any violation
// rolls the whole thing back. Back up data/hce_trainer.db before running.
//
// Usage: node scripts/rebalance-answer-keys.mjs

import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const KEYS = ['A', 'B', 'C', 'D']
const db = new Database(join(dirname(fileURLToPath(import.meta.url)), '../data/hce_trainer.db'))
db.pragma('journal_mode = WAL')

const shuffledKeys = () => {
  const p = [...KEYS]
  for (let i = p.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  return p
}

const rows = db.prepare('SELECT rowid, id, category_id, question, choices, correct FROM questions ORDER BY rowid').all()
console.log(`loaded ${rows.length} questions`)

// 1. Identify duplicates (same category + normalized question text) — keep the first
const seen = new Map()
const dupRowids = []
for (const r of rows) {
  const key = `${r.category_id}::${r.question.trim().toLowerCase()}`
  if (seen.has(key)) dupRowids.push(r.rowid)
  else seen.set(key, r.rowid)
}
console.log(`duplicates to remove: ${dupRowids.length}`)

// 2. Build shuffled updates for the surviving rows
const updates = []
for (const r of rows) {
  if (dupRowids.includes(r.rowid)) continue
  const oldChoices = JSON.parse(r.choices)
  const perm = shuffledKeys() // old slot i -> new key perm[i]
  const newChoices = {}
  let newCorrect = null
  KEYS.forEach((oldKey, i) => {
    newChoices[perm[i]] = oldChoices[oldKey]
    if (oldKey === r.correct) newCorrect = perm[i]
  })
  updates.push({ rowid: r.rowid, choices: JSON.stringify(newChoices), correct: newCorrect })
}

const updateStmt = db.prepare('UPDATE questions SET choices = ?, correct = ? WHERE rowid = ?')
const deleteStmt = db.prepare('DELETE FROM questions WHERE rowid = ?')

const apply = db.transaction(() => {
  for (const rid of dupRowids) deleteStmt.run(rid)
  for (const u of updates) updateStmt.run(u.choices, u.correct, u.rowid)

  // ── Verify before committing — any throw rolls everything back ──────────
  const after = db.prepare('SELECT rowid, choices, correct FROM questions').all()
  if (after.length !== rows.length - dupRowids.length) {
    throw new Error(`row count mismatch: ${after.length} vs expected ${rows.length - dupRowids.length}`)
  }
  const beforeByRowid = new Map(rows.map((r) => [r.rowid, r]))
  for (const a of after) {
    const b = beforeByRowid.get(a.rowid)
    if (!b) throw new Error(`unexpected row ${a.rowid}`)
    const oldC = JSON.parse(b.choices)
    const newC = JSON.parse(a.choices)
    const oldTexts = KEYS.map((k) => oldC[k]).sort()
    const newTexts = KEYS.map((k) => newC[k]).sort()
    if (JSON.stringify(oldTexts) !== JSON.stringify(newTexts)) {
      throw new Error(`row ${a.rowid}: choice texts changed`)
    }
    if (newC[a.correct] !== oldC[b.correct]) {
      throw new Error(`row ${a.rowid}: correct answer text changed ("${oldC[b.correct]}" -> "${newC[a.correct]}")`)
    }
  }
})

apply()

const dist = db.prepare('SELECT correct, COUNT(*) AS n FROM questions GROUP BY correct ORDER BY correct').all()
console.log('new answer-key distribution:', dist.map((d) => `${d.correct}=${d.n}`).join(' '))
console.log(`final question count: ${db.prepare('SELECT COUNT(*) AS n FROM questions').get().n}`)
console.log('verified: every question kept its exact choice texts and correct answer text. committed.')
