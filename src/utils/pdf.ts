import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export async function extractTextFromPdfFiles(files: File[]): Promise<{
  fullText: string
  pageCount: number
}> {
  let pageCount = 0
  const parts: string[] = []

  for (const file of files) {
    const buf = await file.arrayBuffer()
    const doc = await pdfjsLib.getDocument({ data: buf }).promise
    pageCount += doc.numPages
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      const strings = content.items.map((item) =>
        'str' in item && typeof item.str === 'string' ? item.str : '',
      )
      parts.push(strings.join(' '))
    }
  }

  const fullText = parts.join('\n\n').replace(/\s+/g, ' ').trim()
  return { fullText, pageCount }
}
