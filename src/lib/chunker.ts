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
  const pdfParse = await import("pdf-parse");
  const data = await pdfParse.default(buffer);
  return data.text;
}
