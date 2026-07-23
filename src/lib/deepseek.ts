const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";
const REQUEST_TIMEOUT_MS = 15000;

export type DeepSeekChatInput = {
  contextText: string;
  message: string;
};

export async function generateDiptyqueAnswer(input: DeepSeekChatInput) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return {
      answer: "",
      fallback: true,
      model: process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
      reason: "missing_api_key",
    };
  }

  const model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
  const baseUrl = process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "You are a Diptyque product knowledge graph assistant. Answer strictly from the provided context and use concise Chinese by default. Product facts and approved direct product relations are separate evidence layers. Never describe products as paired, compatible, refill-related, or part of a set unless that relation appears under APPROVED DIRECT PRODUCT RELATIONS. Sharing a collection, note, material, or product family is not an approved relation. If the user explicitly asks for existing or approved relations and none are listed, say that no approved relation is currently available. If the user asks for a new recommendation, you may propose a candidate from the retrieved products, but label it clearly as a model suggestion that is not yet an approved graph relation and state the evidence basis. If context is insufficient, say so clearly. Return plain text only and do not use Markdown symbols.",
          },
          {
            role: "user",
            content: `User question:\n${input.message}\n\nAvailable product context:\n${input.contextText}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        answer: "",
        fallback: true,
        model,
        reason: `deepseek_http_${response.status}`,
        errorText,
      };
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    return {
      answer: data.choices?.[0]?.message?.content?.trim() || "",
      fallback: false,
      model,
    };
  } catch (error) {
    return {
      answer: "",
      fallback: true,
      model,
      reason: error instanceof Error && error.name === "AbortError" ? "deepseek_timeout" : "deepseek_exception",
      errorText: error instanceof Error ? error.message : "unknown_error",
    };
  } finally {
    clearTimeout(timer);
  }
}
