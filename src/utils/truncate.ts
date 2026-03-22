/** Take a slice from the middle of long text for more representative coverage. */
export function truncateMiddle(text: string, maxLen: number): string {
  const t = text.trim()
  if (t.length <= maxLen) return t
  const start = Math.floor((t.length - maxLen) / 2)
  return t.slice(start, start + maxLen)
}
