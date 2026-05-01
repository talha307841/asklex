export async function embedText(text: string): Promise<number[]> {
  try {
    return await embedWithNIM(text);
  } catch {
    return await embedWithOpenAI(text);
  }
}

async function embedWithNIM(text: string): Promise<number[]> {
  const res = await fetch(`${process.env.NVIDIA_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
    },
    body: JSON.stringify({
      model: "nvidia/nv-embedqa-e5-v5",
      input: [text],
      input_type: "query",
    }),
  });

  if (!res.ok) throw new Error("NIM embedding failed");
  const data = await res.json();
  return data.data[0].embedding;
}

async function embedWithOpenAI(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
    }),
  });

  if (!res.ok) throw new Error("OpenAI embedding failed");
  const data = await res.json();
  return data.data[0].embedding;
}

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
