import { NextRequest, NextResponse } from "next/server";
import { chunkText, extractPDFText } from "@/lib/chunker";
import { embedBatch } from "@/lib/embedder";
import {
  isSupabaseConfigured,
  insertDocument,
  insertChunks,
} from "@/lib/memstore";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const url = formData.get("url") as string | null;
    const mode = (formData.get("mode") as string) || "general";
    const title = (formData.get("title") as string) || "Untitled";
    const country = formData.get("country") as string | null;

    let text = "";
    let source = "";

    if (file) {
      const buffer = Buffer.from(await file.arrayBuffer());
      if (file.type === "application/pdf") {
        text = await extractPDFText(buffer);
      } else {
        text = buffer.toString("utf-8");
      }
      source = file.name;
    } else if (url) {
      if (url.includes("arxiv.org")) {
        const pdfUrl = url.replace("/abs/", "/pdf/") + ".pdf";
        const pdfRes = await fetch(pdfUrl);
        const buffer = Buffer.from(await pdfRes.arrayBuffer());
        text = await extractPDFText(buffer);
      } else {
        const res = await fetch(url);
        text = await res.text();
        text = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
      }
      source = url;
    }

    if (!text.trim()) {
      return NextResponse.json({ error: "No content extracted" }, { status: 400 });
    }

    const chunks = chunkText(text, source, {
      chunkSize: mode === "law" || mode === "law-pakistan" ? 300 : 512,
      overlap: 50,
    });

    const embeddings = await embedBatch(chunks.map((c) => c.text));

    if (!isSupabaseConfigured()) {
      // ── In-memory path ──────────────────────────────────────────────────────
      const doc = insertDocument({ title, mode, country: country ?? undefined, source });

      insertChunks(
        chunks.map((chunk, i) => ({
          documentId: doc.id,
          content: chunk.text,
          embedding: embeddings[i],
          metadata: chunk.metadata as Record<string, unknown>,
        }))
      );

      return NextResponse.json({
        success: true,
        documentId: doc.id,
        chunksProcessed: chunks.length,
        title,
        storage: "memory",
      });
    }

    // ── Supabase path ────────────────────────────────────────────────────────
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    const { data: doc, error: docError } = await supabase
      .from("documents")
      .insert({ title, mode, country, source })
      .select()
      .single();

    if (docError) throw docError;

    const chunkRows = chunks.map((chunk, i) => ({
      document_id: doc.id,
      content: chunk.text,
      embedding: embeddings[i],
      metadata: chunk.metadata,
    }));

    for (let i = 0; i < chunkRows.length; i += 50) {
      const batch = chunkRows.slice(i, i + 50);
      const { error } = await supabase.from("chunks").insert(batch);
      if (error) throw error;
    }

    return NextResponse.json({
      success: true,
      documentId: doc.id,
      chunksProcessed: chunks.length,
      title,
      storage: "supabase",
    });
  } catch (err: unknown) {
    console.error("Ingest error:", err);
    const message = err instanceof Error ? err.message : "Processing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
