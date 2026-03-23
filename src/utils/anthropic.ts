const MODEL = 'claude-sonnet-4-20250514'
const ANTHROPIC_VERSION = '2023-06-01'

function anthropicUrl(): string {
  if (import.meta.env.DEV) {
    return '/api/anthropic/v1/messages'
  }
  return 'https://api.anthropic.com/v1/messages'
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }

async function callClaudeRaw(
  apiKey: string,
  system: string,
  content: string | ContentBlock[],
): Promise<string> {
  const res = await fetch(anthropicUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
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

export async function callClaude(
  apiKey: string,
  system: string,
  userMessage: string,
): Promise<string> {
  return callClaudeRaw(apiKey, system, userMessage)
}

export async function callClaudeWithImage(
  apiKey: string,
  system: string,
  imageBase64: string,
  mediaType: string,
  textPrompt: string,
): Promise<string> {
  return callClaudeRaw(apiKey, system, [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
    { type: 'text', text: textPrompt },
  ])
}

export async function callClaudeWithDocument(
  apiKey: string,
  system: string,
  docBase64: string,
  textPrompt: string,
): Promise<string> {
  return callClaudeRaw(apiKey, system, [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: docBase64 } },
    { type: 'text', text: textPrompt },
  ])
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
