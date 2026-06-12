// Vision-based question-bank ingestion from the HOSA HCE textbook chapters.
//
// Why vision: the source PDFs are scanned books with a mangled OCR text layer
// (extraction yields gibberish like "Cha pte r 10"). Claude reads the page
// images cleanly, so we send each chapter as a PDF document block rather than
// feeding it broken text.
//
// What it fixes vs. the original browser pipeline:
//   - no 10k-char truncation: every chapter is sent in full (page-range chunks)
//   - on-book only, 7th-grade reading level (was "ILC competition level")
//   - coverage proportional to page count, capped at ~3 Q/page (kills the
//     forced-duplication seen in the 19-page Laws chapter -> 89 questions)
//
// Runs server-side (Node 20+, global fetch). Reads the API key from an env
// file so it never lands on a command line. Writes to a target SQLite DB,
// leaving the live DB untouched until you swap it in.
//
// Usage:
//   node scripts/ingest-questions.mjs --pdfdir <dir> --keyfile /etc/hce-trainer.env \
//        --db data/hce_trainer.new.db [--category lifespan-development] \
//        [--limit 12] [--dry] [--model claude-sonnet-4-6]

import Database from 'better-sqlite3'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// ── CLI args ────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]])
    return acc
  }, []),
)
const PDF_DIR = args.pdfdir || '.'
const KEYFILE = args.keyfile
const DB_PATH = args.db || 'data/hce_trainer.new.db'
const ONLY_CATEGORY = args.category || null
const LIMIT = args.limit ? Number(args.limit) : null // cap Q per category (dry runs)
const DRY = !!args.dry
const MODEL = args.model || 'claude-sonnet-4-6'
const CHUNK_PAGES = 15 // pages per API request
const Q_PER_PAGE = 3 // density cap -> avoids forced duplication
const MAX_PER_CATEGORY = 90

// ── API key (from env file or environment) ──────────────────────────────────
let API_KEY = process.env.ANTHROPIC_API_KEY || ''
if (!API_KEY && KEYFILE && existsSync(KEYFILE)) {
  const m = readFileSync(KEYFILE, 'utf8').match(/^ANTHROPIC_API_KEY=(.+)$/m)
  if (m) API_KEY = m[1].trim()
}
if (!API_KEY) {
  console.error('No API key. Set ANTHROPIC_API_KEY or pass --keyfile pointing at an env file.')
  process.exit(1)
}

// ── Source manifest: category -> chapter PDFs (filenames within PDF_DIR) ──────
// Extra chapters (Medical Terminology, Vital Signs, First Aid, Mobility) are
// folded into the categories the audit said should cover them.
const MANIFEST = {
  'health-informatics': ['Health_Informatics_Winger_Ch02.pdf', 'Health_Informatics_Winger_Ch03.pdf', 'Health_Informatics_Winger_Ch04.pdf', 'Healthcare_Tech_Marshall_Ch10.pdf'],
  'therapeutics': ['Therapeutic_Services_Winger_Ch06.pdf', 'Therapeutic_Services_Winger_Ch07.pdf', 'Therapeutic_Services_Winger_Ch08.pdf', 'Marshall_Ch13.pdf'],
  'diagnostics': ['Diagnostics_Winger_Ch10.pdf', 'Diagnostics_Winger_Ch11.pdf', 'Diagnostics_Winger_Ch12.pdf', 'Marshall_Ch11.pdf'],
  'support-services': ['Support_Services_Winger_Ch14.pdf', 'Support_Services_Winger_Ch15.pdf', 'Support_Services_Winger_Ch16.pdf'],
  'biotechnology': ['Biotechnology_Portion_Marshall_Ch07.pdf', 'Biotechnology_Winger_Ch18.pdf', 'Biotechnology_Winger_Ch19.pdf', 'Biotechnology_Winger_Ch20.pdf'],
  'communication': ['Communication_Marshall_Ch15.pdf', 'Marshall_Ch05.pdf'],
  'employability-skills': ['Employability_Skills_Marshall_Ch18.pdf', 'Exploring_Healthcare_Careers_Marshall_Ch02.pdf'],
  'healthcare-laws-ethics': ['Healthcare_Laws_Marshall_Ch03.pdf'],
  'safety-infection-control': ['Safety_and_Infection_Marshall_Ch04.pdf', 'Marshall_Ch12.pdf'],
  'lifespan-development': ['Lifespan_Development_Marshall_Ch09.pdf'],
}
const CATEGORY_NAME = {
  'health-informatics': 'Health Informatics', 'therapeutics': 'Therapeutics', 'diagnostics': 'Diagnostics',
  'support-services': 'Support Services', 'biotechnology': 'Biotechnology', 'communication': 'Communication',
  'employability-skills': 'Employability Skills', 'healthcare-laws-ethics': 'Healthcare Laws & Ethics',
  'safety-infection-control': 'Safety & Infection Control', 'lifespan-development': 'Lifespan Development',
}

// ── PDF helpers (poppler) ────────────────────────────────────────────────────
function pdfPageCount(path) {
  const out = execFileSync('pdfinfo', [path], { encoding: 'utf8' })
  return Number(out.match(/^Pages:\s+(\d+)/m)[1])
}
function extractPageRange(path, first, last, outPath) {
  // pdfseparate writes one file per page; pdfunite stitches the range back.
  const tmp = mkdtempSync(join(tmpdir(), 'pg-'))
  try {
    execFileSync('pdfseparate', ['-f', String(first), '-l', String(last), path, join(tmp, 'p-%d.pdf')])
    const parts = readdirSync(tmp).filter((f) => f.endsWith('.pdf'))
      .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
      .map((f) => join(tmp, f))
    execFileSync('pdfunite', [...parts, outPath])
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// ── Prompt ───────────────────────────────────────────────────────────────────
function systemPrompt(catName, count) {
  return `You are writing practice multiple-choice questions for a 7th-grade student studying for the HOSA Health Career Exploration event, category "${catName}".

STRICT RULES:
- Use ONLY facts visible in the attached textbook pages. Do NOT add outside knowledge, real-world facts, or details not printed on these pages. If it is not in these pages, do not test it.
- Reading level: 7th grade. Simple, clear language. Short scenarios are fine; jargon a 12-year-old wouldn't meet in this chapter is not.
- COVER THE BREADTH of the attached pages — pull from every major section/heading shown, not just the first pages.
- Each question: exactly 4 options (A-D), one unambiguously correct, three plausible wrong answers.
- The "explanation" must state the fact as the book presents it (one sentence).
- The "source" must cite the chapter and page number printed on the page the fact came from, e.g. "Ch. 9, p. 279".
- Do NOT write near-duplicate questions that test the same single fact.

Generate exactly ${count} questions. Return ONLY a JSON array, no markdown fences, no prose:
[{"question":"...","choices":{"A":"...","B":"...","C":"...","D":"..."},"correct":"A","explanation":"...","source":"..."}]`
}

// ── Anthropic call ────────────────────────────────────────────────────────────
let totalIn = 0, totalOut = 0
async function generateFromPdf(pdfPath, catName, count) {
  const data = readFileSync(pdfPath).toString('base64')
  const body = {
    model: MODEL,
    max_tokens: 8000,
    system: systemPrompt(catName, count),
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
        { type: 'text', text: `Generate ${count} questions covering the full breadth of these pages.` },
      ],
    }],
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    })
    const raw = await res.text()
    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && attempt < 3) { await new Promise((r) => setTimeout(r, 4000 * attempt)); continue }
      throw new Error(`API ${res.status}: ${raw.slice(0, 300)}`)
    }
    const json = JSON.parse(raw)
    totalIn += json.usage?.input_tokens ?? 0
    totalOut += json.usage?.output_tokens ?? 0
    const text = json.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    return parseArray(text)
  }
}
function parseArray(text) {
  let s = text.trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/m.exec(s)
  if (fence) s = fence[1].trim()
  const a = s.indexOf('['), b = s.lastIndexOf(']')
  if (a === -1 || b === -1) throw new Error('No JSON array in response')
  return JSON.parse(s.slice(a, b + 1))
}

// ── Validation / normalization ────────────────────────────────────────────────
const KEYS = ['A', 'B', 'C', 'D']
function valid(q) {
  return q && typeof q.question === 'string' && q.question.trim().length > 10 &&
    q.choices && KEYS.every((k) => typeof q.choices[k] === 'string' && q.choices[k].trim()) &&
    KEYS.includes(q.correct) && typeof q.explanation === 'string'
}
function shuffledKeys() {
  const p = [...KEYS]
  for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[p[i], p[j]] = [p[j], p[i]] }
  return p
}
function rebalance(q) {
  // randomize the correct-answer position so the bank isn't gameable
  const perm = shuffledKeys()
  const choices = {}, old = q.choices
  let correct = null
  KEYS.forEach((k, i) => { choices[perm[i]] = old[k]; if (k === q.correct) correct = perm[i] })
  return { ...q, choices, correct }
}

// ── Main ──────────────────────────────────────────────────────────────────────
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16), v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const cats = ONLY_CATEGORY ? [ONLY_CATEGORY] : Object.keys(MANIFEST)
const results = {}
const CONCURRENCY = args.concurrency ? Number(args.concurrency) : 8

// Build a flat task list of page-chunks across all categories, then run them
// through a concurrency-limited pool. Each task generates one chunk's questions.
const tasks = []
for (const cat of cats) {
  results[cat] = []
  const chapters = MANIFEST[cat].map((f) => {
    const path = join(PDF_DIR, f)
    if (!existsSync(path)) throw new Error(`missing PDF: ${path}`)
    return { f, path, pages: pdfPageCount(path) }
  })
  const totalPages = chapters.reduce((n, c) => n + c.pages, 0)
  let target = Math.min(MAX_PER_CATEGORY, Math.round(totalPages * Q_PER_PAGE))
  if (LIMIT) target = Math.min(target, LIMIT)
  console.log(`queued ${cat}: ${totalPages} pages, target ${target} questions`)
  for (const ch of chapters) {
    const chShare = Math.max(4, Math.round(target * (ch.pages / totalPages)))
    const nChunks = Math.ceil(ch.pages / CHUNK_PAGES)
    for (let c = 0; c < nChunks; c++) {
      const first = c * CHUNK_PAGES + 1
      const last = Math.min(ch.pages, first + CHUNK_PAGES - 1)
      const segShare = Math.max(3, Math.round(chShare * ((last - first + 1) / ch.pages)))
      tasks.push({ cat, name: CATEGORY_NAME[cat], path: ch.path, f: ch.f, first, last, segShare, nChunks })
    }
  }
}
console.log(`\n${tasks.length} chunk tasks, concurrency ${CONCURRENCY}\n`)

async function runTask(t) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'seg-'))
  const tmpPdf = join(tmpDir, 'seg.pdf')
  let qs = []
  try {
    if (t.nChunks === 1) {
      qs = await generateFromPdf(t.path, t.name, t.segShare)
    } else {
      extractPageRange(t.path, t.first, t.last, tmpPdf)
      qs = await generateFromPdf(tmpPdf, t.name, t.segShare)
    }
  } catch (e) {
    console.error(`  ! ${t.f} pp.${t.first}-${t.last}: ${e.message}`)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
  const good = qs.filter(valid)
  console.log(`  ${t.f} pp.${t.first}-${t.last}: asked ${t.segShare}, got ${good.length} valid`)
  for (const q of good) results[t.cat].push({ ...q, source: q.source || t.f })
}

// simple promise pool
const queue = [...tasks]
async function worker() { while (queue.length) await runTask(queue.shift()) }
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker))

// per-category dedup + answer-key rebalance
for (const cat of cats) {
  const seen = new Set()
  const deduped = []
  for (const q of results[cat]) {
    const norm = q.question.trim().toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(norm)) continue
    seen.add(norm)
    deduped.push(rebalance(q))
  }
  console.log(`${cat}: ${results[cat].length} collected -> ${deduped.length} after dedup`)
  results[cat] = deduped
}

// ── Write to target DB ────────────────────────────────────────────────────────
const dist = { A: 0, B: 0, C: 0, D: 0 }
let grandTotal = 0
for (const cat of cats) for (const q of results[cat]) { dist[q.correct]++; grandTotal++ }

if (DRY) {
  console.log('\n[DRY RUN] not writing DB. Sample questions:')
  const sample = results[cats[0]].slice(0, 5)
  for (const q of sample) {
    console.log(`\nQ: ${q.question}`)
    for (const k of KEYS) console.log(`   ${k}${k === q.correct ? '*' : ' '}: ${q.choices[k]}`)
    console.log(`   src: ${q.source} | ${q.explanation}`)
  }
} else {
  const db = new Database(DB_PATH)
  db.exec(`CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY, category_id TEXT NOT NULL, question TEXT NOT NULL,
    choices TEXT NOT NULL, correct TEXT NOT NULL, explanation TEXT NOT NULL, source TEXT);
    CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category_id);`)
  const insert = db.prepare('INSERT INTO questions (id, category_id, question, choices, correct, explanation, source) VALUES (?,?,?,?,?,?,?)')
  const tx = db.transaction(() => {
    for (const cat of cats) {
      db.prepare('DELETE FROM questions WHERE category_id = ?').run(cat)
      for (const q of results[cat]) insert.run(uuid(), cat, q.question.trim(), JSON.stringify(q.choices), q.correct, q.explanation.trim(), q.source ?? null)
    }
  })
  tx()
  console.log(`\nwrote ${grandTotal} questions to ${DB_PATH}`)
}

const costIn = (totalIn / 1e6) * 3, costOut = (totalOut / 1e6) * 15
console.log(`\ntokens: ${totalIn} in / ${totalOut} out  |  est. cost $${(costIn + costOut).toFixed(2)} (Sonnet 4.6 rates)`)
console.log(`answer-key distribution: A=${dist.A} B=${dist.B} C=${dist.C} D=${dist.D}  total=${grandTotal}`)
