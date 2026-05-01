import { NextRequest, NextResponse } from "next/server";
import { retrieveRelevantChunks, buildContext } from "@/lib/retriever";
import {
  buildLawPrompt,
  buildPakistanLawPrompt,
  buildResearchPrompt,
  buildPersonaPrompt,
  buildGeneralRAGPrompt,
} from "@/lib/prompts";
import { callLLM, streamNIM } from "@/lib/llm";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      question,
      documentId,
      mode,
      country,
      personaName,
      personaBio,
      stream: useStream = false,
    } = body;

    const chunks = await retrieveRelevantChunks(question, documentId, 6);
    const context = buildContext(chunks);

    let systemPrompt = "";
    let userMessage = "";

    switch (mode) {
      case "law-pakistan": {
        const p = buildPakistanLawPrompt({ context, question });
        systemPrompt = p.system;
        userMessage = p.user;
        break;
      }
      case "law": {
        const p = buildLawPrompt({
          country: country || "the relevant jurisdiction",
          context,
          question,
        });
        systemPrompt = p.system;
        userMessage = p.user;
        break;
      }
      case "research": {
        const p = buildResearchPrompt({
          paperTitle: "Research Paper",
          context,
          question,
        });
        systemPrompt = p.system;
        userMessage = p.user;
        break;
      }
      case "persona": {
        const p = buildPersonaPrompt({
          personaName: personaName || "the historical figure",
          personaBio: personaBio || "",
          writingStyle: "formal, thoughtful, intellectual",
          context,
          question,
        });
        systemPrompt = p.system;
        userMessage = p.user;
        break;
      }
      default: {
        const p = buildGeneralRAGPrompt({ documentTitle: "Document", context, question });
        systemPrompt = p.system;
        userMessage = p.user;
      }
    }

    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userMessage },
    ];

    if (useStream) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const token of streamNIM(messages)) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
              );
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } catch {
            const { text } = await callLLM(messages);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ token: text })}\n\n`)
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          }
          controller.close();
        },
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const { text, provider, model } = await callLLM(messages);

    return NextResponse.json({
      answer: text,
      sourcesUsed: chunks.length,
      provider,
      model,
    });
  } catch (err: unknown) {
    console.error("Chat error:", err);
    const message = err instanceof Error ? err.message : "Chat failed";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
