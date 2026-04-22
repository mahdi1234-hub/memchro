import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createMagicLinkToken } from "@/lib/auth";
import { sendMagicLinkEmail } from "@/lib/mailer";
import { safeAppUrl } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().email(),
});

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  const email = parsed.email.toLowerCase().trim();

  try {
    const token = await createMagicLinkToken(email);
    const url = `${safeAppUrl()}/api/auth/verify?token=${encodeURIComponent(token)}`;
    await sendMagicLinkEmail({ to: email, url });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("send magic link failed", err);
    return NextResponse.json(
      { error: "Failed to send sign-in email" },
      { status: 500 }
    );
  }
}
