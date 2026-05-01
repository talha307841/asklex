"use client";

import { useState, useRef, useEffect } from "react";

type Mode = "law-pakistan" | "law" | "research" | "persona" | "general";
type Step = "ingest" | "chat";

interface Message {
  role: "user" | "assistant";
  content: string;
  provider?: string;
  model?: string;
}

async function parseApiResponse(res: Response): Promise<Record<string, unknown>> {
  const contentType = res.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  const text = await res.text();
  return { error: text || `Request failed with status ${res.status}` };
}

const MODE_LABELS: Record<Mode, string> = {
  "law-pakistan": "🇵🇰 Pakistan Law",
  law: "⚖️ General Law",
  research: "🔬 Research Paper",
  persona: "🎭 Persona",
  general: "📄 General Document",
};

export default function AskLexApp() {
  // ── ingest state ──────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("ingest");
  const [mode, setMode] = useState<Mode>("general");
  const [country, setCountry] = useState("Pakistan");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [ingestError, setIngestError] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [chunksProcessed, setChunksProcessed] = useState(0);
  const [storage, setStorage] = useState("");

  // ── chat state ────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── ingest handler ────────────────────────────────────────────────────────
  async function handleIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!file && !url.trim()) {
      setIngestError("Please choose a file or enter a URL.");
      return;
    }

    // Vercel serverless endpoints can reject larger multipart payloads.
    if (file && file.size > 4 * 1024 * 1024) {
      setIngestError(
        "File is too large for deployment upload limits. Use a file under 4MB or ingest by URL."
      );
      return;
    }

    setIngestError("");
    setIngesting(true);

    try {
      const fd = new FormData();
      if (file) fd.append("file", file);
      if (url.trim()) fd.append("url", url.trim());
      fd.append("mode", mode);
      fd.append("title", title || (file?.name ?? url));
      if (country) fd.append("country", country);

      const res = await fetch("/api/ingest", { method: "POST", body: fd });
      const data = await parseApiResponse(res);

      if (!res.ok) {
        const message =
          typeof data.error === "string"
            ? data.error
            : "Ingest failed. Please try a smaller file or URL.";
        throw new Error(message);
      }

      setDocumentId(String(data.documentId ?? ""));
      setChunksProcessed(Number(data.chunksProcessed ?? 0));
      setStorage(typeof data.storage === "string" ? data.storage : "");
      setStep("chat");
      setMessages([
        {
          role: "assistant",
          content: `✅ Document ingested: **${String(data.title ?? "Untitled")}** (${Number(
            data.chunksProcessed ?? 0
          )} chunks). Ask me anything about it.`,
        },
      ]);
    } catch (err: unknown) {
      setIngestError(err instanceof Error ? err.message : "Ingest failed");
    } finally {
      setIngesting(false);
    }
  }

  // ── chat handler ──────────────────────────────────────────────────────────
  async function handleChat(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setChatError("");

    const userMsg: Message = { role: "user", content: question };
    setMessages((prev) => [...prev, userMsg]);
    setQuestion("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: userMsg.content,
          documentId,
          mode,
          country,
          stream: true,
        }),
      });

      if (!res.ok) {
        const data = await parseApiResponse(res);
        const message = typeof data.error === "string" ? data.error : "Chat failed";
        throw new Error(message);
      }

      const contentType = res.headers.get("content-type") ?? "";

      if (contentType.includes("text/event-stream") && res.body) {
        // ── SSE streaming ────────────────────────────────────────────────────
        const assistantMsg: Message = { role: "assistant", content: "" };
        setMessages((prev) => [...prev, assistantMsg]);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const raw = decoder.decode(value);
          const lines = raw.split("\n").filter((l) => l.startsWith("data: "));

          for (const line of lines) {
            const payload = line.slice(6);
            if (payload === "[DONE]") break;
            try {
              const parsed = JSON.parse(payload);
              if (parsed.token) {
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    content: updated[updated.length - 1].content + parsed.token,
                  };
                  return updated;
                });
              }
            } catch {}
          }
        }
      } else {
        // ── JSON response ────────────────────────────────────────────────────
        const data = await parseApiResponse(res);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              typeof data.answer === "string"
                ? data.answer
                : "No answer returned from server.",
            provider: typeof data.provider === "string" ? data.provider : undefined,
            model: typeof data.model === "string" ? data.model : undefined,
          },
        ]);
      }
    } catch (err: unknown) {
      setChatError(err instanceof Error ? err.message : "Chat failed");
    } finally {
      setChatLoading(false);
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-black">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-black/10 bg-white px-6 py-4 dark:border-white/10 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
            AskLex
          </span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            beta
          </span>
        </div>
        {step === "chat" && (
          <button
            onClick={() => {
              setStep("ingest");
              setDocumentId("");
              setMessages([]);
              setFile(null);
              setUrl("");
              setTitle("");
            }}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            ← New document
          </button>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        {step === "ingest" ? (
          /* ── Step 1: Ingest ─────────────────────────────────────────────── */
          <form
            onSubmit={handleIngest}
            className="flex flex-col gap-5 rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-900"
          >
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">
              Upload a document
            </h2>

            {/* Mode */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Mode
              </label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as Mode)}
                className="rounded-lg border border-black/10 bg-zinc-50 px-3 py-2 text-sm dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>

            {/* Country (only for law modes) */}
            {(mode === "law" || mode === "law-pakistan") && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Country
                </label>
                <input
                  type="text"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="e.g. Pakistan"
                  className="rounded-lg border border-black/10 bg-zinc-50 px-3 py-2 text-sm dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
            )}

            {/* Title */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Document title{" "}
                <span className="text-zinc-400 dark:text-zinc-500">(optional)</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Pakistan Penal Code 1860"
                className="rounded-lg border border-black/10 bg-zinc-50 px-3 py-2 text-sm dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>

            {/* File upload */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Upload PDF or text file
              </label>
              <input
                type="file"
                accept=".pdf,.txt,.md"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setUrl("");
                }}
                className="rounded-lg border border-dashed border-black/20 bg-zinc-50 px-3 py-3 text-sm text-zinc-600 dark:border-white/20 dark:bg-zinc-800 dark:text-zinc-400"
              />
            </div>

            {/* OR URL */}
            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-black/10 dark:border-white/10" />
              <span className="text-xs text-zinc-400">or</span>
              <div className="flex-1 border-t border-black/10 dark:border-white/10" />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                URL{" "}
                <span className="text-zinc-400 dark:text-zinc-500">
                  (arXiv, webpage)
                </span>
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setFile(null);
                }}
                placeholder="https://arxiv.org/abs/2310.xxxxx"
                className="rounded-lg border border-black/10 bg-zinc-50 px-3 py-2 text-sm dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>

            {ingestError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
                {ingestError}
              </p>
            )}

            <button
              type="submit"
              disabled={ingesting}
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-zinc-900 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {ingesting ? (
                <>
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                  Ingesting…
                </>
              ) : (
                "Ingest document"
              )}
            </button>
          </form>
        ) : (
          /* ── Step 2: Chat ───────────────────────────────────────────────── */
          <div className="flex flex-1 flex-col gap-4">
            {/* Info bar */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-xs text-zinc-500 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400">
              <span className="font-medium text-zinc-700 dark:text-zinc-200">
                {MODE_LABELS[mode]}
              </span>
              <span>·</span>
              <span>{chunksProcessed} chunks</span>
              {storage && (
                <>
                  <span>·</span>
                  <span>storage: {storage}</span>
                </>
              )}
              <span>·</span>
              <span className="font-mono text-xs">{documentId.slice(0, 12)}…</span>
            </div>

            {/* Messages */}
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-900" style={{ minHeight: "420px", maxHeight: "60vh" }}>
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                >
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                      msg.role === "user"
                        ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                    }`}
                  >
                    {msg.role === "user" ? "You" : "AI"}
                  </div>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                    }`}
                  >
                    {msg.content}
                    {msg.provider && (
                      <p className="mt-1.5 text-xs opacity-50">
                        via {msg.provider} · {msg.model}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    AI
                  </div>
                  <div className="rounded-2xl bg-zinc-100 px-4 py-2.5 text-sm dark:bg-zinc-800">
                    <span className="animate-pulse">Thinking…</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {chatError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
                {chatError}
              </p>
            )}

            {/* Input */}
            <form onSubmit={handleChat} className="flex gap-2">
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question about the document…"
                disabled={chatLoading}
                className="flex-1 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-100"
              />
              <button
                type="submit"
                disabled={chatLoading || !question.trim()}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
