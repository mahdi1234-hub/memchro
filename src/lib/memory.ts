import { getCerebras, cerebrasModel } from "./cerebras";
import { embed } from "./embeddings";
import {
  loadUserFile,
  saveUserFile,
  trimMessages,
  type StoredMemory,
  type StoredMessage,
  type UserFile,
} from "./storage";

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

export const CHAT_SYSTEM = `You are memchro — a warm, sharp AI companion with perfect, permanent memory.
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

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function searchMemoriesIn(
  memories: StoredMemory[],
  queryEmbedding: number[],
  k = 8
): StoredMemory[] {
  return memories
    .map((m) => ({ m, score: cosine(m.embedding, queryEmbedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.m);
}

export function dedupeAndAppend(
  existing: StoredMemory[],
  newFacts: { content: string; embedding: number[] }[]
): { merged: StoredMemory[]; added: number } {
  const seen = new Set(existing.map((m) => m.content.trim().toLowerCase()));
  let added = 0;
  const out = [...existing];
  for (const f of newFacts) {
    const key = f.content.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: crypto.randomUUID(),
      content: f.content.trim(),
      embedding: f.embedding,
      created_at: new Date().toISOString(),
    });
    added++;
  }
  return { merged: out, added };
}

export type ChatTurnResult = {
  reply: string;
  memoriesUsed: string[];
  memoriesAdded: number;
};

export async function runChatTurn(params: {
  userId: string;
  email: string;
  userMessage: string;
}): Promise<ChatTurnResult> {
  const { userId, email, userMessage } = params;

  const { file, sha } = await loadUserFile({ userId, email });

  // 1. Embed the user message and recall relevant memories.
  const queryVec = await embed(userMessage);
  const recalled = searchMemoriesIn(file.memories, queryVec, 8);

  const memoryBlock =
    recalled.length > 0
      ? `MEMORIES ABOUT ${email} (from past conversations — treat as ground truth):\n` +
        recalled.map((m, i) => `  ${i + 1}. ${m.content}`).join("\n")
      : `No prior memories yet. This is the first substantive exchange with ${email}.`;

  const history = trimMessages(file.messages);

  // 2. Generate reply with Cerebras.
  const client = getCerebras();
  const completion = await client.chat.completions.create({
    model: cerebrasModel(),
    temperature: 0.4,
    max_tokens: 800,
    messages: [
      { role: "system", content: CHAT_SYSTEM },
      { role: "system", content: memoryBlock },
      ...history
        .filter(
          (h): h is StoredMessage & { role: "user" | "assistant" | "system" } =>
            h.role === "user" || h.role === "assistant" || h.role === "system"
        )
        .slice(-16)
        .map((h) => ({ role: h.role, content: h.content }) as const),
      { role: "user", content: userMessage },
    ],
  });

  const reply =
    completion.choices[0]?.message?.content?.trim() ??
    "(no response — please try again)";

  // 3. Append messages.
  const now = new Date().toISOString();
  const appendedMessages: StoredMessage[] = [
    ...history,
    { role: "user", content: userMessage, created_at: now },
    { role: "assistant", content: reply, created_at: now },
  ];

  // 4. Extract durable facts + embed + upsert.
  let memoriesAdded = 0;
  let newMemories: StoredMemory[] = file.memories;
  try {
    const facts = await extractFacts({
      recent: history
        .filter(
          (h): h is StoredMessage & { role: "user" | "assistant" } =>
            h.role === "user" || h.role === "assistant"
        )
        .map((h) => ({ role: h.role, content: h.content })),
      latestUserMessage: userMessage,
    });
    if (facts.length > 0) {
      const embeddings = await Promise.all(facts.map((f) => embed(f)));
      const factsWithVecs = facts.map((content, i) => ({
        content,
        embedding: embeddings[i],
      }));
      const { merged, added } = dedupeAndAppend(file.memories, factsWithVecs);
      newMemories = merged;
      memoriesAdded = added;
    }
  } catch (err) {
    console.error("memory extraction failed", err);
  }

  // 5. Persist everything back to GitHub in a single PUT.
  const updated: UserFile = {
    version: 1,
    email,
    memories: newMemories,
    messages: trimMessages(appendedMessages),
  };
  await saveUserFile({
    userId,
    file: updated,
    sha,
    message: `memchro: ${email} +${memoriesAdded} memory`,
  });

  return {
    reply,
    memoriesUsed: recalled.map((m) => m.content),
    memoriesAdded,
  };
}

export async function listMemoriesForUser(params: {
  userId: string;
  email: string;
}): Promise<{ id: string; content: string; created_at: string }[]> {
  const { file } = await loadUserFile(params);
  return file.memories
    .map((m) => ({ id: m.id, content: m.content, created_at: m.created_at }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function deleteMemoryForUser(params: {
  userId: string;
  email: string;
  id: string;
}): Promise<void> {
  const { file, sha } = await loadUserFile({
    userId: params.userId,
    email: params.email,
  });
  const filtered = file.memories.filter((m) => m.id !== params.id);
  if (filtered.length === file.memories.length) return;
  await saveUserFile({
    userId: params.userId,
    file: { ...file, memories: filtered },
    sha,
    message: `memchro: forget 1 memory for ${params.email}`,
  });
}

export async function deleteAllMemoriesForUser(params: {
  userId: string;
  email: string;
}): Promise<void> {
  const { file, sha } = await loadUserFile(params);
  await saveUserFile({
    userId: params.userId,
    file: { ...file, memories: [] },
    sha,
    message: `memchro: forget all memories for ${params.email}`,
  });
}
