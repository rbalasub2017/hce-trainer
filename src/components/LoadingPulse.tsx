export function LoadingPulse({ label }: { label: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
      role="status"
      aria-live="polite"
    >
      <div className="h-12 w-12 animate-pulse-api rounded-full border-4 border-[#003366] border-t-transparent" />
      <p className="animate-pulse-api text-center text-sm font-medium text-[#003366]">{label}</p>
    </div>
  )
}
