import express, { type Request, type Response, type NextFunction } from 'express'
import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '../data')
mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(join(DATA_DIR, 'hce_trainer.db'))
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL,
    question TEXT NOT NULL,
    choices TEXT NOT NULL,
    correct TEXT NOT NULL,
    explanation TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category_id);

  CREATE TABLE IF NOT EXISTS mock_runs (
    id TEXT PRIMARY KEY,
    profile TEXT NOT NULL DEFAULT 'Shyam',
    date TEXT NOT NULL,
    score INTEGER NOT NULL,
    correct INTEGER NOT NULL,
    total INTEGER NOT NULL,
    essay_prompt TEXT,
    essay_text TEXT,
    essay_score INTEGER,
    essay_feedback TEXT,
    essay_strengths TEXT,
    essay_improvements TEXT
  );

  CREATE TABLE IF NOT EXISTS question_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES mock_runs(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    question TEXT NOT NULL,
    choices TEXT NOT NULL,
    correct TEXT NOT NULL,
    user_answer TEXT,
    explanation TEXT NOT NULL
  );
`)

// Migrate existing DBs that lack the profile column
try {
  db.exec(`ALTER TABLE mock_runs ADD COLUMN profile TEXT NOT NULL DEFAULT 'Shyam'`)
} catch {
  // Column already exists — ignore
}

interface QuestionResultRow {
  questionId: string
  categoryId: string
  question: string
  choices: Record<string, string>
  correct: string
  userAnswer?: string | null
  explanation: string
}

interface EssayGradePayload {
  score: number
  feedback: string
  strengths: string[]
  improvements: string[]
}

interface MockRunPayload {
  id: string
  profile: string
  date: string
  score: number
  correct: number
  total: number
  questions?: QuestionResultRow[]
  essayPrompt?: string
  essayText?: string
  essayGrade?: EssayGradePayload
}

const insertRun = db.prepare(`
  INSERT OR IGNORE INTO mock_runs
    (id, profile, date, score, correct, total, essay_prompt, essay_text, essay_score, essay_feedback, essay_strengths, essay_improvements)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const updateRunEssay = db.prepare(`
  UPDATE mock_runs
  SET essay_score = ?, essay_feedback = ?, essay_strengths = ?, essay_improvements = ?
  WHERE id = ?
`)

const insertQuestion = db.prepare(`
  INSERT INTO question_results
    (run_id, question_id, category_id, question, choices, correct, user_answer, explanation)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)

const app = express()
app.use(express.json({ limit: '12mb' }))

app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  next()
})
app.options('/{*path}', (_req: Request, res: Response) => { res.sendStatus(204) })

// Save a completed run (idempotent — OR IGNORE on duplicate id)
app.post('/api/db/runs', (req: Request, res: Response) => {
  const run = req.body as MockRunPayload
  if (!run.id || !run.date) {
    res.status(400).json({ error: 'Missing required fields' })
    return
  }
  db.transaction(() => {
    insertRun.run(
      run.id, run.profile ?? 'Shyam', run.date, run.score, run.correct, run.total,
      run.essayPrompt ?? null,
      run.essayText ?? null,
      run.essayGrade?.score ?? null,
      run.essayGrade?.feedback ?? null,
      run.essayGrade?.strengths ? JSON.stringify(run.essayGrade.strengths) : null,
      run.essayGrade?.improvements ? JSON.stringify(run.essayGrade.improvements) : null,
    )
    for (const q of run.questions ?? []) {
      insertQuestion.run(
        run.id, q.questionId, q.categoryId, q.question,
        JSON.stringify(q.choices), q.correct, q.userAnswer ?? null, q.explanation,
      )
    }
  })()
  res.json({ ok: true })
})

// Patch essay grade onto an existing run (called after async grading completes)
app.patch('/api/db/runs/:id/essay', (req: Request, res: Response) => {
  const grade = req.body as EssayGradePayload
  updateRunEssay.run(
    grade.score, grade.feedback,
    JSON.stringify(grade.strengths), JSON.stringify(grade.improvements),
    req.params.id,
  )
  res.json({ ok: true })
})

// List all runs for a profile (summary only, newest first)
app.get('/api/db/runs', (req: Request, res: Response) => {
  const profile = (req.query.profile as string) || 'Shyam'
  const rows = db.prepare('SELECT * FROM mock_runs WHERE profile = ? ORDER BY date DESC').all(profile)
  res.json(rows)
})

// Get one run with full question detail
app.get('/api/db/runs/:id', (req: Request, res: Response) => {
  const run = db.prepare('SELECT * FROM mock_runs WHERE id = ?').get(req.params.id)
  if (!run) { res.status(404).json({ error: 'Not found' }); return }
  const questions = db.prepare(
    'SELECT * FROM question_results WHERE run_id = ? ORDER BY id',
  ).all(req.params.id)
  const parsed = (questions as Array<Record<string, unknown>>).map((q) => ({
    ...q,
    choices: JSON.parse(q.choices as string) as Record<string, string>,
  }))
  res.json({ ...run, questions: parsed })
})

// Delete all runs for a profile (used by "Reset All Progress")
app.delete('/api/db/runs', (req: Request, res: Response) => {
  const profile = (req.query.profile as string) || 'Shyam'
  db.prepare('DELETE FROM mock_runs WHERE profile = ?').run(profile)
  res.json({ ok: true })
})

// ---------- Shared question bank (no profile — content is shared across all users) ----------

// Get all questions for a category
app.get('/api/db/questions/:categoryId', (req: Request, res: Response) => {
  const rows = db.prepare(
    'SELECT id, category_id AS categoryId, question, choices, correct, explanation FROM questions WHERE category_id = ? ORDER BY rowid',
  ).all(req.params.categoryId) as Array<Record<string, unknown>>
  const parsed = rows.map((q) => ({ ...q, choices: JSON.parse(q.choices as string) }))
  res.json(parsed)
})

// Atomically replace the question bank for a category
app.put('/api/db/questions/:categoryId', (req: Request, res: Response) => {
  const questions = req.body as Array<{
    id: string; question: string; choices: Record<string, string>; correct: string; explanation: string
  }>
  if (!Array.isArray(questions)) { res.status(400).json({ error: 'Expected array' }); return }
  const categoryId = req.params.categoryId
  const upsert = db.prepare(`
    INSERT INTO questions (id, category_id, question, choices, correct, explanation)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET question=excluded.question, choices=excluded.choices,
      correct=excluded.correct, explanation=excluded.explanation
  `)
  db.transaction(() => {
    db.prepare('DELETE FROM questions WHERE category_id = ?').run(categoryId)
    for (const q of questions) {
      upsert.run(q.id, categoryId, q.question, JSON.stringify(q.choices), q.correct, q.explanation)
    }
  })()
  res.json({ ok: true, count: questions.length })
})

const PORT = 3001
app.listen(PORT, () => {
  console.log(`HCE Trainer API  →  http://localhost:${PORT}`)
})
