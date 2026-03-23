import { useTrainer } from '../context/TrainerContext'

export function SettingsScreen() {
  const { state, setApiKey } = useTrainer()

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-2xl font-bold text-[#003366]">Settings</h2>
        <p className="mt-1 text-slate-600">
          Manage the Anthropic API key used to generate questions and grade essays. This key is
          shared across all student profiles and is only accessible from the Parent account.
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <label htmlFor="api-key-input" className="block text-sm font-semibold text-slate-800">
          Anthropic API key
        </label>
        <p className="mt-1 text-xs text-slate-500">
          Stored only in this browser (localStorage). Shared across all profiles — students never
          need to enter or see this key.
        </p>
        <input
          id="api-key-input"
          type="password"
          autoComplete="off"
          value={state.apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-api03-…"
          className="mt-3 w-full max-w-xl rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-[#003366] focus:ring-2"
        />
        {state.apiKey && (
          <p className="mt-2 text-xs font-medium text-emerald-700">API key saved.</p>
        )}
      </section>
    </div>
  )
}
