import type { CategoryId } from './constants'
import { CATEGORIES } from './constants'

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
  "explanation": "..."
}]
Target difficulty: ILC (International Leadership Conference) competition level — rigorous, precise, and competition-ready. Go beyond surface recall: test deep understanding, application, analysis, and scenario-based reasoning. Vary question styles across the set.
Base questions on: HOSA HCE competition content, aligned with Goodheart-Willcox textbooks (Winger's Introduction to Health Science and Marshall's Health Science Concepts and Skills). When PDF content is provided, prioritize it heavily.`
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

export function buildCramSheetSystem(): string {
  return `You are an expert HOSA Health Career Exploration (HCE) study guide creator.
Create a comprehensive bullet-point cheat sheet covering the most testable facts for each HCE category.
Format EXACTLY as follows — use this structure for every category:

## [Category Name]
• [Key fact]
• [Key fact]
(5–8 bullets per category, crisp and memorable)

Rules:
- Be concise; target middle school students preparing for HOSA HCE competition
- Focus on definitions, key processes, essential terms, and facts most likely on a multiple-choice exam
- Every bullet must be a standalone testable fact, not a vague summary
- Do NOT add an introduction or conclusion — output only the category sections`
}

export function buildCramSheetUser(
  categoriesText: Array<{ name: string; text: string }>,
): string {
  const sections = categoriesText
    .map(({ name, text }) => {
      const snippet = text.trim().slice(0, 1500)
      return snippet
        ? `=== ${name} ===\n${snippet}`
        : `=== ${name} ===\n(No PDF uploaded — use general HOSA HCE knowledge)`
    })
    .join('\n\n')
  return `Generate a 1-page HCE Cram Sheet based on this content:\n\n${sections}`
}
