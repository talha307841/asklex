import { embedText } from "./embedder";
import { isSupabaseConfigured, searchChunks } from "./memstore";

export interface RetrievedChunk {
  text: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

type MatchChunkRow = {
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
};

export async function retrieveRelevantChunks(
  query: string,
  documentId: string,
  topK: number = 5
): Promise<RetrievedChunk[]> {
  const queryEmbedding = await embedText(query);

  if (!isSupabaseConfigured()) {
    const rows = searchChunks(queryEmbedding, documentId, topK);
    return rows.map((r) => ({
      text: r.content,
      similarity: r.similarity,
      metadata: r.metadata,
    }));
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: queryEmbedding,
    document_id: documentId,
    match_count: topK,
    similarity_threshold: 0.5,
  });

  if (error) throw new Error(`Retrieval error: ${error.message}`);

  const rows = (data || []) as MatchChunkRow[];
  return rows.map((row) => ({
    text: row.content,
    similarity: row.similarity,
    metadata: row.metadata,
  }));
}

export function buildContext(chunks: RetrievedChunk[]): string {
  // Cap total context at ~6000 chars (~1500 tokens) to stay within all LLM limits
  const MAX_CONTEXT_CHARS = 6000;
  const sorted = [...chunks].sort((a, b) => b.similarity - a.similarity);

  let context = "";
  let idx = 1;
  for (const c of sorted) {
    const passage = `[Passage ${idx}]\n${c.text}\n\n---\n\n`;
    if (context.length + passage.length > MAX_CONTEXT_CHARS) break;
    context += passage;
    idx++;
  }
  return context.trim();
}

/*
-- Enable pgvector
create extension if not exists vector;

-- Documents table
create table documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  mode text not null,  -- 'law' | 'research' | 'persona' | 'general'
  country text,
  user_session text,
  created_at timestamptz default now()
);

-- Chunks table
create table chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  content text not null,
  embedding vector(1536),
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- Vector search function
create or replace function match_chunks(
  query_embedding vector(1536),
  document_id uuid,
  match_count int,
  similarity_threshold float
)
returns table (
  id uuid,
  content text,
  similarity float,
  metadata jsonb
)
language sql stable
as $$
  select
    id,
    content,
    1 - (embedding <=> query_embedding) as similarity,
    metadata
  from chunks
  where document_id = match_chunks.document_id
    and 1 - (embedding <=> query_embedding) > similarity_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- Index for fast search
create index on chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
*/
