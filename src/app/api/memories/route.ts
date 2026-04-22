import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  deleteAllMemoriesForUser,
  deleteMemoryForUser,
  listMemoriesForUser,
} from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const memories = await listMemoriesForUser({
    userId: session.sub,
    email: session.email,
  });
  return NextResponse.json({ memories });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (id === "all") {
    await deleteAllMemoriesForUser({
      userId: session.sub,
      email: session.email,
    });
    return NextResponse.json({ ok: true });
  }
  await deleteMemoryForUser({
    userId: session.sub,
    email: session.email,
    id,
  });
  return NextResponse.json({ ok: true });
}
