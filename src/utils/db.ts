import type { McQuestion, MockTestRun, ProgressSlice, SyncedProgress } from '../types'
import type { ProfileId } from '../constants'
import { normalizeProgressSlice } from '../storage'

/** Best-effort POST of a completed run to the local backend.
 *  Silently swallows errors so offline / no-server usage still works. */
export async function saveRunToBackend(run: MockTestRun, profile: ProfileId): Promise<void> {
  try {
    await fetch('/api/db/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...run, profile }),
    })
  } catch {
    // Server not running — graceful degradation; localStorage is source of truth
  }
}

/** Patch essay grade onto an already-saved run. */
export async function patchRunEssayGrade(
  runId: string,
  grade: MockTestRun['essayGrade'],
): Promise<void> {
  if (!grade) return
  try {
    await fetch(`/api/db/runs/${runId}/essay`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(grade),
    })
  } catch {
    // Best-effort
  }
}

/** Delete all runs from the backend for a profile (mirrors resetAllProgress). */
export async function deleteAllRunsFromBackend(profile: ProfileId): Promise<void> {
  try {
    await fetch(`/api/db/runs?profile=${encodeURIComponent(profile)}`, { method: 'DELETE' })
  } catch {
    // Best-effort
  }
}

/** Fetch a profile's synced progress from the server. Returns null when the
 *  server is unreachable or has no progress for the profile. Includes the
 *  reset epoch so the caller can tell a parent reset apart from a stale copy. */
export async function fetchProgressFromBackend(profile: ProfileId): Promise<SyncedProgress | null> {
  try {
    const res = await fetch(`/api/db/progress?profile=${encodeURIComponent(profile)}`)
    if (!res.ok) return null
    const data = await res.json() as Partial<SyncedProgress> | null
    return data ? normalizeProgressSlice(data) : null
  } catch {
    return null
  }
}

/** Persist a profile's progress to the server (best-effort, fire-and-forget).
 *  The server merges this into whatever it already holds, so a smaller push can
 *  never shrink the stored progress. `resetAt` is the epoch this device has
 *  acknowledged; the server rejects the push if it predates a newer reset. */
export async function saveProgressToBackend(
  profile: ProfileId,
  slice: ProgressSlice,
  resetAt: string | null,
): Promise<void> {
  try {
    await fetch('/api/db/progress', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...slice, resetAt, profile }),
    })
  } catch {
    // Best-effort
  }
}

/** Durably reset a profile's synced progress: stamps a fresh reset epoch on the
 *  server and empties the stored slice. Devices with an older epoch will wipe
 *  their local copy on next load instead of replaying it back. */
export async function resetProgressOnBackend(profile: ProfileId): Promise<void> {
  try {
    await fetch('/api/db/progress', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, reset: true }),
    })
  } catch {
    // Best-effort
  }
}

/** Fetch shared question bank for a category from the server. Returns null on failure. */
export async function fetchQuestionsFromServer(categoryId: string): Promise<McQuestion[] | null> {
  try {
    const res = await fetch(`/api/db/questions/${encodeURIComponent(categoryId)}`)
    if (!res.ok) return null
    const data = await res.json() as McQuestion[]
    return data.length > 0 ? data : null
  } catch {
    return null
  }
}

/** Persist the question bank for a category to the server (best-effort, fire-and-forget). */
export async function saveQuestionsToServer(categoryId: string, questions: McQuestion[]): Promise<void> {
  try {
    await fetch(`/api/db/questions/${encodeURIComponent(categoryId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(questions),
    })
  } catch {
    // Best-effort
  }
}
