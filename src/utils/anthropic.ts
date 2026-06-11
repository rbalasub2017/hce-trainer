const MODEL = 'claude-sonnet-4-6'
const ANTHROPIC_VERSION = '2023-06-01'

// All calls go through the app server, which attaches the API key.
// The key never exists in the browser.
const ANTHROPIC_PROXY_URL = '/api/anthropic/v1/messages'

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }

async function callClaudeRaw(
  system: string,
  content: string | ContentBlock[],
): Promise<string> {
  const res = await fetch(ANTHROPIC_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 32000,
      system,
      messages: [{ role: 'user', content }],
    }),
  })

  const raw = await res.text()
  if (!res.ok) {
    let detail = raw
    try {
      const j = JSON.parse(raw) as { error?: { message?: string } }
      detail = j.error?.message ?? raw
    } catch {
      /* use raw */
    }
    throw new Error(detail || `HTTP ${res.status}`)
  }

  const data = JSON.parse(raw) as {
    content: Array<{ type: string; text?: string }>
  }
  const text = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  return text
}

export async function callClaude(system: string, userMessage: string): Promise<string> {
  return callClaudeRaw(system, userMessage)
}

export async function callClaudeWithImage(
  system: string,
  imageBase64: string,
  mediaType: string,
  textPrompt: string,
): Promise<string> {
  return callClaudeRaw(system, [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
    { type: 'text', text: textPrompt },
  ])
}

export async function callClaudeWithDocument(
  system: string,
  docBase64: string,
  textPrompt: string,
): Promise<string> {
  return callClaudeRaw(system, [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: docBase64 } },
    { type: 'text', text: textPrompt },
  ])
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export async function callClaudeMessages(
  system: string,
  messages: ChatMessage[],
): Promise<string> {
  const res = await fetch(ANTHROPIC_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system,
      messages,
    }),
  })
  const raw = await res.text()
  if (!res.ok) {
    let detail = raw
    try {
      const j = JSON.parse(raw) as { error?: { message?: string } }
      detail = j.error?.message ?? raw
    } catch { /* use raw */ }
    throw new Error(detail || `HTTP ${res.status}`)
  }
  const data = JSON.parse(raw) as { content: Array<{ type: string; text?: string }> }
  return data.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
}

/** Strip markdown code fences if the model wrapped JSON. */
export function parseJsonArray<T>(raw: string): T[] {
  let s = raw.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(s)
  if (fence) s = fence[1].trim()
  const arrStart = s.indexOf('[')
  const arrEnd = s.lastIndexOf(']')
  if (arrStart === -1 || arrEnd === -1 || arrEnd <= arrStart) {
    throw new Error('Response did not contain a JSON array.')
  }
  s = s.slice(arrStart, arrEnd + 1)
  return JSON.parse(s) as T[]
}
