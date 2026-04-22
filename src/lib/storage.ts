/**
 * GitHub-backed persistent storage for memchro.
 *
 * Why? Our deployment target is Vercel serverless, which has an ephemeral
 * filesystem. We want a single external dependency — the user's GitHub PAT
 * they already provided — to act as a true 24/7 persistent database.
 *
 * Layout (inside $GITHUB_DATA_REPO):
 *
 *   users/<userId>.json         {
 *     version: 1,
 *     email: "...",
 *     memories: [ { id, content, embedding, created_at } ],
 *     messages: [ { role, content, created_at } ]
 *   }
 *
 * userId is a url-safe base64 of the user's lowercased email — stable across
 * sessions and containers, and safe to use as a filename.
 *
 * Each chat turn does one GET and one PUT per user's file. We keep the last
 * 200 messages and unlimited memories (deduped + optionally trimmed).
 */

import { env } from "./env";

export type StoredMemory = {
  id: string;
  content: string;
  embedding: number[];
  created_at: string;
};

export type StoredMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

export type UserFile = {
  version: 1;
  email: string;
  memories: StoredMemory[];
  messages: StoredMessage[];
};

const MAX_MESSAGES = 200;

function apiRoot(): string {
  return `https://api.github.com/repos/${env.githubDataRepo()}/contents`;
}

function userFilePath(userId: string): string {
  return `users/${encodeURIComponent(userId)}.json`;
}

async function ghFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.githubToken()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "memchro",
      ...(init?.headers ?? {}),
      ...(init?.body
        ? { "Content-Type": "application/json" }
        : {}),
    },
    // Always bust the CDN cache — memory data is not cacheable.
    cache: "no-store",
  });
  return res;
}

/**
 * Load the user's file. Returns `{ file: null, sha: null }` if the file does
 * not exist yet.
 */
export async function loadUserFile(params: {
  userId: string;
  email: string;
}): Promise<{ file: UserFile; sha: string | null }> {
  const url = `${apiRoot()}/${userFilePath(params.userId)}?ref=${encodeURIComponent(env.githubDataBranch())}`;
  const res = await ghFetch(url);
  if (res.status === 404) {
    return {
      file: {
        version: 1,
        email: params.email,
        memories: [],
        messages: [],
      },
      sha: null,
    };
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub load failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as {
    sha: string;
    content: string;
    encoding: string;
  };
  const raw = Buffer.from(json.content, "base64").toString("utf8");
  let parsed: UserFile;
  try {
    parsed = JSON.parse(raw) as UserFile;
  } catch {
    parsed = {
      version: 1,
      email: params.email,
      memories: [],
      messages: [],
    };
  }
  // Back-fill defaults for forward compatibility.
  parsed.version = 1;
  parsed.email = parsed.email || params.email;
  parsed.memories = Array.isArray(parsed.memories) ? parsed.memories : [];
  parsed.messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  return { file: parsed, sha: json.sha };
}

/**
 * Persist the user's file via the Contents API. If `sha` is null we create;
 * otherwise we update. We retry once on 409 (concurrent write) by re-reading.
 */
export async function saveUserFile(params: {
  userId: string;
  file: UserFile;
  sha: string | null;
  message?: string;
}): Promise<{ sha: string }> {
  const body = JSON.stringify(params.file, null, 2);
  const content = Buffer.from(body, "utf8").toString("base64");
  const url = `${apiRoot()}/${userFilePath(params.userId)}`;
  async function put(sha: string | null) {
    return ghFetch(url, {
      method: "PUT",
      body: JSON.stringify({
        message:
          params.message ??
          `memchro: update memory for ${params.userId.slice(0, 8)}…`,
        content,
        branch: env.githubDataBranch(),
        ...(sha ? { sha } : {}),
      }),
    });
  }
  let res = await put(params.sha);
  if (res.status === 409 || res.status === 422) {
    // conflict — re-read latest sha and retry once
    const refreshed = await loadUserFile({
      userId: params.userId,
      email: params.file.email,
    });
    // merge conservatively: keep union of memories + latest messages
    const merged: UserFile = {
      version: 1,
      email: params.file.email,
      memories: mergeMemories(refreshed.file.memories, params.file.memories),
      messages: params.file.messages.slice(-MAX_MESSAGES),
    };
    const bodyRetry = JSON.stringify(merged, null, 2);
    const contentRetry = Buffer.from(bodyRetry, "utf8").toString("base64");
    res = await ghFetch(url, {
      method: "PUT",
      body: JSON.stringify({
        message: params.message ?? "memchro: update memory (retry)",
        content: contentRetry,
        branch: env.githubDataBranch(),
        ...(refreshed.sha ? { sha: refreshed.sha } : {}),
      }),
    });
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub save failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { content: { sha: string } };
  return { sha: json.content.sha };
}

function mergeMemories(
  a: StoredMemory[],
  b: StoredMemory[]
): StoredMemory[] {
  const seen = new Set<string>();
  const out: StoredMemory[] = [];
  for (const m of [...a, ...b]) {
    const key = m.content.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

export function trimMessages(messages: StoredMessage[]): StoredMessage[] {
  return messages.slice(-MAX_MESSAGES);
}

export const MEMCHRO_STORAGE_MAX_MESSAGES = MAX_MESSAGES;
