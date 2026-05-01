# AskLex — Production Build Guide

AskLex is a Next.js app that ingests documents, stores embeddings in Supabase pgvector, and answers questions with an NVIDIA NIM → Groq → Gemini fallback chain.

## ✅ Prerequisites

- Node.js 18+
- A Supabase project with pgvector enabled
- NVIDIA NIM API key, plus Groq and Gemini keys for fallback
- Optional: Upstash Redis for caching

## 🔐 Environment Variables

Copy `.env.local.example` to `.env.local` and fill in your keys.

## 📦 Install Dependencies

```bash
npm install
```

## 🧠 Supabase Setup

Run the SQL in `src/lib/retriever.ts` to create:

- `documents` table
- `chunks` table
- `match_chunks` RPC
- pgvector index

## ▶️ Run Locally

```bash
npm run dev
```

## ✅ Build & Start (Production)

```bash
npm run build
npm run start
```

## 📡 API Endpoints

### `POST /api/ingest`

- Form-data: `file` (PDF/text) OR `url`
- Fields: `mode`, `title`, `country`
- Stores chunks + embeddings in Supabase

### `POST /api/chat`

- JSON: `question`, `documentId`, `mode`
- Optional: `stream`, `country`, `personaName`, `personaBio`
- Returns answer with provider and model used

## 🧾 Ads (Optional)

You can drop the `AdBanner` component into any layout or chat UI to enable AdSense slots.

## 📁 Key Files

- `src/lib/llm.ts`: NVIDIA NIM with Groq/Gemini fallbacks
- `src/lib/prompts.ts`: system prompts for all modes
- `src/lib/embedder.ts`: NVIDIA embedding + OpenAI fallback
- `src/lib/chunker.ts`: chunking + PDF extraction
- `src/lib/retriever.ts`: Supabase vector search
- `src/app/api/ingest/route.ts`: document ingestion
- `src/app/api/chat/route.ts`: main chat endpoint

## 📝 Notes

- Law mode is designed to be non-advisory and citation-focused.
- Streaming is NIM-only; if streaming fails, it falls back to non-streaming.
- Update `.env.local` before running locally.
