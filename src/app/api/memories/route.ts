import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  deleteAllMemories,
  deleteMemory,
  listMemories,
} from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const items = await listMemories(session.sub, 200);
  return NextResponse.json({ memories: items });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idStr = req.nextUrl.searchParams.get("id");
  if (idStr === "all") {
    await deleteAllMemories(session.sub);
    return NextResponse.json({ ok: true });
  }
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  await deleteMemory(session.sub, id);
  return NextResponse.json({ ok: true });
}
