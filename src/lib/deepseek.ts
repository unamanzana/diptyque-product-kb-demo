const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";
const REQUEST_TIMEOUT_MS = 45000;

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
      reasoningUsed: false,
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
        thinking: { type: "enabled" },
        reasoning_effort: "max",
        max_tokens: 4096,
        messages: [
          {
            role: "system",
            content:
              "You are a Diptyque product knowledge graph assistant. Answer strictly from the provided context and use concise Chinese by default. Product facts and approved direct product relations are separate evidence layers. Never describe products as paired, compatible, refill-related, or part of a set unless that relation appears under APPROVED DIRECT PRODUCT RELATIONS. Sharing a collection, note, material, or product family is not an approved relation. If the user explicitly asks for existing or approved relations and none are listed, say that no approved relation is currently available. If the user asks for a new recommendation, you may propose a candidate from the retrieved products, but label it clearly as a model suggestion that is not yet an approved graph relation and state the evidence basis. If context is insufficient, say so clearly. When RETRIEVAL MODE is gift_recommendation, first infer only the needs explicitly present in the question and state important unknowns. Compare the complete candidate pool by scent ingredients, scent profiles, materials, product form, story, price, and gift tags. The visible answer must start with one short sentence beginning with 需求判断：. Then give 3 to 5 numbered options in exactly this format: 1. 完整商品名｜推荐依据：可核验的商品证据｜适合：对应偏好或场景｜注意：需要确认的取舍. Use a distinct evidence basis for every option. Each numbered heading must contain exactly one candidate product using its complete product name exactly as written in the context. Do not mention another complete candidate product name in that option's explanation, even when describing a gift set or comparison. Do not merge eau de toilette, eau de parfum, or other variants into one option. End with exactly one useful question beginning with 继续筛选：. Ask only about the single missing attribute with the highest decision impact, and include exactly one question mark. Choose scent style, budget, product form, or occasion. Never ask for, mention as a required input, or infer gender, and never rely on gender stereotypes. Return plain text only and do not use Markdown symbols.",
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
        reasoningUsed: false,
        model,
        reason: `deepseek_http_${response.status}`,
        errorText,
      };
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          reasoning_content?: string;
        };
      }>;
    };

    return {
      answer: (data.choices?.[0]?.message?.content ?? "")
        .replace(/\*\*/g, "")
        .replace(/^#{1,6}\s*/gm, "")
        .trim(),
      fallback: false,
      reasoningUsed: Boolean(data.choices?.[0]?.message?.reasoning_content?.trim()),
      model,
    };
  } catch (error) {
    return {
      answer: "",
      fallback: true,
      reasoningUsed: false,
      model,
      reason: error instanceof Error && error.name === "AbortError" ? "deepseek_timeout" : "deepseek_exception",
      errorText: error instanceof Error ? error.message : "unknown_error",
    };
  } finally {
    clearTimeout(timer);
  }
}
