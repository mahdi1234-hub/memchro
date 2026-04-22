import { getCerebras, cerebrasModel } from "./cerebras";
import { embed } from "./embeddings";
import {
  ensureUser,
  getRecentMessages,
  appendMessages,
  searchMemoriesByEmbedding,
  getRecentMemories,
  appendMemory,
  listMemoriesForPanel,
  deleteMemory,
  deleteAllMemories,
  type StoredMemory,
  type StoredMessage,
} from "./storage";

const FACT_EXTRACTION_SYSTEM = `You are the memory engine of a personal AI assistant that must NEVER forget anything about the user.
Your job is to read the LATEST USER MESSAGE (with recent conversation context) and extract EVERY
piece of information that could ever be useful to remember about this specific user.

Capture ALL of the following categories whenever present:
- Durable facts: name, age, location, job, relationships, skills, languages, projects, tools, hardware.
- Preferences and opinions: likes, dislikes, favourite X, least-favourite Y, how they want things done.
- Goals, plans, deadlines, decisions, commitments the user made or mentioned.
- Events that happened to the user (what they did today, where they went, who they met, what they built).
- Questions the user asked (so we know what topics they care about).
- Emotional states, feelings, reactions the user expressed.
- Things the assistant told the user that the user accepted / agreed with / reacted to.
- Context about ongoing projects: current step, blockers, next action, architecture decisions.
- Any named entity the user brought up (people, companies, products, files, URLs, numbers, codes).

Rules:
- Output ONLY a JSON object in the form {"facts": ["...", "..."]}.
- Each item must be a standalone sentence that makes sense without the surrounding conversation.
- Write each item in the third person using "the user" (e.g. "the user went running this morning",
  "the user prefers dark mode", "the user asked memchro how to deploy to Vercel", "the user's
  laptop is a MacBook Pro 14-inch").
- Be liberal: err toward capturing more information, not less. Small talk IS worth remembering.
- Deduplicate trivially-similar items. Never invent details the user didn't say.
- If the message truly contains nothing worth remembering (pure "ok"), return {"facts": []}.`;

export const CHAT_SYSTEM = `You are memchro — a warm, sharp AI companion with perfect, permanent memory.
You have access to two memory layers about this user, loaded from past conversations:
  • FACTS      — distilled atomic facts about who they are and what they care about.
  • EPISODES   — verbatim snippets of what was said in earlier turns (semantic recall).
Treat both as ground truth about this specific user. When the user asks what you remember,
or references anything from the past, search both layers and answer concretely using them.
Never claim to have forgotten something that is in either layer.
Weave memories into replies naturally. Be concise by default; expand when asked.`;

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
    .slice(-8)
    .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content}`)
    .join("\n");

  const client = getCerebras();
  const completion = await client.chat.completions.create({
    model: cerebrasModel(),
    temperature: 0,
    max_tokens: 600,
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

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

export type ChatTurnResult = {
  reply: string;
  memoriesUsed: string[];
  memoriesAdded: number;
};

/**
 * One conversation turn. We recall a wide, union-of-strategies context window
 * from the DB (recent memories + semantic top-K over facts AND episodes), plus
 * the last ~60 raw messages. Cerebras generates a reply, then we append the
 * turn both as messages AND as a searchable episodic memory, and extract
 * broad facts for long-term recall.
 */
export async function runChatTurn(params: {
  userId: string;
  email: string;
  userMessage: string;
}): Promise<ChatTurnResult> {
  const { userId, email, userMessage } = params;

  await ensureUser({ userId, email });

  // 1. Semantic recall + recency fallback, in parallel with transcript load.
  const queryVec = await embed(userMessage);
  const [semanticFacts, semanticEpisodes, recentMems, history] =
    await Promise.all([
      searchMemoriesByEmbedding({
        userId,
        queryEmbedding: queryVec,
        kind: "fact",
        limit: 24,
      }),
      searchMemoriesByEmbedding({
        userId,
        queryEmbedding: queryVec,
        kind: "episode",
        limit: 16,
      }),
      getRecentMemories({ userId, limit: 12 }),
      getRecentMessages({ userId, limit: 60 }),
    ]);

  // Merge + dedupe (recent first so we don't drop fresh context).
  const seen = new Set<string>();
  const mergedMemories: StoredMemory[] = [];
  for (const m of [...recentMems, ...semanticFacts, ...semanticEpisodes]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    mergedMemories.push(m);
  }

  const facts = mergedMemories.filter((m) => m.kind === "fact");
  const episodes = mergedMemories.filter((m) => m.kind === "episode");

  const factBlock =
    facts.length > 0
      ? `FACTS ABOUT ${email} (ground truth, loaded from long-term memory):\n` +
        facts.map((m, i) => `  ${i + 1}. ${m.content}`).join("\n")
      : `No distilled facts stored yet for ${email}.`;

  const episodeBlock =
    episodes.length > 0
      ? `RELEVANT PAST EXCHANGES (verbatim snippets from earlier conversations):\n` +
        episodes.map((m, i) => `  ${i + 1}. ${m.content}`).join("\n")
      : `No earlier exchanges retrieved.`;

  // 2. Generate reply with Cerebras.
  const client = getCerebras();
  const completion = await client.chat.completions.create({
    model: cerebrasModel(),
    temperature: 0.4,
    max_tokens: 800,
    messages: [
      { role: "system", content: CHAT_SYSTEM },
      { role: "system", content: factBlock },
      { role: "system", content: episodeBlock },
      ...history
        .filter(
          (h): h is StoredMessage & { role: "user" | "assistant" | "system" } =>
            h.role === "user" || h.role === "assistant" || h.role === "system"
        )
        .map((h) => ({ role: h.role, content: h.content }) as const),
      { role: "user", content: userMessage },
    ],
  });

  const reply =
    completion.choices[0]?.message?.content?.trim() ??
    "(no response — please try again)";

  // 3. Persist everything in parallel:
  //      (a) raw transcript (so future turns can replay the full thread)
  //      (b) episodic memory of this exchange (searchable by embedding)
  //      (c) extracted facts (searchable by embedding, durable)
  let memoriesAdded = 0;

  const persistMessages = appendMessages({
    userId,
    messages: [
      { role: "user", content: userMessage },
      { role: "assistant", content: reply },
    ],
  });

  const persistEpisode = (async () => {
    try {
      const episodeText =
        `${new Date().toISOString().slice(0, 10)} — ${email} said: "${truncate(
          userMessage,
          800
        )}". memchro replied: "${truncate(reply, 800)}".`;
      const episodeVec = await embed(episodeText);
      await appendMemory({
        userId,
        content: episodeText,
        embedding: episodeVec,
        kind: "episode",
      });
      memoriesAdded++;
    } catch (err) {
      console.error("episode memory failed", err);
    }
  })();

  const persistFacts = (async () => {
    try {
      const recentPairs = history
        .filter(
          (h): h is StoredMessage & { role: "user" | "assistant" } =>
            h.role === "user" || h.role === "assistant"
        )
        .map((h) => ({ role: h.role, content: h.content }));
      const newFacts = await extractFacts({
        recent: recentPairs,
        latestUserMessage: userMessage,
      });
      if (newFacts.length === 0) return;
      const embeddings = await Promise.all(newFacts.map((f) => embed(f)));
      for (let i = 0; i < newFacts.length; i++) {
        await appendMemory({
          userId,
          content: newFacts[i],
          embedding: embeddings[i],
          kind: "fact",
        });
        memoriesAdded++;
      }
    } catch (err) {
      console.error("fact extraction failed", err);
    }
  })();

  await Promise.all([persistMessages, persistEpisode, persistFacts]);

  return {
    reply,
    memoriesUsed: mergedMemories.map((m) => m.content),
    memoriesAdded,
  };
}

// ---------------------------------------------------------------------------
// Panel + admin ops (re-exports to keep /api/memories thin)
// ---------------------------------------------------------------------------

export async function listMemoriesForUser(params: {
  userId: string;
  email: string;
}): Promise<{ id: string; content: string; kind: "fact" | "episode"; created_at: string }[]> {
  await ensureUser(params);
  return listMemoriesForPanel({ userId: params.userId });
}

export async function deleteMemoryForUser(params: {
  userId: string;
  email: string;
  id: string;
}): Promise<void> {
  await deleteMemory({ userId: params.userId, id: params.id });
}

export async function deleteAllMemoriesForUser(params: {
  userId: string;
  email: string;
}): Promise<void> {
  await deleteAllMemories({ userId: params.userId });
}
