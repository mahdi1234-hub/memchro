import { ensureSchema, getPool, toPgVector } from "./db";
import { embed } from "./embeddings";
import { getCerebras, cerebrasModel } from "./cerebras";

export type Memory = {
  id: number;
  user_id: string;
  content: string;
  created_at: string;
};

const FACT_EXTRACTION_SYSTEM = `You are a memory engine for a long-lived personal AI assistant.
Your job is to read the LATEST USER MESSAGE (given the short context of the ongoing conversation)
and extract stable, atomic facts about the user that will still be useful weeks or months from now.

Rules:
- Output ONLY a JSON object in the form {"facts": ["...", "..."]}.
- Each fact must be a standalone sentence that makes sense without the conversation context.
- Prefer durable facts (preferences, goals, relationships, locations, skills, projects, deadlines, decisions)
  over transient ones (greetings, acknowledgements, small talk, weather-of-the-day).
- Rewrite facts in the third person using "the user" (e.g., "the user's name is Mahdi",
  "the user lives in Tunis", "the user is building a Next.js app called memchro").
- If there are no durable facts, return {"facts": []}.
- Do not invent facts. Only capture what the user said.`;

const CHAT_SYSTEM = `You are memchro — a warm, sharp AI companion with perfect, permanent memory.
You have access to a set of MEMORIES about the user that were extracted from past conversations.
Always treat those memories as ground truth about this specific user and weave them naturally into
your replies when relevant. Never claim to have forgotten something that is in the memory list.
If the user asks what you remember, list the most relevant memories plainly.
Be concise by default, expand when asked.`;

function stripCodeFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function tryParseFacts(raw: string): string[] {
  try {
    const parsed = JSON.parse(stripCodeFences(raw));
    if (parsed && Array.isArray(parsed.facts)) {
      return parsed.facts
        .filter((f: unknown): f is string => typeof f === "string")
        .map((f: string) => f.trim())
        .filter((f: string) => f.length > 0 && f.length < 500);
    }
  } catch {
    // fall through
  }
  return [];
}

/**
 * Ask Cerebras to distil durable facts out of the latest user turn, given the
 * small rolling context of the conversation. This mirrors what Mem0 does in
 * its "extract" step.
 */
export async function extractFacts(params: {
  recent: { role: "user" | "assistant"; content: string }[];
  latestUserMessage: string;
}): Promise<string[]> {
  const { recent, latestUserMessage } = params;
  const conversationBlock = recent
    .slice(-6)
    .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content}`)
    .join("\n");

  const client = getCerebras();
  const completion = await client.chat.completions.create({
    model: cerebrasModel(),
    temperature: 0,
    max_tokens: 400,
    messages: [
      { role: "system", content: FACT_EXTRACTION_SYSTEM },
      {
        role: "user",
        content: `Recent conversation:\n${conversationBlock}\n\nLATEST USER MESSAGE:\n${latestUserMessage}\n\nReturn JSON only.`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  return tryParseFacts(raw);
}

export async function addMemoriesForUser(
  userId: string,
  facts: string[]
): Promise<number> {
  if (facts.length === 0) return 0;
  await ensureSchema();
  const pool = getPool();

  // dedupe within this batch on lowercased content
  const unique = Array.from(
    new Map(facts.map((f) => [f.toLowerCase(), f])).values()
  );

  let inserted = 0;
  for (const fact of unique) {
    // Skip if a near-identical memory already exists
    const { rows: existing } = await pool.query<{ id: number }>(
      `SELECT id FROM memories
        WHERE user_id = $1 AND LOWER(content) = LOWER($2)
        LIMIT 1`,
      [userId, fact]
    );
    if (existing.length > 0) continue;

    const vec = await embed(fact);
    await pool.query(
      `INSERT INTO memories (user_id, content, embedding)
       VALUES ($1, $2, $3::vector)`,
      [userId, fact, toPgVector(vec)]
    );
    inserted++;
  }
  return inserted;
}

export async function searchMemories(
  userId: string,
  query: string,
  k = 6
): Promise<Memory[]> {
  await ensureSchema();
  const pool = getPool();
  const vec = await embed(query);
  const { rows } = await pool.query<Memory>(
    `SELECT id, user_id, content, created_at
       FROM memories
      WHERE user_id = $1
      ORDER BY embedding <=> $2::vector
      LIMIT $3`,
    [userId, toPgVector(vec), k]
  );
  return rows;
}

export async function listMemories(userId: string, limit = 200): Promise<Memory[]> {
  await ensureSchema();
  const pool = getPool();
  const { rows } = await pool.query<Memory>(
    `SELECT id, user_id, content, created_at
       FROM memories
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

export async function deleteMemory(userId: string, id: number): Promise<void> {
  await ensureSchema();
  const pool = getPool();
  await pool.query(`DELETE FROM memories WHERE user_id = $1 AND id = $2`, [
    userId,
    id,
  ]);
}

export async function deleteAllMemories(userId: string): Promise<void> {
  await ensureSchema();
  const pool = getPool();
  await pool.query(`DELETE FROM memories WHERE user_id = $1`, [userId]);
}

export async function appendMessage(
  userId: string,
  role: "user" | "assistant" | "system",
  content: string
): Promise<void> {
  await ensureSchema();
  const pool = getPool();
  await pool.query(
    `INSERT INTO messages (user_id, role, content) VALUES ($1, $2, $3)`,
    [userId, role, content]
  );
}

export async function recentMessages(
  userId: string,
  limit = 20
): Promise<{ role: "user" | "assistant" | "system"; content: string }[]> {
  await ensureSchema();
  const pool = getPool();
  const { rows } = await pool.query<{
    role: "user" | "assistant" | "system";
    content: string;
  }>(
    `SELECT role, content
       FROM messages
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows.reverse();
}

export { CHAT_SYSTEM };
