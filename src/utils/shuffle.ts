export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr]
  shuffleInPlace(copy)
  return copy.slice(0, Math.min(n, copy.length))
}

/** Pick `n` items in priority order: lower `priority(item)` is drawn first, with
 *  ties broken randomly (shuffled within each tier). Only descends to a lower-
 *  priority tier once the higher ones are exhausted, so callers get e.g.
 *  previously-wrong questions before unseen ones before already-correct ones,
 *  while still degrading gracefully when a tier can't fill `n`. */
export function pickByPriority<T>(arr: T[], n: number, priority: (item: T) => number): T[] {
  const buckets = new Map<number, T[]>()
  for (const item of arr) {
    const p = priority(item)
    const b = buckets.get(p)
    if (b) b.push(item)
    else buckets.set(p, [item])
  }
  const out: T[] = []
  for (const p of [...buckets.keys()].sort((a, b) => a - b)) {
    const bucket = buckets.get(p)!
    shuffleInPlace(bucket)
    out.push(...bucket)
  }
  return out.slice(0, Math.min(n, out.length))
}
