import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { runChatTurn } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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

  try {
    const result = await runChatTurn({
      userId: session.sub,
      email: session.email,
      userMessage: parsed.message.trim(),
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("/api/chat failed", err);
    return NextResponse.json(
      { error: "chat_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
