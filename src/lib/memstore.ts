/**
 * In-memory vector store — used as a fallback when Supabase is not configured.
 * All data lives in the Node.js process (dev/single-instance). For production
 * with multiple instances, configure a real Supabase project.
 */

export interface MemChunk {
  id: string;
  documentId: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export interface MemDocument {
  id: string;
  title: string;
  mode: string;
  country?: string;
  source?: string;
  createdAt: string;
}

// Module-level maps survive across requests within one process
const documents = new Map<string, MemDocument>();
const chunks: MemChunk[] = [];

function uuid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function insertDocument(doc: Omit<MemDocument, "id" | "createdAt">): MemDocument {
  const id = uuid();
  const record: MemDocument = { ...doc, id, createdAt: new Date().toISOString() };
  documents.set(id, record);
  return record;
}

export function insertChunks(rows: Omit<MemChunk, "id">[]): void {
  for (const row of rows) {
    chunks.push({ ...row, id: uuid() });
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function searchChunks(
  queryEmbedding: number[],
  documentId: string,
  topK = 5,
  threshold = 0.05   // lower threshold suits local hash-based embeddings
): { content: string; similarity: number; metadata: Record<string, unknown> }[] {
  const candidates = chunks
    .filter((c) => c.documentId === documentId)
    .map((c) => ({
      content: c.content,
      similarity: cosineSimilarity(queryEmbedding, c.embedding),
      metadata: c.metadata,
    }))
    .filter((c) => c.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  return candidates;
}

export function isSupabaseConfigured(): boolean {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_KEY ?? "";
  return (
    url.length > 0 &&
    !url.includes("xxxx") &&
    key.length > 0 &&
    !key.includes("xxxxxxxxxx")
  );
}
