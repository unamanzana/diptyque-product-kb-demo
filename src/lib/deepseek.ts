import {
  buildGiftFallbackRecommendation,
  diptyqueAgentTools,
  executeDiptyqueQueryPlan,
  executeDiptyqueTool,
  filterRecommendedProductIds,
  type ToolExecution,
} from "@/lib/diptyque-agent-tools";
import type { ModelUsage } from "@/lib/chat-observability";
import {
  extractGiftBudgetCeiling,
  isGiftRecommendationQuery,
} from "@/lib/diptyque-query-intent";
import type { DiptyqueQueryPlan } from "@/lib/diptyque-query-plan";
import {
  formatOfficialCopyContext,
  officialCopyFallback,
  retrieveOfficialCopy,
  verifyAnswerClaims,
} from "@/lib/diptyque-official-copy-rag";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";
const REQUEST_TIMEOUT_MS = 60000;
const MAX_TOOL_ROUNDS = 5;
const MAX_PROVIDER_ATTEMPTS = 3;
const RETRYABLE_PROVIDER_STATUSES = new Set([429, 500, 502, 503, 504]);

export type ChatHistoryMessage = {
  role: "assistant" | "user";
  content: string;
};

export type DeepSeekChatInput = {
  history: ChatHistoryMessage[];
  message: string;
  queryPlan: DiptyqueQueryPlan;
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

async function waitForRetry(delayMs: number) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function fetchDeepSeekWithRetry(
  url: string,
  init: RequestInit,
  toolTrace: string[]
) {
  let lastErrorText = "";
  for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return { response, errorText: "", attempts: attempt };
      lastErrorText = await response.text();
      const shouldRetry =
        RETRYABLE_PROVIDER_STATUSES.has(response.status) && attempt < MAX_PROVIDER_ATTEMPTS;
      if (!shouldRetry) return { response, errorText: lastErrorText, attempts: attempt };
      toolTrace.push("provider_retry status=" + response.status + " attempt=" + attempt);
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      if (isAbort || attempt >= MAX_PROVIDER_ATTEMPTS) throw error;
      toolTrace.push("provider_retry status=network_error attempt=" + attempt);
    }
    await waitForRetry(400 * (2 ** (attempt - 1)));
  }
  throw new Error(lastErrorText || "deepseek_retry_exhausted");
}

function addUsage(total: ModelUsage, usage: DeepSeekResponse["usage"]) {
  total.completionTokens = (total.completionTokens ?? 0) + (usage?.completion_tokens ?? 0);
  total.promptCacheHitTokens = (total.promptCacheHitTokens ?? 0) + (usage?.prompt_cache_hit_tokens ?? 0);
  total.promptCacheMissTokens = (total.promptCacheMissTokens ?? 0) + (usage?.prompt_cache_miss_tokens ?? 0);
  total.promptTokens = (total.promptTokens ?? 0) + (usage?.prompt_tokens ?? 0);
}

const INTERNAL_PROTOCOL_PATTERN = /(?:<[^>]*(?:DSML|tool_calls|invoke\s+name=)[^>]*>|\btool_calls\b|<\|(?:assistant|tool)[^|]*\|>)/i;

export function containsInternalProtocol(value: string) {
  return INTERNAL_PROTOCOL_PATTERN.test(value);
}

export function cleanAnswer(value: string) {
  if (containsInternalProtocol(value)) throw new Error("deepseek_internal_protocol_leak");

  const answerOnly = value.replace(/```(?:json)?[\s\S]*?```/gi, "");
  const rawLines = answerOnly.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];
  for (let index = 0; index < rawLines.length; index += 1) {
    const rawLine = rawLines[index].trim();
    if (!rawLine || /^[-*_]{3,}$/.test(rawLine)) {
      if (lines.at(-1) !== "") lines.push("");
      continue;
    }
    if (/^\|?\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+\s*\|?$/.test(rawLine)) continue;

    const tableCells = rawLine.startsWith("|") && rawLine.endsWith("|")
      ? rawLine.slice(1, -1).split("|").map((cell) => cell.trim()).filter(Boolean)
      : [];
    const nextLine = rawLines[index + 1]?.trim() ?? "";
    if (tableCells.length && /^\|?\s*:?-{3,}/.test(nextLine)) continue;

    const normalizedLine = tableCells.length
      ? "- " + tableCells.join("; ")
      : rawLine
          .replace(/^#{1,6}\s*/, "")
          .replace(/\*\*/g, "")
          .replace(/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF]\uFE0F?\s*/u, "")
          .replace(/^(\d+)[\uFE0F\u20E3]+\s*/, "$1. ")
          .replace(/[\u2705\u274C\u26A0\uFE0F\u{1F60A}]/gu, "")
          .trim();
    if (normalizedLine) lines.push(normalizedLine);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
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
  "You are the semantic interpreter, retrieval planner and grounded answer writer for a Diptyque product knowledge graph.",
  "Your first action for every non-safety user request must be resolve_query_semantics. Parse the full utterance and recent conversation before calling any retrieval tool.",
  "In a relation question, distinguish grammatical roles: subject is the entity whose relations are requested, predicate is the requested relation, and object is the target type or entity. In a question meaning which candles fit a candle lid, candle lid is the subject, accessory_for is the predicate, and candle is the object.",
  "Do not copy every noun into product filters. Search only the validated subject as the relation source; use the object to select the target type or interpret relation results.",
  "After resolve_query_semantics returns ontologyValidation, use only ontology-supported entity values and relation types. If validation is ambiguous, call list_catalog_values or search_products rather than inventing a mapping.",
  "For relation intent, search the subject first, then call get_product_relations with the validated relationTypes. Series membership is not a direct pairing: search by the shared collection or scent identity instead.",
  "For catalog, comparison, gifting and recommendation intent, use the validated semantic frame to choose search_products or search_gift_candidates. Use get_product_details before explaining subjective recommendations.",
  "Only explicit numeric price, size, stock, inclusion or exclusion statements are hard constraints. Descriptive preferences such as fresh, restrained, floral or not too sweet are soft ranking signals and may not create an automatic zero-result answer.",
  "Carry forward relevant meaning from recent conversation unless the user explicitly changes it. When the user asks for alternatives, exclude product IDs already presented.",
  "For price questions, use numeric filters. For products at or below 500 yuan, call search_products with max_price 500. For the cheapest product, sort price_asc and use a small limit.",
  "For vague gifting questions, call search_gift_candidates and present useful candidates before asking one high-impact follow-up question.",
  "Ontology tools validate entities, categories and approved relations. Tool results are facts; never invent a product, price, URL, relation or compatibility.",
  "OFFICIAL_COPY_EVIDENCE is added only after product retrieval. Use its exact official excerpts to explain fuzzy sensory language. Retrieval expansion terms are not evidence.",
  "Relationship evidence has two levels: direct reviewed relations, and specificationCompatibility derived from an accessory's official compatible specification joined to products with that recorded specification.",
  "For specificationCompatibility, say only that products can fit by specification and state that this is not an official item-by-item pairing or recommendation.",
  "Shared scent, material or category alone is not an approved direct product relation.",
  "For exhaustive catalog questions, set search_products limit to 100. If total is greater than returned, clearly say the answer is partial.",
  "For recommendations, select 3 to 5 products with distinct evidence unless the user asks for another count.",
  "Never infer longevity, projection, season, gender, therapeutic effects, safety, popularity or risk-free gifting without explicit evidence.",
  "The answer field must not contain Markdown tables, Markdown headings, horizontal rules, emoji or tool-call markup.",
  "For multiple recommendations, use a consistent numbered plain-text list. Products mentioned only as excluded or unsuitable must not appear in product_ids.",
  "Your final response must be a JSON object with exactly these keys: answer, product_ids, answer_mode.",
  "answer is concise Chinese plain text. product_ids contains only exact IDs returned by retrieval tools for products actually shown, maximum 5. answer_mode is one of product_search, price_search, gift_recommendation, relation_search.",
].join("\n");

function conceptualGiftComparison(query: string) {
  if (!/香水/.test(query) || !/蜡烛/.test(query) || !/护手霜/.test(query)) return "";
  return [
    "这三类都可以送人，但风险不同：",
    "香水最有完整的香气体验，但气味偏好最主观；不清楚对方喜好时，选错香调的风险也最高。",
    "蜡烛适合家居氛围，礼物属性明确；需要考虑对方是否使用家居香氛，以及是否愿意按说明养护蜡烛。",
    "护手霜日常使用门槛较低，但仍要考虑香味偏好与个人肌肤状况，现有资料不能替代成分或过敏判断。",
    "如果不了解对方的香气偏好，可先在蜡烛和护手霜中按预算选择；如果知道其喜欢的系列，再选同系列香水更有针对性。",
  ].join("\n");
}

export async function generateDiptyqueAnswer(input: DeepSeekChatInput) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
  const fallbackRetrieval = executeDiptyqueQueryPlan(input.queryPlan);
  const gateFallbackCopyToStructuredCandidates = input.queryPlan.intent === "gifting"
    || input.queryPlan.conversationState.hardConstraintKeys.length > 0;
  const fallbackOfficialCopyHits = retrieveOfficialCopy(
    input.queryPlan.conversationState.contextualQuery,
    input.queryPlan,
    gateFallbackCopyToStructuredCandidates ? fallbackRetrieval.productIds : [],
    10,
    gateFallbackCopyToStructuredCandidates,
    input.queryPlan.conversationState.previouslyPresentedProductIds
  );
  const copyFallback = officialCopyFallback(fallbackOfficialCopyHits, input.queryPlan);
  let officialCopyHits = [] as ReturnType<typeof retrieveOfficialCopy>;
  const fallbackMatchedProductIds = Array.from(new Set([
    ...fallbackRetrieval.productIds,
    ...fallbackOfficialCopyHits.map((hit) => hit.productId),
  ]));
  const conceptualGiftAnswer = conceptualGiftComparison(input.message);
  const giftFallback = input.queryPlan.intent === "gifting" || isGiftRecommendationQuery(input.message)
    ? buildGiftFallbackRecommendation({
        coreFamilies: input.queryPlan.constraints.coreFamilies,
        excludedCollections: input.queryPlan.constraints.excludedCollections,
        excludedProductForms: input.queryPlan.constraints.excludedProductForms,
        maxPrice: input.queryPlan.constraints.maxPrice ?? extractGiftBudgetCeiling(input.message),
      })
    : undefined;
  if (!apiKey) {
    return {
      answer: conceptualGiftAnswer || copyFallback?.answer || giftFallback?.answer || fallbackRetrieval.fallbackAnswer,
      answerMode: giftFallback?.answerMode ?? fallbackRetrieval.answerMode,
      fallback: true,
      reasoningUsed: false,
      model,
      reason: "missing_api_key",
      matchedProductIds: giftFallback?.matchedProductIds ?? fallbackMatchedProductIds,
      selectedProductIds: copyFallback?.productIds ?? giftFallback?.selectedProductIds ?? fallbackRetrieval.selectedProductIds,
      toolTrace: [...fallbackRetrieval.toolTrace, "official_copy_retrieval hits=" + fallbackOfficialCopyHits.length],
      evidenceTrace: officialCopyHits.length ? officialCopyHits : fallbackOfficialCopyHits,
    };
  }

  const baseUrl = process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content: "CONVERSATION_MEMORY\n" + JSON.stringify({
        previouslyPresentedProductIds: input.queryPlan.conversationState.previouslyPresentedProductIds,
      }),
    },
    ...input.history.slice(-8).map((message) => ({
      role: message.role,
      content: message.content.slice(0, 1800),
    })),
    { role: "user", content: input.message },
  ];
  const matchedProductIds: string[] = [];
  const toolTrace: string[] = [];
  const groundingContext: string[] = [];
  const usage: ModelUsage = {};
  let reasoningUsed = false;
  let semanticFrameResolved = false;
  let exactSelection: ToolExecution["exactSelection"];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const providerResult = await fetchDeepSeekWithRetry(
        baseUrl + "/chat/completions",
        {
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
            tool_choice: round === 0
              ? { type: "function", function: { name: "resolve_query_semantics" } }
              : "auto",
          }),
        },
        toolTrace
      );
      const response = providerResult.response;

      if (!response.ok) {
        const errorText = providerResult.errorText;
        console.error(JSON.stringify({
          event: "deepseek_provider_error",
          status: response.status,
          error: errorText.slice(0, 800),
        }));
        return {
          answer: conceptualGiftAnswer || copyFallback?.answer || giftFallback?.answer || fallbackRetrieval.fallbackAnswer,
          answerMode: giftFallback?.answerMode ?? fallbackRetrieval.answerMode,
          fallback: true,
          reasoningUsed,
          model,
          reason: "deepseek_http_" + response.status,
          errorText,
          matchedProductIds: giftFallback?.matchedProductIds ?? (matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds),
          selectedProductIds: copyFallback?.productIds ?? giftFallback?.selectedProductIds ?? fallbackRetrieval.selectedProductIds,
          toolTrace,
          usage,
          evidenceTrace: officialCopyHits.length ? officialCopyHits : fallbackOfficialCopyHits,
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
          groundingContext.push(toolCall.function.name + "\n" + execution.content);
          exactSelection = execution.exactSelection ?? exactSelection;
          if (toolCall.function.name === "resolve_query_semantics") semanticFrameResolved = true;
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: execution.content,
          });
          if (toolCall.function.name === "search_products" || toolCall.function.name === "search_gift_candidates") {
            const retrievedCopy = retrieveOfficialCopy(
              input.queryPlan.conversationState.contextualQuery,
              input.queryPlan,
              execution.productIds,
              10,
              true,
              input.queryPlan.conversationState.previouslyPresentedProductIds
            );
            const copyByChunk = new Map([...officialCopyHits, ...retrievedCopy].map((hit) => [hit.chunkId, hit]));
            officialCopyHits = Array.from(copyByChunk.values()).slice(0, 20);
            if (retrievedCopy.length) {
              const context = formatOfficialCopyContext(retrievedCopy);
              groundingContext.push("OFFICIAL_COPY_EVIDENCE\n" + context);
              messages.push({ role: "system", content: "OFFICIAL_COPY_EVIDENCE\n" + context });
              toolTrace.push("official_copy_retrieval hits=" + retrievedCopy.length);
            }
          }
        }
        continue;
      }

      if (!semanticFrameResolved && round < MAX_TOOL_ROUNDS - 1) {
        messages.push({ role: "assistant", content: message?.content ?? "" });
        messages.push({
          role: "user",
          content: "Call resolve_query_semantics now. Do not retrieve products or answer before the semantic frame is validated.",
        });
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
          evidenceTrace: officialCopyHits.length ? officialCopyHits : fallbackOfficialCopyHits,
        };
      }
      const selectedFromModel = final.productIds.filter((id) => candidates.includes(id)).slice(0, 5);
      const selectedProductIds = filterRecommendedProductIds(
        final.answer,
        candidates,
        selectedFromModel
      );
      const verification = verifyAnswerClaims(
        final.answer,
        [...groundingContext, formatOfficialCopyContext(officialCopyHits)].join("\n")
      );
      if (!verification.passed) {
        toolTrace.push(`claim_verifier blocked=${verification.unsupported.join(",")}`);
        return {
          answer: conceptualGiftAnswer || copyFallback?.answer || giftFallback?.answer || fallbackRetrieval.fallbackAnswer,
          answerMode: giftFallback ? "gift_recommendation" : fallbackRetrieval.answerMode,
          fallback: true,
          reasoningUsed,
          model,
          reason: "unsupported_model_claim",
          matchedProductIds: candidates,
          selectedProductIds: copyFallback?.productIds ?? giftFallback?.selectedProductIds ?? fallbackRetrieval.selectedProductIds,
          toolTrace,
          usage,
          evidenceTrace: officialCopyHits.length ? officialCopyHits : fallbackOfficialCopyHits,
        };
      }

      return {
        answer: final.answer,
        answerMode: giftFallback ? "gift_recommendation" : final.answerMode,
        fallback: false,
        reasoningUsed,
        model,
        finishReason: data.choices?.[0]?.finish_reason,
        matchedProductIds: candidates,
        selectedProductIds,
        toolTrace,
        usage,
        evidenceTrace: officialCopyHits.length ? officialCopyHits : fallbackOfficialCopyHits,
      };
    }

    if (matchedProductIds.length) {
      messages.push({
        role: "user",
        content: "You have enough retrieved evidence. Do not request or describe more tools. Produce the required final JSON now using only the existing tool results.",
      });
      const finalProviderResult = await fetchDeepSeekWithRetry(
        baseUrl + "/chat/completions",
        {
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
        },
        toolTrace
      );
      const finalResponse = finalProviderResult.response;
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
        const selectedProductIds = filterRecommendedProductIds(
          final.answer,
          candidates,
          selectedFromModel
        );
        const verification = verifyAnswerClaims(
          final.answer,
          [...groundingContext, formatOfficialCopyContext(officialCopyHits)].join("\n")
        );
        if (!verification.passed) {
          toolTrace.push(`claim_verifier blocked=${verification.unsupported.join(",")}`);
          return {
            answer: conceptualGiftAnswer || copyFallback?.answer || giftFallback?.answer || fallbackRetrieval.fallbackAnswer,
            answerMode: giftFallback ? "gift_recommendation" : fallbackRetrieval.answerMode,
            fallback: true,
            reasoningUsed,
            model,
            reason: "unsupported_model_claim",
            matchedProductIds: candidates,
            selectedProductIds: copyFallback?.productIds ?? giftFallback?.selectedProductIds ?? fallbackRetrieval.selectedProductIds,
            toolTrace,
            usage,
            evidenceTrace: officialCopyHits.length ? officialCopyHits : fallbackOfficialCopyHits,
          };
        }
        return {
          answer: final.answer,
          answerMode: giftFallback ? "gift_recommendation" : final.answerMode,
          fallback: false,
          reasoningUsed,
          model,
          finishReason: finalData.choices?.[0]?.finish_reason,
          matchedProductIds: candidates,
          selectedProductIds,
          toolTrace,
          usage,
          evidenceTrace: officialCopyHits.length ? officialCopyHits : fallbackOfficialCopyHits,
        };
      }
    }

    return {
      answer: conceptualGiftAnswer || copyFallback?.answer || giftFallback?.answer || fallbackRetrieval.fallbackAnswer,
      answerMode: giftFallback?.answerMode ?? fallbackRetrieval.answerMode,
      fallback: true,
      reasoningUsed,
      model,
      reason: "tool_round_limit",
      matchedProductIds:
        giftFallback?.matchedProductIds ?? (matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds),
      selectedProductIds: copyFallback?.productIds ?? giftFallback?.selectedProductIds ?? fallbackRetrieval.selectedProductIds,
      toolTrace,
      usage,
      evidenceTrace: officialCopyHits.length ? officialCopyHits : fallbackOfficialCopyHits,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "unknown_error";
    return {
      answer: conceptualGiftAnswer || copyFallback?.answer || giftFallback?.answer || fallbackRetrieval.fallbackAnswer,
      answerMode: giftFallback?.answerMode ?? fallbackRetrieval.answerMode,
      fallback: true,
      reasoningUsed,
      model,
      reason: error instanceof Error && error.name === "AbortError"
        ? "deepseek_timeout"
        : errorMessage === "deepseek_internal_protocol_leak"
          ? "internal_protocol_leak"
          : "deepseek_exception",
      errorText: errorMessage,
      matchedProductIds:
        giftFallback?.matchedProductIds ?? (matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds),
      selectedProductIds: copyFallback?.productIds ?? giftFallback?.selectedProductIds ?? fallbackRetrieval.selectedProductIds,
      toolTrace,
      usage,
      evidenceTrace: officialCopyHits.length ? officialCopyHits : fallbackOfficialCopyHits,
    };
  } finally {
    clearTimeout(timer);
  }
}
