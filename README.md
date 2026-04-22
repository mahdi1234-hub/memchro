# memchro

An AI agent with **24/7 long-term memory**. Every user has their own private
memory store — the agent never forgets what you tell it, across sessions,
across devices, across weeks.

## Stack

- **Next.js 14 (App Router, TypeScript)** — one deployable on Vercel
- **Cerebras** `gpt-oss-120b` via the OpenAI-compatible API — the only
  external *inference* service memchro calls
- A **Mem0-style memory pipeline** implemented directly in the codebase
  (fact extraction → embedding → dedup upsert → semantic recall)
- **`@xenova/transformers`** (`Xenova/all-MiniLM-L6-v2`, 384-dim) for
  embeddings — runs **inside the Next.js server function**, no API, no key
- **GitHub as the persistent vector store** — each user's memories +
  conversation live as a JSON file in a private repo, written through the
  GitHub Contents API. This is the ChromaDB-equivalent: it's still an
  open-source, directly-integrated store, and it persists forever in git
  history. Works on serverless (Vercel's filesystem is ephemeral, so an
  embedded ChromaDB `./memory_db` folder would be wiped on every cold
  start — GitHub sidesteps that entirely).
- **Passwordless magic-link auth** signed with `jose`, delivered via
  **Gmail SMTP** — multi-tenant by email

## Architecture

```
    ┌──────────────────────────────────────────────┐
    │  Next.js serverless function (single deploy) │
    │                                              │
    │   • memory.ts     (Mem0-style logic)         │
    │   • embeddings.ts (MiniLM, inside process)   │
    │   • cerebras.ts   (OpenAI-compat SDK)        │
    │   • storage.ts    (GitHub Contents API)      │
    └─────────┬─────────────────────┬──────────────┘
              │                     │
              ▼                     ▼
       Cerebras API          GitHub (private repo)
   (facts + chat responses)  (persistent memory per user)
```

## Chat flow (one request)

1. Verify the user's session cookie (signed JWT).
2. Fetch the user's memory file from GitHub:
   `<GITHUB_DATA_REPO>/users/<userId>.json`.
3. Embed the incoming message locally with MiniLM (384-d).
4. Rank stored memories by cosine similarity, keep top-8.
5. Build the Cerebras prompt:
   - `system`: memchro persona
   - `system`: MEMORIES block (the recalled top-8)
   - last 16 messages from the user's history
   - current user message
6. Call Cerebras `gpt-oss-120b` for the reply.
7. In a second Cerebras call, extract durable facts from the latest user
   turn ( `{ "facts": [...] }` ).
8. Embed each new fact, dedup against existing memories, append.
9. Commit the updated memory file back to GitHub in a single PUT.

## Local dev

```bash
cp .env.example .env.local
# fill in CEREBRAS_API_KEY, GITHUB_TOKEN, GITHUB_DATA_REPO, SMTP_*, AUTH_SECRET
npm install
npm run dev
```

The memory repo (`GITHUB_DATA_REPO`) is a normal private GitHub repo with a
default branch — no special setup is needed beyond creating it. Files are
created lazily on first write.

## Deploy to Vercel

1. Import this repo into Vercel (or `vercel link`).
2. Set these env vars on the project:
   - `CEREBRAS_API_KEY`
   - `CEREBRAS_MODEL` (optional, defaults to `gpt-oss-120b`)
   - `GITHUB_TOKEN` (a PAT with `repo` scope on the data repo)
   - `GITHUB_DATA_REPO` (`<owner>/<repo>`)
   - `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
   - `AUTH_SECRET`
   - `NEXT_PUBLIC_APP_URL` (optional — Vercel's `VERCEL_URL` is used if absent)
3. Deploy.

## Forgetting

Users can delete individual memories or wipe their entire memory from the
"Memories" panel in the chat UI. Every write is scoped to the session's
`userId` — there is no shared memory across users.

## Security

- Memory reads and writes are scoped by `userId` (base64url of the user's
  lowercased email), so one user can never touch another's file.
- Secrets are server-only; none of the SMTP / Cerebras / GitHub code is
  imported into the client bundle.
- Magic-link tokens expire in 15 minutes, session tokens in 30 days.
