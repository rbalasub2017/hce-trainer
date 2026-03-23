import type { CategoryId } from './constants'
import { CATEGORIES } from './constants'
import type { EssayGrade } from './types'

export function categoryName(id: CategoryId): string {
  return CATEGORIES.find((c) => c.id === id)?.name ?? id
}

export function buildQuestionGenerationSystem(categoryId: CategoryId, count = 60): string {
  const name = categoryName(categoryId)
  return `You are a HOSA Health Career Exploration test question generator. Generate exactly ${count} multiple-choice questions for the category: ${name}. Each question must follow this exact JSON format — return ONLY a JSON array, no markdown, no explanation:
[{
  "question": "...",
  "choices": {"A": "...", "B": "...", "C": "...", "D": "..."},
  "correct": "A",
  "explanation": "...",
  "source": "..."
}]
Target difficulty: ILC (International Leadership Conference) competition level — rigorous, precise, and competition-ready. Go beyond surface recall: test deep understanding, application, analysis, and scenario-based reasoning. Vary question styles across the set.
Base questions on: HOSA HCE competition content, aligned with Goodheart-Willcox textbooks (Winger's Introduction to Health Science and Marshall's Health Science Concepts and Skills). When PDF content is provided, prioritize it heavily.
For the "source" field, cite the most specific reference available — e.g. "Introduction to Health Science, Ch. 5: Therapeutic Services" or "Health Science Concepts and Skills, Unit 3" or "HOSA HCE Study Guide". If the question draws from provided PDF content, reference the relevant chapter/section title. Keep the citation brief (under 15 words).`
}

export function buildQuestionGenerationUser(
  categoryId: CategoryId,
  extractedPdfTextTruncated: string,
  existingQuestionTexts?: string[],
): string {
  const name = categoryName(categoryId)
  let msg = `Category: ${name}. Here is the textbook content to base questions on:\n\n${extractedPdfTextTruncated}`
  if (existingQuestionTexts && existingQuestionTexts.length > 0) {
    const list = existingQuestionTexts
      .slice(0, 80)
      .map((q, i) => `${i + 1}. ${q}`)
      .join('\n')
    msg += `\n\nDo NOT repeat or closely paraphrase any of these already-generated questions:\n${list}`
  }
  return msg
}

export function buildEssayGradingSystem(): string {
  return `You are a HOSA Health Career Exploration (HCE) competition essay judge. Evaluate student essays written under timed exam conditions. Return ONLY valid JSON — no markdown, no text outside the JSON object. Schema:
{
  "score": <integer 1–10>,
  "feedback": "<2–3 sentence overall assessment>",
  "strengths": ["<specific strength>", "<specific strength>"],
  "improvements": ["<specific actionable improvement>", "<specific actionable improvement>"]
}
Rubric (each worth 2 points, total 10):
1. Content accuracy & depth — correct health career facts, terminology
2. Prompt relevance — all required elements of the prompt addressed
3. Organization — clear intro, developed body, conclusion
4. Healthcare vocabulary & specificity
5. Writing mechanics — grammar, clarity, sentence variety
Be honest and rigorous; this student is training for a national HOSA competition.`
}

export function buildEssayGradingUser(prompt: string, essayText: string): string {
  return `Essay Prompt:\n${prompt}\n\nStudent Response:\n${essayText}\n\nGrade this essay using the rubric.`
}

export function parseEssayGrade(raw: string): EssayGrade {
  let s = raw.trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/m.exec(s)
  if (fence) s = fence[1]!.trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON object in essay grading response.')
  const parsed = JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>
  return {
    score: Math.min(10, Math.max(1, Math.round(Number(parsed.score)))),
    feedback: String(parsed.feedback ?? ''),
    strengths: Array.isArray(parsed.strengths) ? (parsed.strengths as unknown[]).map(String) : [],
    improvements: Array.isArray(parsed.improvements) ? (parsed.improvements as unknown[]).map(String) : [],
  }
}
