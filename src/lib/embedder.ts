const EMBED_DIM = 512;

// NIM hard limit is 512 tokens. BPE tokenization averages ~3-4 chars/token
// for English legal text. 700 chars ≈ 175-230 tokens — safely under the limit.
const NIM_MAX_CHARS = 700;

// Fast-fail timeout (ms) — don't waste time on slow/erroring API calls
const API_TIMEOUT_MS = 6000;

function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

/** Try NIM → OpenAI → local fallback. Each remote call has a hard timeout. */
export async function embedText(text: string): Promise<number[]> {
  // 1. NVIDIA NIM
  const nimKey = process.env.NVIDIA_API_KEY ?? "";
  const nimBaseUrl = process.env.NVIDIA_BASE_URL ?? "";
  if (
    nimKey &&
    nimKey.length > 10 &&
    !nimKey.includes("xxxx") &&
    nimBaseUrl &&
    !nimBaseUrl.includes("xxxx")
  ) {
    try {
      return await embedWithNIM(text);
    } catch (e) {
      console.warn("NIM embedding failed → trying OpenAI:", (e as Error).message);
    }
  }

  // 2. OpenAI — only if key looks real (not the sk-xxxx placeholder)
  const oaiKey = process.env.OPENAI_API_KEY ?? "";
  const oaiIsPlaceholder =
    !oaiKey ||
    oaiKey === "sk-xxxx" ||
    oaiKey.startsWith("sk-xxxx") ||
    oaiKey.length < 20;

  if (!oaiIsPlaceholder) {
    try {
      return await embedWithOpenAI(text);
    } catch (e) {
      console.warn("OpenAI embedding failed → using local fallback:", (e as Error).message);
    }
  }

  // 3. Local hash-based fallback — always works, no API needed
  return localEmbed(text);
}

// ── NVIDIA NIM ─────────────────────────────────────────────────────────────
async function embedWithNIM(text: string): Promise<number[]> {
  const input = text.length > NIM_MAX_CHARS ? text.slice(0, NIM_MAX_CHARS) : text;
  const res = await fetchWithTimeout(
    `${process.env.NVIDIA_BASE_URL}/embeddings`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      },
      body: JSON.stringify({
        model: "nvidia/nv-embedqa-e5-v5",
        input: [input],
        input_type: "query",
      }),
    },
    API_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`NIM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding as number[];
}

// ── OpenAI ─────────────────────────────────────────────────────────────────
async function embedWithOpenAI(text: string): Promise<number[]> {
  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/embeddings",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
    },
    API_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding as number[];
}

// ── Local hash-based embedding (no API needed) ─────────────────────────────
// Deterministic bag-of-words using djb2 hashing into a fixed-dim vector.
// Similarity is meaningful for documents that share vocabulary (good for
// law/research texts). Not as accurate as neural embeddings but fully offline.
function localEmbed(text: string): number[] {
  const vec = new Float64Array(EMBED_DIM);

  // Normalize and tokenize
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

  for (const token of tokens) {
    // djb2 hash
    let h = 5381;
    for (let i = 0; i < token.length; i++) {
      h = ((h << 5) + h + token.charCodeAt(i)) & 0xffffffff;
    }
    const idx = Math.abs(h) % EMBED_DIM;
    vec[idx] += 1;
    // Also add bigram context: shift by token length for slight positional signal
    const idx2 = (Math.abs(h) + token.length * 31) % EMBED_DIM;
    vec[idx2] += 0.5;
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec).map((v) => v / norm);
}

// ── Batch helper ───────────────────────────────────────────────────────────
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const batchSize = 10;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await Promise.all(batch.map(embedText));
    results.push(...embeddings);
  }
  return results;
}
