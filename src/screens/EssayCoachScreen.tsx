import { useState } from 'react'
import { DEFAULT_ESSAY_PROMPT } from '../constants'
import { useTrainer } from '../context/TrainerContext'
import { LoadingPulse } from '../components/LoadingPulse'
import { callClaude } from '../utils/anthropic'

const JUDGE_SYSTEM = `You are a HOSA competition judge evaluating a middle school student's tiebreaker essay. Score it on: Content Accuracy (1-5), Depth of Knowledge (1-5), Organization (1-5), and Writing Quality (1-5). Give a total score out of 20. Provide 3 specific strengths and 3 specific improvements. Be constructive and encouraging. Format clearly with headers.`

export function EssayCoachScreen() {
  const { state, setEssayPrompt, setEssayDraft } = useTrainer()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [evaluation, setEvaluation] = useState<string | null>(null)

  const displayPrompt = state.essayPrompt.trim() || DEFAULT_ESSAY_PROMPT

  const generatePrompt = async () => {
    const key = state.apiKey.trim()
    if (!key) {
      setError('Add your Anthropic API key on the Setup screen first.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const system =
        'You write short essay prompts for HOSA Health Career Exploration tiebreaker practice. Output only the prompt text, no preamble.'
      const user = `Write one new essay prompt in the same style as this example, but with a different angle or career focus:\n\n"${DEFAULT_ESSAY_PROMPT}"`
      const text = await callClaude(key, system, user)
      setEssayPrompt(text.trim())
      setEvaluation(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setLoading(false)
    }
  }

  const evaluateEssay = async () => {
    const key = state.apiKey.trim()
    if (!key) {
      setError('Add your Anthropic API key on the Setup screen first.')
      return
    }
    if (!state.essayDraft.trim()) {
      setError('Write your essay first.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const user = `Essay prompt:\n${displayPrompt}\n\nStudent essay:\n${state.essayDraft}`
      const text = await callClaude(key, JUDGE_SYSTEM, user)
      setEvaluation(text.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-2xl font-bold text-[#003366]">Essay Coach</h2>
        <p className="mt-1 text-slate-600">Practice the HCE tiebreaker essay with AI feedback.</p>
      </header>

      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[1px]">
          <LoadingPulse label="Talking to Claude…" />
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Prompt</h3>
        <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-4 text-slate-800">
          {displayPrompt}
        </div>
        <button
          type="button"
          onClick={() => void generatePrompt()}
          disabled={loading}
          className="mt-4 rounded-lg border border-[#003366] bg-white px-4 py-2 text-sm font-semibold text-[#003366] hover:bg-slate-50 disabled:opacity-50"
        >
          Generate New Essay Prompt
        </button>
      </section>

      {error && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="flex-1">{error}</span>
          <button
            type="button"
            className="rounded-md bg-white px-3 py-1.5 text-red-700 ring-1 ring-red-200"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <label className="text-sm font-semibold text-slate-800">Your essay</label>
        <textarea
          value={state.essayDraft}
          onChange={(e) => setEssayDraft(e.target.value)}
          rows={14}
          className="mt-3 w-full rounded-lg border border-slate-300 p-3 text-sm leading-relaxed outline-none ring-[#003366] focus:ring-2"
          placeholder="Type your response here…"
        />
        <button
          type="button"
          onClick={() => void evaluateEssay()}
          disabled={loading}
          className="mt-4 rounded-lg bg-[#CC0000] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#b30000] disabled:opacity-50"
        >
          Evaluate My Essay
        </button>
      </section>

      {evaluation && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
          <h3 className="text-lg font-semibold text-[#003366]">Judge feedback</h3>
          <div className="mt-4 whitespace-pre-wrap rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">
            {evaluation}
          </div>
        </section>
      )}
    </div>
  )
}
