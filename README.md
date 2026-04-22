# memchro

An AI agent with **24/7 long-term memory**. Every user has their own private
memory store — the agent never forgets what you tell it, across sessions,
across devices, across weeks.

Built with:

- **Next.js 14 (App Router, TypeScript)** — one deployable on Vercel
- **Cerebras** `gpt-oss-120b` via the OpenAI-compatible API — the only
  external service memchro calls
- **A Mem0-style memory pipeline** implemented directly in the codebase
  (fact extraction → embedding → vector upsert → semantic recall)
- **`@xenova/transformers`** (`all-MiniLM-L6-v2`, 384-dim) for embeddings —
  runs **inside the Next.js function**, no API, no key
- **Postgres + `pgvector`** as the vector store — serverless-native
  equivalent of ChromaDB (required because Vercel's filesystem is
  ephemeral; see "Why pgvector instead of embedded Chroma?" below)
- **Passwordless magic-link auth** signed with `jose`, delivered via
  **Gmail SMTP** — multi-tenant by email

## Why pgvector instead of embedded Chroma?

The original Mem0 + ChromaDB recipe uses `./memory_db` — an on-disk Chroma
folder that "persists forever across restarts". That assumes a long-lived
server process. On Vercel (and any serverless platform) every function
invocation gets a fresh, ephemeral filesystem, so an embedded Chroma folder
is wiped on every cold start — the memory does **not** actually persist.

We keep the exact same mental model (an LLM-driven "librarian" reading and
writing into a vector store) but swap the storage for **Postgres with the
`pgvector` extension**. It's still an open-source, directly-integrated
vector store — just one that lives in a place a serverless function can
reach without a fresh boot.

## Architecture

```
    ┌──────────────────────────────────────────────┐
    │  Next.js serverless function (single deploy) │
    │                                              │
    │   • memory.ts  (Mem0-style logic)            │
    │   • embeddings.ts  (MiniLM, inside process)  │
    │   • cerebras.ts  (OpenAI-compat SDK)         │
    └─────────┬─────────────────────┬──────────────┘
              │                     │
              ▼                     ▼
        Cerebras API          Postgres + pgvector
    (facts + chat responses)   (per-user memories)
```

## Chat flow (one request)

1. Authenticate the user from the signed session cookie.
2. Embed the new user message locally (MiniLM, 384-d).
3. Semantic search the user's memories in `pgvector` (top-k 8, cosine).
4. Build the Cerebras prompt: `system` + `MEMORIES` block + last 16
   messages + current message.
5. Call Cerebras `gpt-oss-120b` for the reply.
6. Persist both turns in `messages`.
7. Second Cerebras call extracts durable facts from the latest turn.
8. For each fact: embed it and upsert into `memories`
   (deduped against existing content).

## Local dev

```bash
cp .env.example .env.local
# fill in CEREBRAS_API_KEY, POSTGRES_URL, SMTP_*, AUTH_SECRET
npm install
npm run dev
```

Any Postgres with `pgvector` works. The schema is created automatically on
first request (`CREATE EXTENSION IF NOT EXISTS vector;` + three tables).

## Deploy to Vercel

1. `vercel link` this repo (or import it from GitHub in the Vercel dashboard).
2. In your Vercel project → Storage → **Create Postgres** (Neon). It
   auto-injects `POSTGRES_URL`. Neon ships with `pgvector` enabled.
3. Add the other env vars (`CEREBRAS_API_KEY`, `SMTP_*`, `AUTH_SECRET`).
4. Deploy.

## Env reference

See [`.env.example`](./.env.example).

## Forgetting

Users can delete individual memories or wipe their entire memory from the
"Memories" panel in the chat UI. There is no shared memory across users —
every row is scoped by `user_id`.

## Security note

- All memory reads and writes are scoped by the session's `user_id`.
- Secrets never touch the client bundle — every dependency that handles
  them (`pg`, `nodemailer`, `openai`, `@xenova/transformers`) is imported
  only from server routes / server components.
- Magic-link tokens are single-purpose (`kind: "link"`) and expire in 15
  minutes; session tokens (`kind: "session"`) expire in 30 days.
