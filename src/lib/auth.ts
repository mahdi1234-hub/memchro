import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";

const SESSION_COOKIE = "memchro_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const LINK_MAX_AGE = 60 * 15; // 15 minutes

function secretKey() {
  return new TextEncoder().encode(env.authSecret());
}

export type SessionPayload = {
  sub: string; // stable user id (base64url of email)
  email: string;
  name?: string | null;
};

export function userIdFromEmail(email: string): string {
  return Buffer.from(email.toLowerCase().trim()).toString("base64url");
}

export async function createMagicLinkToken(email: string): Promise<string> {
  return new SignJWT({ email: email.toLowerCase().trim(), kind: "link" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${LINK_MAX_AGE}s`)
    .sign(secretKey());
}

export async function verifyMagicLinkToken(
  token: string
): Promise<{ email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.kind !== "link" || typeof payload.email !== "string") return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}

export async function createSession(email: string): Promise<string> {
  const sub = userIdFromEmail(email);
  const normalized = email.toLowerCase().trim();
  return new SignJWT({ sub, email: normalized, kind: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secretKey());
}

export async function setSessionCookie(jwt: string): Promise<void> {
  cookies().set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  cookies().set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return null;
  try {
    const { payload } = await jwtVerify(jwt, secretKey());
    if (payload.kind !== "session") return null;
    if (typeof payload.sub !== "string" || typeof payload.email !== "string")
      return null;
    return {
      sub: payload.sub,
      email: payload.email,
      name: (payload.name as string | undefined) ?? null,
    };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<SessionPayload> {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  return s;
}
