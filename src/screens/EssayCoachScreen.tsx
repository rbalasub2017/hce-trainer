import { useEffect, useRef, useState } from 'react'
import { DEFAULT_ESSAY_PROMPT } from '../constants'
import { useTrainer } from '../context/TrainerContext'
import { LoadingPulse } from '../components/LoadingPulse'
import { callClaude, callClaudeWithDocument, callClaudeWithImage } from '../utils/anthropic'

const JUDGE_SYSTEM = `You are a HOSA competition judge evaluating a middle school student's tiebreaker essay. Score it on: Content Accuracy (1-5), Depth of Knowledge (1-5), Organization (1-5), and Writing Quality (1-5). Give a total score out of 20. Provide 3 specific strengths and 3 specific improvements. Be constructive and encouraging. Format clearly with headers.`

const JUDGE_SYSTEM_HANDWRITTEN = `You are a HOSA competition judge evaluating a middle school student's handwritten tiebreaker essay. First, transcribe the handwritten text exactly as written. Then score it on: Content Accuracy (1-5), Depth of Knowledge (1-5), Organization (1-5), Writing Quality (1-5), and Legibility (1-5) — legibility is an official HOSA evaluation criterion. Give a total score out of 25. Provide 3 specific strengths and 3 specific improvements. Be constructive and encouraging. Format clearly with headers.`

const TIME_PRESETS = [
  { label: '5 min', seconds: 300 },
  { label: '10 min', seconds: 600 },
  { label: '15 min', seconds: 900 },
  { label: '20 min', seconds: 1200 },
]

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export function EssayCoachScreen() {
  const { state, setEssayPrompt, setEssayDraft } = useTrainer()
  const [loading, setLoading] = useState(false)
  const [loadingLabel, setLoadingLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [evaluation, setEvaluation] = useState<string | null>(null)
  const [uploadedImage, setUploadedImage] = useState<{ base64: string; mediaType: string; preview: string; isPdf: boolean; fileName: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const handleTimeLimitChange = (seconds: number) => {
    setTimeLimit(seconds)
    if (!timerActive) setTimeRemaining(seconds)
  }

  const displayPrompt = state.essayPrompt.trim() || DEFAULT_ESSAY_PROMPT

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const isPdf = file.type === 'application/pdf'
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const [header, base64] = dataUrl.split(',')
      const mediaType = header.replace('data:', '').replace(';base64', '')
      setUploadedImage({ base64, mediaType, preview: dataUrl, isPdf, fileName: file.name })
      setEvaluation(null)
    }
    reader.readAsDataURL(file)
  }

  const clearImage = () => {
    setUploadedImage(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const generatePrompt = async () => {
    const key = state.apiKey.trim()
    if (!key) {
      setError('Add your Anthropic API key on the Setup screen first.')
      return
    }
    setLoading(true)
    setLoadingLabel('Generating a new essay topic…')
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
    if (!uploadedImage && !state.essayDraft.trim()) {
      setError('Write your essay or upload a photo of your handwritten essay first.')
      return
    }
    setLoading(true)
    setLoadingLabel(uploadedImage ? 'Reading and grading your handwritten essay…' : 'Evaluating your essay…')
    setError(null)
    try {
      let text: string
      if (uploadedImage) {
        const prompt = `Essay prompt:\n${displayPrompt}\n\nPlease transcribe and evaluate the handwritten essay shown in the ${uploadedImage.isPdf ? 'PDF' : 'image'}.`
        if (uploadedImage.isPdf) {
          text = await callClaudeWithDocument(key, JUDGE_SYSTEM_HANDWRITTEN, uploadedImage.base64, prompt)
        } else {
          text = await callClaudeWithImage(key, JUDGE_SYSTEM_HANDWRITTEN, uploadedImage.base64, uploadedImage.mediaType, prompt)
        }
      } else {
        const user = `Essay prompt:\n${displayPrompt}\n\nStudent essay:\n${state.essayDraft}`
        text = await callClaude(key, JUDGE_SYSTEM, user)
      }
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
          <LoadingPulse label={loadingLabel} />
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
          Give Me a New Topic
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
          {timedMode && <span className="text-xs text-slate-500">Simulate competition conditions with a countdown</span>}
        </div>

        {timedMode && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Duration:</span>
              {TIME_PRESETS.map((p) => (
                <button
                  key={p.seconds}
                  type="button"
                  disabled={timerActive}
                  onClick={() => handleTimeLimitChange(p.seconds)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${timeLimit === p.seconds ? 'bg-[#003366] text-white' : 'border border-slate-300 bg-white text-slate-700 hover:border-[#003366] hover:text-[#003366]'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              {!timerActive && !timerExpired && (
                <button
                  type="button"
                  onClick={startTimer}
                  className="rounded-lg bg-[#003366] px-4 py-2 text-sm font-semibold text-white hover:bg-[#002244]"
                >
                  Start Timer
                </button>
              )}
              {(timerActive || timerExpired) && (
                <button
                  type="button"
                  onClick={resetTimer}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Reset
                </button>
              )}
              {(timerActive || timerExpired) && (
                <div className={`flex items-center gap-2 rounded-lg px-4 py-2 font-mono text-lg font-bold ${timerExpired ? 'bg-red-50 text-red-700' : timeRemaining < 60 ? 'bg-orange-50 text-orange-700' : 'bg-slate-50 text-slate-800'}`}>
                  {timerExpired ? (
                    <span>Time's up!</span>
                  ) : (
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

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold text-slate-800">Your essay</label>
          <span className="text-xs text-slate-500">Type below <span className="mx-1 font-bold">or</span> upload a photo of your handwritten essay</span>
        </div>

        {/* Handwritten upload */}
        <div className="mt-3">
          {uploadedImage ? (
            <div className="relative rounded-lg border border-slate-200 bg-slate-50 p-2">
              {uploadedImage.isPdf ? (
                <div className="flex items-center gap-3 rounded p-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <span className="text-sm font-medium text-slate-700">{uploadedImage.fileName}</span>
                </div>
              ) : (
                <img src={uploadedImage.preview} alt="Uploaded handwritten essay" className="max-h-64 w-full rounded object-contain" />
              )}
              <button
                type="button"
                onClick={clearImage}
                className="absolute right-2 top-2 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 shadow ring-1 ring-slate-200 hover:bg-red-50 hover:text-red-700"
              >
                Remove
              </button>
              <p className="mt-2 text-center text-xs text-slate-500">Handwritten essay uploaded — Claude will read and grade it, including legibility.</p>
            </div>
          ) : (
            <label className={`flex items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 ${timerExpired ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-[#003366] hover:bg-slate-100'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <span>Upload your handwritten essay <span className="text-slate-400">(JPG, PNG, HEIC, PDF)</span></span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                disabled={timerExpired}
                className="sr-only"
                onChange={handleImageUpload}
              />
            </label>
          )}
        </div>

        <div className="my-3 flex items-center gap-2">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs font-medium text-slate-400">or type your essay</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <textarea
          value={state.essayDraft}
          onChange={(e) => { setEssayDraft(e.target.value); if (e.target.value) clearImage() }}
          rows={14}
          disabled={!!uploadedImage || timerExpired}
          className="w-full rounded-lg border border-slate-300 p-3 text-sm leading-relaxed outline-none ring-[#003366] focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
          placeholder={timerExpired ? "Time's up — submit your essay for evaluation." : 'Type your response here…'}
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
