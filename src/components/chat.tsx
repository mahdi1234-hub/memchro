"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  memoriesUsed?: string[];
  memoriesAdded?: number;
};

export function Chat({ email }: { email: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showMem, setShowMem] = useState(false);
  const [memories, setMemories] = useState<
    { id: string; content: string; created_at: string }[]
  >([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  async function loadMemories() {
    const r = await fetch("/api/memories");
    if (r.ok) {
      const j = await r.json();
      setMemories(j.memories ?? []);
    }
  }

  useEffect(() => {
    if (showMem) void loadMemories();
  }, [showMem]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    const userMsg: Msg = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      const assistant: Msg = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.reply,
        memoriesUsed: data.memoriesUsed,
        memoriesAdded: data.memoriesAdded,
      };
      setMessages((prev) => [...prev, assistant]);
      if (showMem) void loadMemories();
    } catch (err) {
      const assistant: Msg = {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          err instanceof Error
            ? `⚠ ${err.message}`
            : "⚠ Something went wrong.",
      };
      setMessages((prev) => [...prev, assistant]);
    } finally {
      setSending(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/signin";
  }

  async function forgetAll() {
    if (!confirm("Forget ALL memories for this account? This cannot be undone."))
      return;
    await fetch("/api/memories?id=all", { method: "DELETE" });
    setMemories([]);
  }

  async function forgetOne(id: string) {
    await fetch(`/api/memories?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setMemories((m) => m.filter((x) => x.id !== id));
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="glass sticky top-0 z-10 flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="h-2.5 w-2.5 rounded-full bg-[color:var(--accent)] shadow-[0_0_12px_var(--accent)]" />
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">memchro</div>
            <div className="text-[11px] text-[color:var(--text-muted)]">
              signed in as {email}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowMem((v) => !v)}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
          >
            {showMem ? "Hide memories" : "Memories"}
          </button>
          <button
            onClick={signOut}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-40 pt-6">
        <div
          ref={listRef}
          className="scrollbar-thin flex-1 space-y-4 overflow-y-auto pr-1"
        >
          {messages.length === 0 && (
            <div className="glass mx-auto max-w-xl rounded-2xl p-6 text-center text-sm text-[color:var(--text-muted)]">
              Hi — I&apos;m memchro. Tell me anything about yourself and I&apos;ll
              remember it. Come back tomorrow, next week, or next year — I&apos;ll
              still remember.
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`${
                  m.role === "user"
                    ? "chat-bubble-user"
                    : "chat-bubble-assistant"
                } max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[15px] leading-relaxed text-white/95 shadow-sm`}
              >
                {m.content}
                {m.role === "assistant" &&
                  m.memoriesUsed &&
                  m.memoriesUsed.length > 0 && (
                    <details className="mt-3 text-xs text-[color:var(--text-muted)]">
                      <summary className="cursor-pointer select-none hover:text-white/80">
                        recalled {m.memoriesUsed.length} memories
                        {m.memoriesAdded
                          ? ` · stored ${m.memoriesAdded} new`
                          : ""}
                      </summary>
                      <ul className="mt-2 space-y-1 pl-4">
                        {m.memoriesUsed.map((mem, i) => (
                          <li key={i} className="list-disc">
                            {mem}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="chat-bubble-assistant rounded-2xl px-4 py-3 text-sm text-[color:var(--text-muted)]">
                thinking…
              </div>
            </div>
          )}
        </div>

        {showMem && (
          <div className="glass mt-6 rounded-2xl p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">
                Long-term memory ({memories.length})
              </div>
              {memories.length > 0 && (
                <button
                  onClick={forgetAll}
                  className="text-xs text-red-300 hover:text-red-200"
                >
                  Forget everything
                </button>
              )}
            </div>
            {memories.length === 0 ? (
              <div className="text-sm text-[color:var(--text-muted)]">
                No memories yet — chat a little and I&apos;ll start remembering.
              </div>
            ) : (
              <ul className="scrollbar-thin max-h-72 space-y-2 overflow-y-auto pr-1">
                {memories.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-sm"
                  >
                    <span className="flex-1">{m.content}</span>
                    <button
                      onClick={() => forgetOne(m.id)}
                      className="shrink-0 text-xs text-[color:var(--text-muted)] hover:text-red-300"
                      aria-label="forget"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <form
        onSubmit={onSubmit}
        className="fixed inset-x-0 bottom-0 z-10 mx-auto w-full max-w-3xl p-4"
      >
        <div className="glass input-ring flex items-end gap-2 rounded-2xl border border-white/10 px-3 py-2 shadow-2xl">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onSubmit(e as unknown as FormEvent);
              }
            }}
            rows={1}
            placeholder="Message memchro — it will remember this forever…"
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-relaxed text-white placeholder:text-white/40 focus:outline-none"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
