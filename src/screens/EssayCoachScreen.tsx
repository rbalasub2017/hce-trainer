import React, { useEffect, useRef, useState } from 'react'
import { useTrainer } from '../context/TrainerContext'
import { LoadingPulse } from '../components/LoadingPulse'
import { callClaude, callClaudeMessages, type ChatMessage } from '../utils/anthropic'

// ── System prompts ─────────────────────────────────────────────────────────────

const BRIEF_SYSTEM = `You are a HOSA Health Career Exploration expert. Generate a Career Brief for a student writing an HCE tiebreaker essay. Respond with ONLY valid JSON (no markdown, no explanation):
{"career":"career name","duties":"2-3 primary duties as one sentence","education":"required education and training as one sentence","settings":"typical work settings as one sentence","salary":"median salary with typical range in parentheses","outlook":"10-year job growth outlook with percentage"}`

const COACH_SYSTEM = `You are a competition-level HOSA ILC essay coach for Health Career Exploration (HCE) tiebreaker essays. Your mission: help students rapidly improve their score through one targeted fix per coaching round.

Official HOSA HCE Tiebreaker Rubric:
- Health Career Knowledge (1–10): Accuracy of career facts — duties, education/training, salary, work settings, job outlook. Missing or wrong facts cost points.
- Depth of Understanding (1–10): Genuine insight beyond surface facts — personal connection, analysis, synthesis, "so what?" reflection. This is the hardest criterion to max.
- Organization & Structure (1–5): Clear intro with a thesis statement, developed body paragraphs, purposeful conclusion. Logical transitions between ideas.
- Writing Mechanics (1–5): Grammar, spelling, punctuation, sentence variety. Persistent errors deduct.

ILC-qualifying essays typically score 24+/30. Championship-level essays score 27–29.

For EACH coaching turn, respond in EXACTLY this format (no deviation):

## Scores This Round
| Criterion | Score | Max |
|---|---|---|
| Health Career Knowledge | X | 10 |
| Depth of Understanding | X | 10 |
| Organization & Structure | X | 5 |
| Writing Mechanics | X | 5 |
| **Total** | **X** | **30** |

## Your One Fix
[ONE specific, concrete, actionable instruction. Quote the student's actual text when identifying a problem. If a rewrite is needed, show exactly what the revised sentence or paragraph should look like. Never give vague advice like "improve your conclusion" — always show the specific change.]

## Why This Moves Your Score
[One sentence explaining why this single fix targets the biggest scoring gap right now.]`

const FINAL_JUDGE_SYSTEM = `You are a HOSA SLC/ILC competition judge evaluating a student's Health Career Exploration tiebreaker essay. Use the official HOSA HCE tiebreaker rubric:

- **Health Career Knowledge** (1–10): Accuracy of facts about the health career (duties, education/training requirements, work settings, salary, outlook). Penalize misconceptions or missing key facts.
- **Depth of Understanding** (1–10): Does the student demonstrate genuine insight beyond surface-level facts? Evidence of personal connection, analysis, or synthesis earns higher marks.
- **Organization & Structure** (1–5): Clear introduction with thesis, developed body paragraphs, and a purposeful conclusion. Logical flow between ideas.
- **Writing Mechanics** (1–5): Grammar, spelling, punctuation, sentence variety. Minor errors acceptable; persistent errors deduct points.

**Total: 30 points.**

Format your response with markdown headers (##) for each section. Give a score for each criterion, then a 2–3 sentence justification. End with "## Strengths" (3 bullets) and "## Areas for Improvement" (3 bullets). Be specific, constructive, and encouraging — this is a student who has been actively working to improve.`

const CHAT_SYSTEM_PREFIX = `You are a HOSA essay coach in an active coaching session. Answer the student's question concisely and practically — focus on what directly helps their competition score. Keep answers under 150 words unless a specific rewrite is requested.`

const TIME_PRESETS = [
  { label: '5 min', seconds: 300 },
  { label: '10 min', seconds: 600 },
  { label: '15 min', seconds: 900 },
  { label: '20 min', seconds: 1200 },
  { label: '30 min', seconds: 1800 },
]

// ── Types ──────────────────────────────────────────────────────────────────────

type CoachPhase = 'setup' | 'draft' | 'coaching' | 'complete'

interface CareerBrief {
  career: string
  duties: string
  education: string
  settings: string
  salary: string
  outlook: string
}

interface ScoreSnapshot {
  healthCareerKnowledge: number
  depthOfUnderstanding: number
  organizationStructure: number
  writingMechanics: number
  total: number
}

interface CoachTurn {
  attempt: number
  essaySnapshot: string
  response: string
  scores: ScoreSnapshot | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseScores(response: string): ScoreSnapshot | null {
  const hck = /Health Career Knowledge\s*\|\s*(\d+)/i.exec(response)
  const dou = /Depth of Understanding\s*\|\s*(\d+)/i.exec(response)
  const org = /Organization[^|]*\|\s*(\d+)/i.exec(response)
  const wm = /Writing Mechanics\s*\|\s*(\d+)/i.exec(response)
  if (!hck || !dou || !org || !wm) return null
  const s = {
    healthCareerKnowledge: parseInt(hck[1]!),
    depthOfUnderstanding: parseInt(dou[1]!),
    organizationStructure: parseInt(org[1]!),
    writingMechanics: parseInt(wm[1]!),
    total: 0,
  }
  s.total = s.healthCareerKnowledge + s.depthOfUnderstanding + s.organizationStructure + s.writingMechanics
  return s
}

function scoreColor(total: number): string {
  if (total >= 27) return 'text-emerald-700 bg-emerald-50 border-emerald-300'
  if (total >= 24) return 'text-blue-700 bg-blue-50 border-blue-300'
  if (total >= 20) return 'text-amber-700 bg-amber-50 border-amber-300'
  return 'text-red-700 bg-red-50 border-red-300'
}

function scoreLabel(total: number): string {
  if (total >= 27) return 'ILC-ready'
  if (total >= 24) return 'Competitive'
  if (total >= 20) return 'Developing'
  return 'Needs work'
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /\*\*(.+?)\*\*/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    parts.push(<strong key={match.index}>{match[1]}</strong>)
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let listItems: string[] = []
  let listStartIdx = 0
  const tableLines: string[] = []
  let inTable = false

  const flushList = (key: string) => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={key} className="my-2 ml-5 list-disc space-y-1">
          {listItems.map((item, i) => (
            <li key={i} className="text-slate-800">{renderInline(item)}</li>
          ))}
        </ul>
      )
      listItems = []
    }
  }

  const flushTable = (key: string) => {
    if (tableLines.length < 2) { tableLines.length = 0; return }
    const rows = tableLines.filter((l) => !/^[\s|:-]+$/.test(l))
    elements.push(
      <div key={key} className="my-3 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <tbody>
            {rows.map((row, ri) => {
              const cells = row.split('|').map((c) => c.trim()).filter(Boolean)
              return (
                <tr key={ri} className={ri === 0 ? 'bg-slate-100' : ri % 2 === 0 ? 'bg-slate-50' : 'bg-white'}>
                  {cells.map((cell, ci) => (
                    <td key={ci} className="border border-slate-200 px-3 py-1.5 text-slate-800">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
    tableLines.length = 0
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('|')) {
      flushList(`list-${listStartIdx}-${i}`)
      if (!inTable) inTable = true
      tableLines.push(trimmed)
      return
    }
    if (inTable) {
      flushTable(`table-${i}`)
      inTable = false
    }
    if (trimmed.startsWith('## ')) {
      flushList(`list-${listStartIdx}-${i}`)
      elements.push(<h2 key={i} className="mt-5 mb-2 text-base font-bold text-[#003366] border-b border-slate-200 pb-1">{trimmed.slice(3)}</h2>)
    } else if (trimmed.startsWith('# ')) {
      flushList(`list-${listStartIdx}-${i}`)
      elements.push(<h1 key={i} className="mt-5 mb-1 text-lg font-bold text-[#003366]">{trimmed.slice(2)}</h1>)
    } else if (/^[-*] /.test(trimmed)) {
      if (listItems.length === 0) listStartIdx = i
      listItems.push(trimmed.slice(2))
    } else if (trimmed === '') {
      flushList(`list-${listStartIdx}-${i}`)
    } else {
      flushList(`list-${listStartIdx}-${i}`)
      elements.push(<p key={i} className="my-1 text-slate-800 leading-relaxed">{renderInline(trimmed)}</p>)
    }
  })
  if (inTable) flushTable(`table-final`)
  flushList(`list-final`)
  return <div>{elements}</div>
}

// ── Score progression strip ────────────────────────────────────────────────────

function ScoreStrip({ turns }: { turns: CoachTurn[] }) {
  const scored = turns.filter((t) => t.scores !== null)
  if (scored.length === 0) return null
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-xs font-medium text-slate-500 mr-1">Score journey:</span>
      {scored.map((t, i) => {
        const s = t.scores!
        const color = scoreColor(s.total)
        return (
          <React.Fragment key={t.attempt}>
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${color}`}>
              {s.total}/30
            </span>
            {i < scored.length - 1 && (
              <svg className="h-3 w-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            )}
          </React.Fragment>
        )
      })}
      {scored.length > 0 && (
        <span className={`ml-1 text-xs font-semibold ${scoreColor(scored[scored.length - 1]!.scores!.total).split(' ')[0]}`}>
          — {scoreLabel(scored[scored.length - 1]!.scores!.total)}
        </span>
      )}
    </div>
  )
}

// ── Brief card ─────────────────────────────────────────────────────────────────

function BriefCard({ brief, expanded, onToggle }: { brief: CareerBrief; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-blue-700">Career Brief</span>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">{brief.career}</span>
        </div>
        <svg
          className={`h-4 w-4 text-blue-600 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-blue-200 px-4 py-3 grid grid-cols-1 gap-2 sm:grid-cols-2 text-sm">
          {[
            { label: 'Duties', value: brief.duties },
            { label: 'Education', value: brief.education },
            { label: 'Settings', value: brief.settings },
            { label: 'Salary', value: brief.salary },
            { label: 'Outlook', value: brief.outlook },
          ].map(({ label, value }) => (
            <div key={label}>
              <span className="font-semibold text-blue-900">{label}: </span>
              <span className="text-slate-700">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function EssayCoachScreen() {
  const { state } = useTrainer()
  const [phase, setPhase] = useState<CoachPhase>('setup')
  const [loading, setLoading] = useState(false)
  const [loadingLabel, setLoadingLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Setup state
  const [careerInput, setCareerInput] = useState('')
  const [brief, setBrief] = useState<CareerBrief | null>(null)
  const [briefExpanded, setBriefExpanded] = useState(true)

  // Draft + coaching state
  const [essay, setEssay] = useState('')
  const [coachTurns, setCoachTurns] = useState<CoachTurn[]>([])
  const [finalEval, setFinalEval] = useState<string | null>(null)

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Timer state
  const [timedMode, setTimedMode] = useState(false)
  const [timeLimit, setTimeLimit] = useState(600)
  const [timeRemaining, setTimeRemaining] = useState(600)
  const [timerActive, setTimerActive] = useState(false)
  const [timerExpired, setTimerExpired] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!timerActive) return
    intervalRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!)
          setTimerActive(false)
          setTimerExpired(true)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(intervalRef.current!)
  }, [timerActive])

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [chatMessages])

  const apiKey = state.apiKey.trim()

  const requireKey = (): boolean => {
    if (!apiKey) {
      setError('Add your Anthropic API key on the Setup screen first.')
      return false
    }
    return true
  }

  // ── Setup handlers ───────────────────────────────────────────────────────────

  const suggestCareer = async () => {
    if (!requireKey()) return
    setLoading(true)
    setLoadingLabel('Picking a health career for you…')
    setError(null)
    try {
      const careers = [
        'Registered Nurse', 'Physician Assistant', 'Respiratory Therapist',
        'Genetic Counselor', 'Nuclear Medicine Technologist', 'Prosthetist/Orthotist',
        'Clinical Laboratory Scientist', 'Perfusionist', 'Interventional Radiologist',
        'Certified Registered Nurse Anesthetist', 'Health Informatics Specialist',
        'Surgical Technologist', 'Occupational Therapist', 'Speech-Language Pathologist',
      ]
      const random = careers[Math.floor(Math.random() * careers.length)]!
      setCareerInput(random)
    } finally {
      setLoading(false)
    }
  }

  const buildBrief = async () => {
    if (!requireKey()) return
    if (!careerInput.trim()) {
      setError('Enter a health career first.')
      return
    }
    setLoading(true)
    setLoadingLabel(`Building Career Brief for ${careerInput.trim()}…`)
    setError(null)
    try {
      const raw = await callClaude(apiKey, BRIEF_SYSTEM, `Generate a Career Brief for: ${careerInput.trim()}`)
      const fence = /```(?:json)?\s*([\s\S]*?)```/m.exec(raw)
      const jsonStr = fence ? fence[1].trim() : raw.trim()
      const parsed = JSON.parse(jsonStr) as CareerBrief
      setBrief(parsed)
      setBriefExpanded(true)
    } catch {
      setError('Could not parse the Career Brief. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const startWriting = () => {
    if (!brief) return
    setBriefExpanded(false)
    setPhase('draft')
  }

  // ── Draft handlers ───────────────────────────────────────────────────────────

  const startTimer = () => {
    setTimeRemaining(timeLimit)
    setTimerExpired(false)
    setTimerActive(true)
  }

  const resetTimer = () => {
    clearInterval(intervalRef.current!)
    setTimerActive(false)
    setTimerExpired(false)
    setTimeRemaining(timeLimit)
  }

  const getCoaching = async () => {
    if (!requireKey()) return
    if (!essay.trim()) {
      setError('Write your essay first.')
      return
    }
    if (!brief) return
    clearInterval(intervalRef.current!)
    setTimerActive(false)

    const attemptNumber = coachTurns.length + 1
    setLoading(true)
    setLoadingLabel(attemptNumber === 1 ? 'Analyzing your essay…' : 'Coaching round ' + attemptNumber + '…')
    setError(null)

    try {
      const previousFixes = coachTurns
        .map((t) => {
          const m = /## Your One Fix\n([\s\S]*?)(?:\n## |$)/.exec(t.response)
          return m ? `Round ${t.attempt}: ${m[1].trim().slice(0, 120)}` : null
        })
        .filter(Boolean)

      const userMessage = [
        `Career: ${brief.career}`,
        '',
        'Career Brief (student reference):',
        `• Duties: ${brief.duties}`,
        `• Education: ${brief.education}`,
        `• Work Settings: ${brief.settings}`,
        `• Salary: ${brief.salary}`,
        `• Outlook: ${brief.outlook}`,
        '',
        `Student's Essay (Attempt #${attemptNumber}):`,
        '---',
        essay.trim(),
        '---',
        previousFixes.length > 0
          ? `\nPrevious coaching addressed:\n${previousFixes.join('\n')}\n\nDo NOT re-coach the same issue. Find the next highest-leverage fix.`
          : '',
      ].join('\n')

      const response = await callClaude(apiKey, COACH_SYSTEM, userMessage)
      const scores = parseScores(response)

      setCoachTurns((prev) => [
        ...prev,
        { attempt: attemptNumber, essaySnapshot: essay.trim(), response, scores },
      ])
      setPhase('coaching')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setLoading(false)
    }
  }

  // ── Coaching handlers ────────────────────────────────────────────────────────

  const getFinalGrade = async () => {
    if (!requireKey()) return
    if (!essay.trim()) return
    setLoading(true)
    setLoadingLabel('Running final judge evaluation…')
    setError(null)
    try {
      const user = `Career: ${brief?.career ?? 'Health Career'}\n\nStudent's Essay:\n${essay.trim()}`
      const result = await callClaude(apiKey, FINAL_JUDGE_SYSTEM, user)
      setFinalEval(result.trim())
      setPhase('complete')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setLoading(false)
    }
  }

  const sendChat = async () => {
    if (!requireKey()) return
    const msg = chatInput.trim()
    if (!msg || !brief) return
    setChatInput('')
    setChatLoading(true)
    setError(null)

    const newMessages: ChatMessage[] = [
      ...chatMessages,
      { role: 'user', content: msg },
    ]
    setChatMessages(newMessages)

    try {
      const system = [
        CHAT_SYSTEM_PREFIX,
        `Career being coached: ${brief.career}`,
        brief ? `Career Brief: Duties — ${brief.duties}. Education — ${brief.education}. Salary — ${brief.salary}. Outlook — ${brief.outlook}.` : '',
        essay.trim() ? `Current essay draft:\n---\n${essay.trim()}\n---` : '',
      ].filter(Boolean).join('\n\n')

      const response = await callClaudeMessages(apiKey, system, newMessages)
      setChatMessages([...newMessages, { role: 'assistant', content: response }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chat request failed.')
      setChatMessages(chatMessages) // revert on error
    } finally {
      setChatLoading(false)
    }
  }

  const startOver = () => {
    clearInterval(intervalRef.current!)
    setPhase('setup')
    setCareerInput('')
    setBrief(null)
    setEssay('')
    setCoachTurns([])
    setFinalEval(null)
    setChatMessages([])
    setChatInput('')
    setTimerActive(false)
    setTimerExpired(false)
    setTimeRemaining(timeLimit)
    setError(null)
  }

  const latestTurn = coachTurns[coachTurns.length - 1] ?? null

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[#003366]">Essay Coach</h2>
          <p className="mt-1 text-slate-600">
            {phase === 'setup' && 'Build your career brief, then iterate to ILC-ready.'}
            {phase === 'draft' && 'Write your essay — use the Career Brief as your reference.'}
            {phase === 'coaching' && 'Edit, resubmit, improve. One fix at a time.'}
            {phase === 'complete' && 'Final judge evaluation complete.'}
          </p>
        </div>
        {phase !== 'setup' && (
          <button
            type="button"
            onClick={startOver}
            disabled={loading}
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
          >
            Start Over
          </button>
        )}
      </header>

      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[1px]">
          <LoadingPulse label={loadingLabel} />
        </div>
      )}

      {error && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="flex-1">{error}</span>
          <button type="button" className="rounded-md bg-white px-3 py-1.5 text-red-700 ring-1 ring-red-200" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* ── Phase: Setup ──────────────────────────────────────────────────────── */}
      {phase === 'setup' && (
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Step 1 — Choose a Health Career</h3>
            <p className="mt-2 text-sm text-slate-600">
              Pick any health career you want to write about. The coach will build you a fact brief so your essay is grounded in accurate, rubric-scoring details.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="text"
                value={careerInput}
                onChange={(e) => setCareerInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void buildBrief() }}
                placeholder="e.g. Registered Nurse, Genetic Counselor…"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-[#003366] focus:ring-2"
              />
              <button
                type="button"
                onClick={() => void suggestCareer()}
                disabled={loading}
                className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Suggest one
              </button>
            </div>
            <button
              type="button"
              onClick={() => void buildBrief()}
              disabled={loading || !careerInput.trim()}
              className="mt-4 rounded-lg bg-[#003366] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#002244] disabled:opacity-50"
            >
              Build Career Brief
            </button>
          </section>

          {brief && (
            <section className="space-y-4">
              <BriefCard brief={brief} expanded={briefExpanded} onToggle={() => setBriefExpanded((v) => !v)} />
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <strong>Your ammunition is ready.</strong> These 5 facts will anchor your Health Career Knowledge score. The coach will check that you use them.
              </div>
              <button
                type="button"
                onClick={startWriting}
                className="w-full rounded-xl bg-[#CC0000] px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#b30000]"
              >
                Start Writing My Essay
              </button>
            </section>
          )}
        </div>
      )}

      {/* ── Phase: Draft ──────────────────────────────────────────────────────── */}
      {phase === 'draft' && brief && (
        <div className="space-y-6">
          <BriefCard brief={brief} expanded={briefExpanded} onToggle={() => setBriefExpanded((v) => !v)} />

          {/* Timed Mode */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={timedMode}
                onClick={() => { setTimedMode((v) => !v); resetTimer() }}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[#003366] focus:ring-offset-2 ${timedMode ? 'bg-[#003366]' : 'bg-slate-200'}`}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${timedMode ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
              <span className="text-sm font-semibold text-slate-800">Timed Mode</span>
              {timedMode && <span className="text-xs text-slate-500">Simulate competition conditions</span>}
            </div>
            {timedMode && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-slate-500">Duration:</span>
                  {TIME_PRESETS.map((p) => (
                    <button
                      key={p.seconds}
                      type="button"
                      disabled={timerActive}
                      onClick={() => { setTimeLimit(p.seconds); if (!timerActive) setTimeRemaining(p.seconds) }}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${timeLimit === p.seconds ? 'bg-[#003366] text-white' : 'border border-slate-300 bg-white text-slate-700 hover:border-[#003366] hover:text-[#003366]'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  {!timerActive && !timerExpired && (
                    <button type="button" onClick={startTimer} className="rounded-lg bg-[#003366] px-4 py-2 text-sm font-semibold text-white hover:bg-[#002244]">
                      Start Timer
                    </button>
                  )}
                  {(timerActive || timerExpired) && (
                    <button type="button" onClick={resetTimer} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                      Reset
                    </button>
                  )}
                  {(timerActive || timerExpired) && (
                    <div className={`flex items-center gap-2 rounded-lg px-4 py-2 font-mono text-lg font-bold ${timerExpired ? 'bg-red-50 text-red-700' : timeRemaining < 60 ? 'bg-orange-50 text-orange-700' : 'bg-slate-50 text-slate-800'}`}>
                      {timerExpired ? <span>Time's up!</span> : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {formatTime(timeRemaining)}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Essay textarea */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-800">Your essay</label>
              <span className="text-xs text-slate-500">{essay.trim().split(/\s+/).filter(Boolean).length} words</span>
            </div>
            <textarea
              value={essay}
              onChange={(e) => setEssay(e.target.value)}
              rows={16}
              disabled={timerExpired}
              className="mt-3 w-full rounded-lg border border-slate-300 p-3 text-sm leading-relaxed outline-none ring-[#003366] focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
              placeholder={timerExpired ? "Time's up — get your first coaching now." : `Write your essay about ${brief.career} here. Aim for 3–4 paragraphs (200–350 words).`}
            />
            <button
              type="button"
              onClick={() => void getCoaching()}
              disabled={loading || !essay.trim()}
              className="mt-4 rounded-lg bg-[#CC0000] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#b30000] disabled:opacity-50"
            >
              Get First Coaching
            </button>
          </section>
        </div>
      )}

      {/* ── Phase: Coaching ────────────────────────────────────────────────────── */}
      {phase === 'coaching' && brief && (
        <div className="space-y-6">
          <BriefCard brief={brief} expanded={briefExpanded} onToggle={() => setBriefExpanded((v) => !v)} />

          {/* Score progression */}
          {coachTurns.some((t) => t.scores) && (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <ScoreStrip turns={coachTurns} />
            </div>
          )}

          {/* Essay (still editable) */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-800">Your essay — edit and resubmit</label>
              <span className="text-xs text-slate-500">{essay.trim().split(/\s+/).filter(Boolean).length} words · Attempt {coachTurns.length + 1} next</span>
            </div>
            <textarea
              value={essay}
              onChange={(e) => setEssay(e.target.value)}
              rows={14}
              className="mt-3 w-full rounded-lg border border-slate-300 p-3 text-sm leading-relaxed outline-none ring-[#003366] focus:ring-2"
              placeholder="Edit your essay based on the coaching below, then resubmit."
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void getCoaching()}
                disabled={loading || !essay.trim()}
                className="rounded-lg bg-[#003366] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#002244] disabled:opacity-50"
              >
                Revise & Resubmit
              </button>
              {coachTurns.length >= 2 && (
                <button
                  type="button"
                  onClick={() => void getFinalGrade()}
                  disabled={loading}
                  className="rounded-lg bg-[#CC0000] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#b30000] disabled:opacity-50"
                >
                  Get Full Final Grade
                </button>
              )}
            </div>
          </section>

          {/* Latest coaching feedback */}
          {latestTurn && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-[#003366]">
                  Coaching — Round {latestTurn.attempt}
                </h3>
                {latestTurn.scores && (
                  <span className={`rounded-full border px-3 py-0.5 text-sm font-bold ${scoreColor(latestTurn.scores.total)}`}>
                    {latestTurn.scores.total}/30
                  </span>
                )}
              </div>
              <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm">
                <MarkdownBlock text={latestTurn.response} />
              </div>
            </section>
          )}

          {/* Previous rounds (collapsed) */}
          {coachTurns.length > 1 && (
            <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-600 hover:text-slate-800">
                View previous coaching rounds ({coachTurns.length - 1})
              </summary>
              <div className="divide-y divide-slate-100 border-t border-slate-200">
                {coachTurns.slice(0, -1).reverse().map((turn) => (
                  <div key={turn.attempt} className="px-4 py-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Round {turn.attempt}</span>
                      {turn.scores && (
                        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${scoreColor(turn.scores.total)}`}>
                          {turn.scores.total}/30
                        </span>
                      )}
                    </div>
                    <div className="text-sm">
                      <MarkdownBlock text={turn.response} />
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Chat Q&A */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Ask a follow-up question</h3>
            <p className="mt-1 text-xs text-slate-500">Ask about career facts, request a rewritten sentence, or get clarification on any feedback.</p>

            {chatMessages.length > 0 && (
              <div className="mt-4 space-y-3 max-h-72 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-3">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${msg.role === 'user' ? 'bg-[#003366] text-white' : 'bg-white border border-slate-200 text-slate-800'}`}>
                      {msg.role === 'assistant'
                        ? <MarkdownBlock text={msg.content} />
                        : msg.content
                      }
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400">
                      Thinking…
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChat() } }}
                placeholder={`e.g. "What's the median salary for a ${brief.career}?" or "Rewrite my intro sentence"`}
                disabled={chatLoading}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-[#003366] focus:ring-2 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void sendChat()}
                disabled={chatLoading || !chatInput.trim()}
                className="shrink-0 rounded-lg bg-[#003366] px-4 py-2 text-sm font-semibold text-white hover:bg-[#002244] disabled:opacity-50"
              >
                Ask
              </button>
            </div>
          </section>
        </div>
      )}

      {/* ── Phase: Complete ────────────────────────────────────────────────────── */}
      {phase === 'complete' && brief && (
        <div className="space-y-6">
          {/* Score journey */}
          {coachTurns.some((t) => t.scores) && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
              <p className="text-sm font-semibold text-emerald-800 mb-2">Your improvement journey</p>
              <ScoreStrip turns={coachTurns} />
              {coachTurns.length >= 2 && coachTurns[0]?.scores && coachTurns[coachTurns.length - 1]?.scores && (
                <p className="mt-2 text-sm text-emerald-700">
                  You gained{' '}
                  <strong>{coachTurns[coachTurns.length - 1]!.scores!.total - coachTurns[0]!.scores!.total} points</strong>{' '}
                  across {coachTurns.length} coaching rounds.
                </p>
              )}
            </div>
          )}

          {/* Final grade */}
          {finalEval && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
              <h3 className="text-lg font-semibold text-[#003366]">Final Judge Evaluation</h3>
              <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm">
                <MarkdownBlock text={finalEval} />
              </div>
            </section>
          )}

          <button
            type="button"
            onClick={startOver}
            className="w-full rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Practice with a New Career Topic
          </button>
        </div>
      )}
    </div>
  )
}
