const NIM_MODELS = {
  fast: "meta/llama-3.1-8b-instruct",
  smart: "meta/llama-3.1-70b-instruct",
  best: "nvidia/llama-3.1-nemotron-70b-instruct-hf",
};

interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LLMResponse {
  text: string;
  model: string;
  provider: string;
}

async function callNIM(
  messages: LLMMessage[],
  model: string = NIM_MODELS.smart
): Promise<string> {
  const res = await fetch(`${process.env.NVIDIA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: 1024,
      stream: false,
    }),
  });

  if (!res.ok) throw new Error(`NIM error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callGroq(messages: LLMMessage[]): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.1-70b-versatile",
      messages,
      temperature: 0.2,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) throw new Error(`Groq error: ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callGemini(messages: LLMMessage[]): Promise<string> {
  const systemMsg = messages.find((m) => m.role === "system")?.content || "";
  const userMessages = messages.filter((m) => m.role !== "system");

  const geminiMessages = userMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemMsg }] },
        contents: geminiMessages,
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
      }),
    }
  );

  if (!res.ok) throw new Error(`Gemini error: ${res.status}`);
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

export async function callLLM(
  messages: LLMMessage[],
  options: { preferFast?: boolean; mode?: string } = {}
): Promise<LLMResponse> {
  const model = options.preferFast ? NIM_MODELS.fast : NIM_MODELS.smart;

  try {
    const text = await callNIM(messages, model);
    return { text, model, provider: "nvidia-nim" };
  } catch (e) {
    console.warn("NIM failed, trying Groq:", e);
  }

  try {
    const text = await callGroq(messages);
    return { text, model: "llama-3.1-70b-versatile", provider: "groq" };
  } catch (e) {
    console.warn("Groq failed, trying Gemini:", e);
  }

  try {
    const text = await callGemini(messages);
    return { text, model: "gemini-1.5-flash", provider: "gemini" };
  } catch {
    throw new Error("All LLM providers failed. Please try again.");
  }
}

export async function* streamNIM(
  messages: LLMMessage[],
  model: string = NIM_MODELS.smart
): AsyncGenerator<string> {
  const res = await fetch(`${process.env.NVIDIA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: 1024,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) throw new Error(`NIM stream error: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

    for (const line of lines) {
      const data = line.slice(6);
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) yield token;
      } catch {}
    }
  }
}
