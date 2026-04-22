/**
 * Neon Postgres + pgvector persistent storage for memchro.
 *
 * Why this design:
 *   - Vercel serverless has an ephemeral filesystem. We need a real external
 *     DB for 24/7 memory. Neon gives us serverless Postgres with `pgvector`,
 *     which is the proper vector-search substrate.
 *   - Everything the agent knows about a user is two tables:
 *       messages   — the raw running transcript (so we can replay the
 *                    last N turns into the LLM's context window).
 *       memories   — extracted facts + episodic snippets, each with a
 *                    384-dim embedding for semantic recall.
 *   - We use pgvector's `<=>` cosine-distance operator and an HNSW index
 *     for sub-millisecond top-K search even at millions of rows.
 *
 * We expose a small, typed API over the Prisma client so the rest of the
 * codebase (memory.ts, API routes) never deals with raw SQL.
 */

import { prisma } from "./prisma";

export type StoredMemory = {
  id: string;
  userId: string;
  kind: "fact" | "episode";
  content: string;
  embedding: number[];
  created_at: string;
};

export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPgVector(v: number[]): string {
  // pgvector input format is "[0.1,0.2,...]".
  return `[${v.join(",")}]`;
}

function rowToMemory(r: {
  id: string;
  user_id: string;
  kind: string;
  content: string;
  embedding: string | number[];
  created_at: Date | string;
}): StoredMemory {
  const emb =
    Array.isArray(r.embedding)
      ? (r.embedding as number[])
      : parsePgVector(r.embedding as string);
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind === "episode" ? "episode" : "fact",
    content: r.content,
    embedding: emb,
    created_at:
      r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

function parsePgVector(s: string): number[] {
  // "[0.1,0.2,...]" -> [0.1, 0.2, ...]
  if (!s) return [];
  const trimmed = s.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!trimmed) return [];
  return trimmed.split(",").map((x) => Number(x));
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function ensureUser(params: {
  userId: string;
  email: string;
}): Promise<void> {
  await prisma.user.upsert({
    where: { id: params.userId },
    create: { id: params.userId, email: params.email.toLowerCase() },
    update: { email: params.email.toLowerCase() },
  });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function getRecentMessages(params: {
  userId: string;
  limit?: number;
}): Promise<StoredMessage[]> {
  const limit = params.limit ?? 80;
  const rows = await prisma.message.findMany({
    where: { userId: params.userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  // We fetched newest-first for the LIMIT to work; flip to oldest-first for
  // feeding into the LLM's context window.
  return rows.reverse().map((r) => ({
    id: r.id,
    role: r.role as StoredMessage["role"],
    content: r.content,
    created_at: r.createdAt.toISOString(),
  }));
}

export async function appendMessages(params: {
  userId: string;
  messages: { role: StoredMessage["role"]; content: string }[];
}): Promise<void> {
  if (params.messages.length === 0) return;
  await prisma.message.createMany({
    data: params.messages.map((m) => ({
      userId: params.userId,
      role: m.role,
      content: m.content,
    })),
  });
}

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

export async function searchMemoriesByEmbedding(params: {
  userId: string;
  queryEmbedding: number[];
  limit?: number;
  kind?: "fact" | "episode";
}): Promise<StoredMemory[]> {
  const limit = params.limit ?? 24;
  const vec = toPgVector(params.queryEmbedding);
  const rows = params.kind
    ? await prisma.$queryRawUnsafe<
        {
          id: string;
          user_id: string;
          kind: string;
          content: string;
          embedding: string;
          created_at: Date;
        }[]
      >(
        `SELECT id, user_id, kind, content, embedding::text AS embedding, created_at
           FROM memories
          WHERE user_id = $1 AND kind = $2
          ORDER BY embedding <=> $3::vector
          LIMIT $4`,
        params.userId,
        params.kind,
        vec,
        limit
      )
    : await prisma.$queryRawUnsafe<
        {
          id: string;
          user_id: string;
          kind: string;
          content: string;
          embedding: string;
          created_at: Date;
        }[]
      >(
        `SELECT id, user_id, kind, content, embedding::text AS embedding, created_at
           FROM memories
          WHERE user_id = $1
          ORDER BY embedding <=> $2::vector
          LIMIT $3`,
        params.userId,
        vec,
        limit
      );
  return rows.map(rowToMemory);
}

export async function getRecentMemories(params: {
  userId: string;
  limit?: number;
}): Promise<StoredMemory[]> {
  const limit = params.limit ?? 12;
  const rows = await prisma.$queryRawUnsafe<
    {
      id: string;
      user_id: string;
      kind: string;
      content: string;
      embedding: string;
      created_at: Date;
    }[]
  >(
    `SELECT id, user_id, kind, content, embedding::text AS embedding, created_at
       FROM memories
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    params.userId,
    limit
  );
  return rows.map(rowToMemory);
}

export async function appendMemory(params: {
  userId: string;
  content: string;
  embedding: number[];
  kind: "fact" | "episode";
}): Promise<StoredMemory> {
  const vec = toPgVector(params.embedding);
  // Dedupe facts by exact content match for this user.
  if (params.kind === "fact") {
    const existing = await prisma.memory.findFirst({
      where: {
        userId: params.userId,
        kind: "fact",
        content: params.content,
      },
    });
    if (existing) {
      return {
        id: existing.id,
        userId: existing.userId,
        kind: "fact",
        content: existing.content,
        embedding: params.embedding,
        created_at: existing.createdAt.toISOString(),
      };
    }
  }
  const [row] = await prisma.$queryRawUnsafe<
    {
      id: string;
      user_id: string;
      kind: string;
      content: string;
      embedding: string;
      created_at: Date;
    }[]
  >(
    `INSERT INTO memories (id, user_id, kind, content, embedding, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4::vector, NOW())
     RETURNING id, user_id, kind, content, embedding::text AS embedding, created_at`,
    params.userId,
    params.kind,
    params.content,
    vec
  );
  return rowToMemory(row);
}

export async function listMemoriesForPanel(params: {
  userId: string;
}): Promise<{ id: string; content: string; kind: "fact" | "episode"; created_at: string }[]> {
  const rows = await prisma.memory.findMany({
    where: { userId: params.userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, content: true, kind: true, createdAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    kind: r.kind === "episode" ? "episode" : "fact",
    created_at: r.createdAt.toISOString(),
  }));
}

export async function deleteMemory(params: {
  userId: string;
  id: string;
}): Promise<void> {
  await prisma.memory.deleteMany({
    where: { id: params.id, userId: params.userId },
  });
}

export async function deleteAllMemories(params: {
  userId: string;
}): Promise<void> {
  await prisma.memory.deleteMany({
    where: { userId: params.userId },
  });
}
