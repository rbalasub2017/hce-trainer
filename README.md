# HCE Trainer

**HCE Trainer** is a browser-only prep tool for the HOSA *Health Career Exploration* event. It is aimed at middle school students: upload textbook PDFs, generate practice questions with Claude, run drills and timed mock exams, coach tiebreaker essays, and track progress — all with data stored in `localStorage`.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ recommended
- An [Anthropic](https://www.anthropic.com/) API key (Claude)

## Run locally

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:5173`).

The dev server includes a **proxy** for `https://api.anthropic.com` so the app can call Claude from the browser without CORS errors. The same proxy applies to `npm run preview` after a build.

## Build for production

```bash
npm run build
npm run preview
```

For a static deploy (e.g. GitHub Pages) with no proxy, direct browser calls to the Anthropic API are usually blocked by CORS. Host behind a same-origin proxy or serverless function, or run locally with `npm run dev` / `npm run preview`.

## Tech stack

- [Vite](https://vitejs.dev/) + [React](https://react.dev/) + TypeScript
- [Tailwind CSS](https://tailwindcss.com/) v4
- [pdfjs-dist](https://mozilla.github.io/pdf.js/) for client-side PDF text extraction
- Anthropic Messages API (`claude-sonnet-4-20250514`)

## Privacy

Your API key, extracted PDF text, generated questions, scores, and drafts are stored **only in this browser** (`localStorage`). Nothing is sent to a custom backend from this app.
