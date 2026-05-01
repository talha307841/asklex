export interface Chunk {
  text: string;
  index: number;
  metadata: {
    source: string;
    section?: string;
    page?: number;
    charStart: number;
    charEnd: number;
  };
}

export function chunkText(
  text: string,
  source: string,
  options: {
    chunkSize?: number;
    overlap?: number;
  } = {}
): Chunk[] {
  const { chunkSize = 512, overlap = 50 } = options;

  const paragraphs = text.split(/\n\n+/);
  const chunks: Chunk[] = [];
  let currentChunk = "";
  let charPos = 0;
  let chunkIndex = 0;

  for (const para of paragraphs) {
    const words = para.split(" ");

    for (const word of words) {
      const testChunk = currentChunk + " " + word;

      if (testChunk.split(" ").length > chunkSize && currentChunk.length > 0) {
        chunks.push({
          text: currentChunk.trim(),
          index: chunkIndex++,
          metadata: {
            source,
            charStart: charPos - currentChunk.length,
            charEnd: charPos,
          },
        });

        const overlapWords = currentChunk.split(" ").slice(-overlap).join(" ");
        currentChunk = overlapWords + " " + word;
      } else {
        currentChunk = testChunk;
        charPos += word.length + 1;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      text: currentChunk.trim(),
      index: chunkIndex,
      metadata: {
        source,
        charStart: charPos - currentChunk.length,
        charEnd: charPos,
      },
    });
  }

  return chunks;
}

export function detectLegalSections(text: string): string[] {
  const sectionPattern =
    /(?:Section|Article|Clause|Sub-section|Schedule)\s+\d+[A-Z]?/gi;
  return [...new Set(text.match(sectionPattern) || [])];
}

export async function extractPDFText(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = await import("pdf-parse");
    const data = await pdfParse.default(buffer);
    const text = (data.text ?? "").trim();
    if (text) return text;
    throw new Error("PDF contained no extractable text");
  } catch (err) {
    // Fallback for malformed xref PDFs: recover long printable text runs.
    const raw = buffer.toString("latin1");
    const fragments = raw.match(/[ -~]{20,}/g) ?? [];
    const recovered = fragments.join(" ").replace(/\s+/g, " ").trim();

    if (recovered.length >= 200) {
      return recovered;
    }

    const message = err instanceof Error ? err.message : "Unknown PDF parse error";
    throw new Error(
      `Failed to parse PDF. The file may be corrupted, scanned, or encrypted (${message}). Try re-exporting the PDF or uploading a text file.`
    );
  }
}
