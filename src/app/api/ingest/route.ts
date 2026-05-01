import { NextRequest, NextResponse } from "next/server";
import { chunkText, extractPDFText } from "@/lib/chunker";
import { embedBatch } from "@/lib/embedder";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: "Supabase environment variables are missing." },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const url = formData.get("url") as string | null;
    const mode = formData.get("mode") as string;
    const title = formData.get("title") as string;
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
      const res = await fetch(url);

      if (url.includes("arxiv.org")) {
        const pdfUrl = url.replace("/abs/", "/pdf/") + ".pdf";
        const pdfRes = await fetch(pdfUrl);
        const buffer = Buffer.from(await pdfRes.arrayBuffer());
        text = await extractPDFText(buffer);
      } else {
        text = await res.text();
        text = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
      }
      source = url;
    }

    if (!text) {
      return NextResponse.json({ error: "No content extracted" }, { status: 400 });
    }

    const { data: doc, error: docError } = await supabase
      .from("documents")
      .insert({ title, mode, country, source })
      .select()
      .single();

    if (docError) throw docError;

    const chunks = chunkText(text, source, {
      chunkSize: mode === "law" ? 300 : 512,
      overlap: 50,
    });

    const embeddings = await embedBatch(chunks.map((c) => c.text));

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
    });
  } catch (err: unknown) {
    console.error("Ingest error:", err);
    const message = err instanceof Error ? err.message : "Processing failed";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
