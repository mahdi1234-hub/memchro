import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getCerebras, cerebrasModel } from "@/lib/cerebras";
import {
  CHAT_SYSTEM,
  addMemoriesForUser,
  appendMessage,
  extractFacts,
  recentMessages,
  searchMemories,
} from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Long-ish limit: embedding cold start + Cerebras call can take a few seconds.
export const maxDuration = 60;

const Body = z.object({
  message: z.string().min(1).max(4000),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const userMessage = parsed.message.trim();

  const userId = session.sub;

  // 1. Recall — semantic search over all memories this user ever produced.
  const [memories, history] = await Promise.all([
    searchMemories(userId, userMessage, 8),
    recentMessages(userId, 16),
  ]);

  const memoryBlock =
    memories.length > 0
      ? `MEMORIES ABOUT ${session.email} (from past conversations — treat as ground truth):\n` +
        memories.map((m, i) => `  ${i + 1}. ${m.content}`).join("\n")
      : `No prior memories yet. This is the first substantive exchange with ${session.email}.`;

  const client = getCerebras();
  const completion = await client.chat.completions.create({
    model: cerebrasModel(),
    temperature: 0.4,
    max_tokens: 800,
    messages: [
      { role: "system", content: CHAT_SYSTEM },
      { role: "system", content: memoryBlock },
      ...history.map((h) => ({ role: h.role, content: h.content }) as const),
      { role: "user", content: userMessage },
    ],
  });

  const reply =
    completion.choices[0]?.message?.content?.trim() ??
    "(no response — please try again)";

  // 2. Persist the turn
  await appendMessage(userId, "user", userMessage);
  await appendMessage(userId, "assistant", reply);

  // 3. Fact extraction + memory upsert (fire and forget so we don't block the
  //    user on a second round trip, but we await because serverless might
  //    terminate otherwise).
  let newMemories = 0;
  try {
    const facts = await extractFacts({
      recent: history.filter(
        (h): h is { role: "user" | "assistant"; content: string } =>
          h.role === "user" || h.role === "assistant"
      ),
      latestUserMessage: userMessage,
    });
    newMemories = await addMemoriesForUser(userId, facts);
  } catch (err) {
    console.error("memory extraction failed", err);
  }

  return NextResponse.json({
    reply,
    memoriesUsed: memories.map((m) => m.content),
    memoriesAdded: newMemories,
  });
}
