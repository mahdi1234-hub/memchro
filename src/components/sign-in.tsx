"use client";

import { useState } from "react";

export function SignIn({ error }: { error?: string | null }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setErrMsg(null);
    try {
      const res = await fetch("/api/auth/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to send link");
      }
      setState("sent");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    }
  }

  const friendlyError =
    error === "invalid_or_expired"
      ? "That sign-in link expired or was already used. Request a new one."
      : error === "missing_token"
        ? "Missing sign-in token. Please request a new link."
        : error === "server"
          ? "Server error signing you in. Try again."
          : null;

  return (
    <main className="flex-1 grid place-items-center p-6">
      <div className="glass w-full max-w-md rounded-2xl p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">memchro</h1>
          <p className="mt-2 text-sm text-[color:var(--text-muted)]">
            An AI agent with 24/7 memory. It never forgets what you tell it.
          </p>
        </div>

        {friendlyError && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {friendlyError}
          </div>
        )}

        {state === "sent" ? (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            Check <span className="font-semibold">{email}</span> — we sent a
            sign-in link. It expires in 15 minutes.
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <label className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">
              Email
            </label>
            <input
              type="email"
              required
              placeholder="you@example.com"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-ring w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-base outline-none placeholder:text-white/30"
            />
            <button
              type="submit"
              disabled={state === "sending"}
              className="mt-2 rounded-lg bg-[color:var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {state === "sending" ? "Sending…" : "Email me a sign-in link"}
            </button>
            {errMsg && (
              <p className="text-sm text-red-300">{errMsg}</p>
            )}
          </form>
        )}

        <p className="mt-6 text-center text-xs text-[color:var(--text-muted)]">
          Multi-tenant by email. Your conversations and memories are private to you.
        </p>
      </div>
    </main>
  );
}
