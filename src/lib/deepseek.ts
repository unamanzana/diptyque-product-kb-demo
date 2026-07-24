import {
  diptyqueAgentTools,
  executeDiptyqueTool,
  productIdsMentionedInAnswer,
} from "@/lib/diptyque-agent-tools";
import type { ModelUsage } from "@/lib/chat-observability";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";
const REQUEST_TIMEOUT_MS = 60000;
const MAX_TOOL_ROUNDS = 5;

export type ChatHistoryMessage = {
  role: "assistant" | "user";
  content: string;
};

export type DeepSeekChatInput = {
  history: ChatHistoryMessage[];
  message: string;
};

type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type DeepSeekResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      role?: "assistant";
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: ToolCall[];
    };
  }>;
  usage?: {
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    prompt_tokens?: number;
  };
};

function addUsage(total: ModelUsage, usage: DeepSeekResponse["usage"]) {
  total.completionTokens = (total.completionTokens ?? 0) + (usage?.completion_tokens ?? 0);
  total.promptCacheHitTokens = (total.promptCacheHitTokens ?? 0) + (usage?.prompt_cache_hit_tokens ?? 0);
  total.promptCacheMissTokens = (total.promptCacheMissTokens ?? 0) + (usage?.prompt_cache_miss_tokens ?? 0);
  total.promptTokens = (total.promptTokens ?? 0) + (usage?.prompt_tokens ?? 0);
}

function cleanAnswer(value: string) {
  return value
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .trim();
}

function parseFinalResponse(content: string) {
  const jsonStarts = Array.from(content.matchAll(/\{\s*"answer"\s*:/g));
  const lastStart = jsonStarts.at(-1)?.index;
  const lastEnd = content.lastIndexOf("}");
  const cleaned =
    lastStart != null && lastEnd > lastStart
      ? content.slice(lastStart, lastEnd + 1)
      : content.trim();
  try {
    const parsed = JSON.parse(cleaned) as {
      answer?: unknown;
      answer_mode?: unknown;
      product_ids?: unknown;
    };
    return {
      answer: typeof parsed.answer === "string" ? cleanAnswer(parsed.answer) : cleanAnswer(content),
      answerMode: typeof parsed.answer_mode === "string" ? parsed.answer_mode : "agentic_search",
      productIds: Array.isArray(parsed.product_ids)
        ? parsed.product_ids.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return {
      answer: cleanAnswer(content),
      answerMode: "agentic_search",
      productIds: [] as string[],
    };
  }
}

const SYSTEM_PROMPT = [
  "You are the retrieval planner and grounded answer writer for a Diptyque product knowledge graph.",
  "Before answering any product question, call search_products with semantic, ontology and numeric constraints inferred from the current question and conversation history.",
  "Carry forward an active category, product form, collection, scent, material or budget from recent turns unless the user explicitly changes or clears it.",
  "For example, after a user asks about home products, a follow-up asking what to gift an elder must keep the home-product constraint.",
  "Use numeric filters for price questions. For a question about products at or below 500 yuan, call search_products with max_price 500. For the cheapest product, sort price_asc and use a small limit.",
  "Use get_product_details for evidence before recommendations. Use get_product_relations only for approved pairing, layering, refill, accessory or set claims.",
  "Never invent products, prices, URLs or relations. Shared scent, material or category is not an approved direct relation.",
  "For exhaustive questions such as which products, all products or how many products, set search_products limit to 100 so the complete matching set is returned.",
  "When a tool reports total greater than returned, say that the displayed answer is partial unless the user requested only recommendations.",
  "For recommendations, select 3 to 5 products with distinct evidence and ask one high-impact follow-up question when useful.",
  "Never infer gender or rely on gender stereotypes.",
  "Your final response must be a JSON object with exactly these keys: answer, product_ids, answer_mode.",
  "answer is concise Chinese plain text. product_ids contains only exact IDs returned by tools for products actually shown or recommended in the answer, maximum 5. answer_mode is one of product_search, price_search, gift_recommendation, relation_search.",
].join("\n");

export async function generateDiptyqueAnswer(input: DeepSeekChatInput) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
  if (!apiKey) {
    return {
      answer: "",
      answerMode: "agentic_search",
      fallback: true,
      reasoningUsed: false,
      model,
      reason: "missing_api_key",
      matchedProductIds: [] as string[],
      selectedProductIds: [] as string[],
      toolTrace: [] as string[],
    };
  }

  const baseUrl = process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: SYSTEM_PROMPT },
    ...input.history.slice(-8).map((message) => ({
      role: message.role,
      content: message.content.slice(0, 1800),
    })),
    { role: "user", content: input.message },
  ];
  const matchedProductIds: string[] = [];
  const toolTrace: string[] = [];
  const usage: ModelUsage = {};
  let reasoningUsed = false;
  let exactSelection: {
    answer: string;
    answerMode: "price_search";
    productIds: string[];
  } | undefined;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await fetch(baseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          thinking: { type: "enabled" },
          reasoning_effort: "high",
          max_tokens: 2200,
          messages,
          tools: diptyqueAgentTools,
          tool_choice: "auto",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(JSON.stringify({
          event: "deepseek_provider_error",
          status: response.status,
          error: errorText.slice(0, 800),
        }));
        return {
          answer: "",
          answerMode: "agentic_search",
          fallback: true,
          reasoningUsed,
          model,
          reason: "deepseek_http_" + response.status,
          errorText,
          matchedProductIds,
          selectedProductIds: [] as string[],
          toolTrace,
          usage,
        };
      }

      const data = (await response.json()) as DeepSeekResponse;
      addUsage(usage, data.usage);
      const message = data.choices?.[0]?.message;
      reasoningUsed = reasoningUsed || Boolean(message?.reasoning_content?.trim());
      const toolCalls = message?.tool_calls ?? [];

      if (toolCalls.length) {
        messages.push({
          role: "assistant",
          content: message?.content ?? null,
          reasoning_content: message?.reasoning_content ?? null,
          tool_calls: toolCalls,
        });
        for (const toolCall of toolCalls) {
          const execution = executeDiptyqueTool(toolCall.function.name, toolCall.function.arguments);
          matchedProductIds.push(...execution.productIds);
          toolTrace.push(execution.summary);
          exactSelection = execution.exactSelection ?? exactSelection;
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: execution.content,
          });
        }
        continue;
      }

      if (!matchedProductIds.length && round < MAX_TOOL_ROUNDS - 1) {
        messages.push({
          role: "assistant",
          content: message?.content ?? "",
        });
        messages.push({
          role: "user",
          content: "Do not answer from memory. Call search_products with structured filters before producing the final response.",
        });
        continue;
      }

      const final = parseFinalResponse(message?.content ?? "");
      const candidates = Array.from(new Set(matchedProductIds));
      if (exactSelection) {
        return {
          answer: exactSelection.answer,
          answerMode: exactSelection.answerMode,
          fallback: false,
          reasoningUsed,
          model,
          finishReason: data.choices?.[0]?.finish_reason,
          matchedProductIds: candidates,
          selectedProductIds: exactSelection.productIds,
          toolTrace,
          usage,
        };
      }
      const selectedFromModel = final.productIds.filter((id) => candidates.includes(id)).slice(0, 5);
      const selectedProductIds = Array.from(new Set([
        ...selectedFromModel,
        ...productIdsMentionedInAnswer(final.answer, candidates),
      ])).slice(0, 5);

      return {
        answer: final.answer,
        answerMode: final.answerMode,
        fallback: false,
        reasoningUsed,
        model,
        finishReason: data.choices?.[0]?.finish_reason,
        matchedProductIds: candidates,
        selectedProductIds,
        toolTrace,
        usage,
      };
    }

    if (matchedProductIds.length) {
      messages.push({
        role: "user",
        content: "You have enough retrieved evidence. Do not request or describe more tools. Produce the required final JSON now using only the existing tool results.",
      });
      const finalResponse = await fetch(baseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          thinking: { type: "enabled" },
          reasoning_effort: "high",
          max_tokens: 2200,
          messages,
        }),
      });
      if (finalResponse.ok) {
        const finalData = (await finalResponse.json()) as DeepSeekResponse;
        addUsage(usage, finalData.usage);
        const finalMessage = finalData.choices?.[0]?.message;
        reasoningUsed = reasoningUsed || Boolean(finalMessage?.reasoning_content?.trim());
        const final = parseFinalResponse(finalMessage?.content ?? "");
        const candidates = Array.from(new Set(matchedProductIds));
        if (exactSelection) {
          return {
            answer: exactSelection.answer,
            answerMode: exactSelection.answerMode,
            fallback: false,
            reasoningUsed,
            model,
            finishReason: finalData.choices?.[0]?.finish_reason,
            matchedProductIds: candidates,
            selectedProductIds: exactSelection.productIds,
            toolTrace,
            usage,
          };
        }
        const selectedFromModel = final.productIds.filter((id) => candidates.includes(id)).slice(0, 5);
        const selectedProductIds = Array.from(new Set([
          ...selectedFromModel,
          ...productIdsMentionedInAnswer(final.answer, candidates),
        ])).slice(0, 5);
        return {
          answer: final.answer,
          answerMode: final.answerMode,
          fallback: false,
          reasoningUsed,
          model,
          finishReason: finalData.choices?.[0]?.finish_reason,
          matchedProductIds: candidates,
          selectedProductIds,
          toolTrace,
          usage,
        };
      }
    }

    return {
      answer: "",
      answerMode: "agentic_search",
      fallback: true,
      reasoningUsed,
      model,
      reason: "tool_round_limit",
      matchedProductIds: Array.from(new Set(matchedProductIds)),
      selectedProductIds: [] as string[],
      toolTrace,
      usage,
    };
  } catch (error) {
    return {
      answer: "",
      answerMode: "agentic_search",
      fallback: true,
      reasoningUsed,
      model,
      reason: error instanceof Error && error.name === "AbortError" ? "deepseek_timeout" : "deepseek_exception",
      errorText: error instanceof Error ? error.message : "unknown_error",
      matchedProductIds: Array.from(new Set(matchedProductIds)),
      selectedProductIds: [] as string[],
      toolTrace,
      usage,
    };
  } finally {
    clearTimeout(timer);
  }
}
