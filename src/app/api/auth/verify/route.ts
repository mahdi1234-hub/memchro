import { NextRequest, NextResponse } from "next/server";
import {
  createSession,
  setSessionCookie,
  verifyMagicLinkToken,
} from "@/lib/auth";
import { safeAppUrl } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(
      new URL("/signin?error=missing_token", safeAppUrl())
    );
  }
  const verified = await verifyMagicLinkToken(token);
  if (!verified) {
    return NextResponse.redirect(
      new URL("/signin?error=invalid_or_expired", safeAppUrl())
    );
  }
  try {
    const jwt = await createSession(verified.email);
    await setSessionCookie(jwt);
  } catch (err) {
    console.error("verify failed", err);
    return NextResponse.redirect(new URL("/signin?error=server", safeAppUrl()));
  }
  return NextResponse.redirect(new URL("/", safeAppUrl()));
}
