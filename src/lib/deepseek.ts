import {
  buildConstrainedFallback,
  buildGiftFallbackRecommendation,
  diptyqueAgentTools,
  executeDiptyqueQueryPlan,
  executeDiptyqueTool,
  filterRecommendedProductIds,
  type ToolExecution,
} from "@/lib/diptyque-agent-tools";
import type { ModelUsage } from "@/lib/chat-observability";
import { parseFinalResponse } from "@/lib/diptyque-answer-parser";
export { cleanAnswer, containsInternalProtocol } from "@/lib/diptyque-answer-parser";
import { applyConversationFrameUpdate } from "@/lib/diptyque-conversation-frame";
import type {
  ConversationFrame,
  ConversationFrameUpdate,
} from "@/lib/diptyque-conversation-frame";
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
const REQUEST_TIMEOUT_MS = 45000;
const MAX_TOOL_ROUNDS = 3;
const MAX_PROVIDER_ATTEMPTS = 3;
const RETRYABLE_PROVIDER_STATUSES = new Set([429, 500, 502, 503, 504]);

export type ChatHistoryMessage = {
  role: "assistant" | "user";
  content: string;
};

export type DeepSeekChatInput = {
  conversationFrame: ConversationFrame | null;
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

const SYSTEM_PROMPT = [
  "You are a thoughtful Diptyque product advisor. Understand the customer's full natural-language need before deciding how to search.",
  "Recent conversation is context, not a permanent filter. Carry it forward when the current turn is a short refinement or clearly refers to the prior result. A newly stated complete need starts a new recommendation topic and clears unrelated scope or budget.",
  "QUERY_PLAN and PLANNED_RETRIEVAL provide a small grounded starting set, not a script you must repeat or an authoritative classification of the user's intent. Re-read the full user utterance yourself: distinguish wanting/recommending, catalog lookup, comparison and relation questions from natural wording, then use the starting evidence or call tools when it is insufficient.",
  "Ontology tools validate product identity, category, price, stock, specification and approved relations. OFFICIAL_COPY_EVIDENCE provides exact brand wording. Never invent products, prices, URLs, stock, specifications or official relationships.",
  "Descriptive preferences such as 奶香、木质、清冷、不甜 and 适合送礼 are soft signals. Interpret their combination holistically. Do not turn them into rigid filters or claim that an inference is official wording.",
  "If the customer uses a colloquial, near-synonym or likely typo that is not an ontology label, do not downgrade the request to a fact lookup or conclude there are no products. Treat the original wording as a soft semantic signal, use resolve_query_semantics when clarification is useful, and judge it against the retrieved official descriptions. If the mapping remains uncertain, say so with cautious wording while still presenting grounded candidates.",
  "For recommendations, explain why each candidate fits and where it may not fully fit. Prefer 3 to 5 distinct, in-stock, non-refill products unless the customer explicitly asks about refills.",
  "For gift bundles, verify every product and calculate the total from recorded prices. Never recommend an over-budget bundle.",
  "For relation questions, distinguish official direct pairing from specification compatibility. Specification compatibility is not an official item-by-item recommendation.",
  "Do not infer longevity, projection, season, gender, therapeutic effects, pet safety, popularity or risk-free gifting without explicit evidence.",
  "Write concise Chinese for a customer, not an audit report. Do not mention retrieval counts, internal tools, ontology validation or fallback logic.",
  "For multiple recommendations, answer with one short conclusion followed by separate numbered blocks.",
  "Each product block must use separate lines: number and product name; 理由：grounded explanation; 价格：recorded price or range when available.",
  "For bundles use separate lines: number and combination; 合计：total; 搭配理由：explanation. Never place two numbered items on the same line.",
  "Products mentioned only as excluded, unsuitable, out of stock or over budget must not appear in product_ids.",
  "Your final response must be a JSON object with exactly these keys: answer, product_ids, answer_mode.",
  "answer_mode is one of product_search, price_search, gift_recommendation, relation_search. product_ids contains only exact retrieved IDs for products actually recommended, maximum 5.",
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
  let conversationFrameUpdate: ConversationFrameUpdate | undefined;
  const fallbackRetrieval = executeDiptyqueQueryPlan(input.queryPlan);
  const gateFallbackCopyToStructuredCandidates = input.queryPlan.intent === "gifting"
    || input.queryPlan.conversationState.hardConstraintKeys.length > 0;
  const fallbackOfficialCopyHits = retrieveOfficialCopy(
    input.queryPlan.conversationState.contextualQuery,
    input.queryPlan,
    gateFallbackCopyToStructuredCandidates ? fallbackRetrieval.productIds : [],
    6,
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
  const fallbackDecision = (candidateIds: string[] = []) => {
    const baseEffectiveFrame = conversationFrameUpdate
      ? applyConversationFrameUpdate(input.conversationFrame, conversationFrameUpdate, {
          matchedProductIds: input.conversationFrame?.lastMatchedProductIds ?? [],
          selectedProductIds: input.conversationFrame?.lastSelectedProductIds ?? [],
          question: input.message,
        })
      : input.conversationFrame;
    const explicitExcludedTerms = [
      /(?:\u4e0d\u559c\u6b22|\u4e0d\u8981|\u6392\u9664|\u522b\u63a8\u8350).*\u6e05\u6d01/.test(input.message) ? "\u6e05\u6d01\u7528\u54c1" : "",
      /(?:\u4e0d\u559c\u6b22|\u4e0d\u8981|\u6392\u9664|\u522b\u63a8\u8350).*\u8865\u5145\u88c5/.test(input.message) ? "\u8865\u5145\u88c5" : "",
      /(?:\u4e0d\u559c\u6b22|\u4e0d\u8981|\u6392\u9664|\u522b\u63a8\u8350).*\u9999\u6c34/.test(input.message) ? "\u9999\u6c34" : "",
    ].filter(Boolean);
    const effectiveFrame = baseEffectiveFrame && explicitExcludedTerms.length
      ? { ...baseEffectiveFrame, excludedTerms: Array.from(new Set([...baseEffectiveFrame.excludedTerms, ...explicitExcludedTerms])) }
      : baseEffectiveFrame;
    const avoidPreviouslyShown = /\u8fd8\u6709|\u4e0d\u8981.{0,8}\u91cd\u590d|\u6362/.test(input.message);
    const broadenedFallbackIds = avoidPreviouslyShown && effectiveFrame
      ? executeDiptyqueTool("search_products", JSON.stringify({
          core_families: effectiveFrame.coreFamilies,
          product_forms: effectiveFrame.productForms,
          collections: effectiveFrame.collections,
          sizes: effectiveFrame.sizes,
          max_price: effectiveFrame.maxPrice,
          limit: 100,
        })).productIds
      : [];
    const rawCandidateIds = Array.from(new Set([
      ...candidateIds,
      ...broadenedFallbackIds,
      ...fallbackMatchedProductIds,
      ...(giftFallback?.matchedProductIds ?? []),
      ...(copyFallback?.productIds ?? []),
    ]));
    const previouslyShown = new Set([
      ...input.queryPlan.conversationState.previouslyPresentedProductIds,
      ...(input.conversationFrame?.lastSelectedProductIds ?? []),
    ]);
    const allCandidateIds = avoidPreviouslyShown
      ? rawCandidateIds.filter((id) => !previouslyShown.has(id))
      : rawCandidateIds;
    const hasHardConstraints = Boolean(effectiveFrame && (
      effectiveFrame.coreFamilies.length
      || effectiveFrame.productForms.length
      || effectiveFrame.collections.length
      || effectiveFrame.excludedTerms.length
      || effectiveFrame.maxPrice != null
      || effectiveFrame.sizes.length
    ));
    if (
      hasHardConstraints
      && copyFallback
      && (input.queryPlan.intent === "recommendation" || input.queryPlan.intent === "gifting")
    ) {
      return {
        answer: copyFallback.answer,
        answerMode: giftFallback?.answerMode ?? fallbackRetrieval.answerMode,
        matchedProductIds: allCandidateIds,
        selectedProductIds: copyFallback.productIds,
      };
    }
    if (hasHardConstraints && input.queryPlan.intent !== "relation") {
      return buildConstrainedFallback(
        allCandidateIds,
        effectiveFrame,
        giftFallback?.answerMode ?? fallbackRetrieval.answerMode
      );
    }
    return {
      answer: conceptualGiftAnswer || copyFallback?.answer || giftFallback?.answer || fallbackRetrieval.fallbackAnswer,
      answerMode: giftFallback?.answerMode ?? fallbackRetrieval.answerMode,
      matchedProductIds: giftFallback?.matchedProductIds ?? allCandidateIds,
      selectedProductIds: copyFallback?.productIds ?? giftFallback?.selectedProductIds ?? fallbackRetrieval.selectedProductIds,
    };
  };
  if (!apiKey) {
    return {
      answer: fallbackDecision().answer,
      answerMode: fallbackDecision().answerMode,
      fallback: true,
      reasoningUsed: false,
      conversationFrameUpdate,
      model,
      reason: "missing_api_key",
      matchedProductIds: fallbackDecision().matchedProductIds,
      selectedProductIds: fallbackDecision().selectedProductIds,
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
    {
      role: "system",
      content: "QUERY_PLAN\n" + JSON.stringify(input.queryPlan),
    },
    {
      role: "system",
      content: "PLANNED_RETRIEVAL\n" + fallbackRetrieval.content,
    },
    {
      role: "system",
      content: "OFFICIAL_COPY_EVIDENCE\n" + formatOfficialCopyContext(fallbackOfficialCopyHits),
    },
    ...input.history.slice(-8).map((message) => ({
      role: message.role,
      content: message.content.slice(0, 1800),
    })),
    { role: "user", content: input.message },
  ];
  const matchedProductIds: string[] = [...fallbackMatchedProductIds];
  const displayCandidateIds: string[] = [];
  const toolTrace: string[] = [...fallbackRetrieval.toolTrace];
  const groundingContext: string[] = [
    fallbackRetrieval.content,
    "OFFICIAL_COPY_EVIDENCE\n" + formatOfficialCopyContext(fallbackOfficialCopyHits),
  ];
  const usage: ModelUsage = {};
  let reasoningUsed = false;
  let semanticFrameResolved = false;
  let exactSelection: ToolExecution["exactSelection"] = fallbackRetrieval.exactSelection;
  officialCopyHits = [...fallbackOfficialCopyHits];
  let searchCallCount = 0;
  const toolCallCache = new Set<string>();
  let forceFinalAnswer = false;

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
            reasoning_effort: "medium",
            max_tokens: 3200,
            messages,
            ...(forceFinalAnswer ? {} : { tools: diptyqueAgentTools, tool_choice: "auto" }),
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
          answer: fallbackDecision(matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds).answer,
          answerMode: fallbackDecision(matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds).answerMode,
          fallback: true,
          reasoningUsed,
          conversationFrameUpdate,
          model,
          reason: "deepseek_http_" + response.status,
          errorText,
          matchedProductIds: fallbackDecision(matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds).matchedProductIds,
          selectedProductIds: fallbackDecision(matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds).selectedProductIds,
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
        const pendingSystemMessages: Array<Record<string, unknown>> = [];
        for (const toolCall of toolCalls) {

          if (semanticFrameResolved && toolCall.function.name === "resolve_query_semantics") {
            const content = JSON.stringify({
              error: "semantic_frame_already_resolved",
              instruction: "Use the validated semantic frame and continue retrieval or answer generation.",
            });
            toolTrace.push("blocked_repeated_semantic_resolution");
            messages.push({ role: "tool", tool_call_id: toolCall.id, content });
            continue;
          }
          let toolArguments = toolCall.function.arguments;
          if (toolCall.function.name === "search_products") {
            let parsedArguments: Record<string, unknown> = {};
            try {
              parsedArguments = JSON.parse(toolArguments) as Record<string, unknown>;
            } catch {
              parsedArguments = {};
            }
            const requestedLimit = typeof parsedArguments.limit === "number" ? parsedArguments.limit : 40;
            const maxLimit = input.queryPlan.intent === "catalog" ? 100 : 12;
            parsedArguments.limit = Math.min(maxLimit, Math.max(1, Math.floor(requestedLimit)));
            const explicitRefillRequest = /补充装|补充瓶/.test(input.message);
            if ((input.queryPlan.intent === "recommendation" || input.queryPlan.intent === "gifting") && !explicitRefillRequest) {
              parsedArguments.exclude_refills = true;
              parsedArguments.in_stock = true;
            }
            const broadScentRecommendation =
              input.queryPlan.intent === "recommendation"
              && !input.queryPlan.constraints.productForms.length
              && /香味|气味|闻起来|水汽|通透|轻盈|清新|木质|花香/.test(input.message);
            if (broadScentRecommendation) parsedArguments.representative_only = true;
            toolArguments = JSON.stringify(parsedArguments);
          }
          if (toolCall.function.name === "get_product_relations") {
            let parsedArguments: Record<string, unknown> = {};
            try {
              parsedArguments = JSON.parse(toolArguments) as Record<string, unknown>;
            } catch {
              parsedArguments = {};
            }
            if (!Array.isArray(parsedArguments.target_terms) || !parsedArguments.target_terms.length) {
              const targetText = conversationFrameUpdate?.object.text;
              if (targetText) parsedArguments.target_terms = [targetText];
            }
            toolArguments = JSON.stringify(parsedArguments);
          }
          const toolKey = toolCall.function.name + ":" + toolArguments;
          if (toolCallCache.has(toolKey)) {
            const content = JSON.stringify({
              cached: true,
              instruction: "Use the identical tool result already present earlier in this conversation.",
            });
            toolTrace.push("blocked_duplicate_tool_call name=" + toolCall.function.name);
            messages.push({ role: "tool", tool_call_id: toolCall.id, content });
            continue;
          }
          if (toolCall.function.name === "search_products") {
            searchCallCount += 1;
            if (searchCallCount > 2) {
              const content = JSON.stringify({
                error: "search_budget_exhausted",
                instruction: "Use the product candidates already retrieved and produce the final answer.",
              });
              toolTrace.push("blocked_search_budget_exhausted");
              forceFinalAnswer = true;
              messages.push({ role: "tool", tool_call_id: toolCall.id, content });
              continue;
            }
          }
          toolCallCache.add(toolKey);
          const execution = executeDiptyqueTool(toolCall.function.name, toolArguments);
          conversationFrameUpdate = execution.conversationFrameUpdate ?? conversationFrameUpdate;
          matchedProductIds.push(...execution.productIds);
          if (execution.displayProductIds?.length) displayCandidateIds.push(...execution.displayProductIds);
          toolTrace.push(execution.summary);
          groundingContext.push(toolCall.function.name + "\n" + execution.content);
          exactSelection = execution.exactSelection ?? exactSelection;
          if (toolCall.function.name === "get_product_details" && execution.productIds.length) forceFinalAnswer = true;
          if (toolCall.function.name === "resolve_query_semantics" && execution.conversationFrameUpdate) semanticFrameResolved = true;
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
              4,
              true,
              input.queryPlan.conversationState.previouslyPresentedProductIds
            );
            const copyByChunk = new Map([...officialCopyHits, ...retrievedCopy].map((hit) => [hit.chunkId, hit]));
            officialCopyHits = Array.from(copyByChunk.values()).slice(0, 8);
            if (retrievedCopy.length) {
              const context = formatOfficialCopyContext(retrievedCopy);
              groundingContext.push("OFFICIAL_COPY_EVIDENCE\n" + context);
              pendingSystemMessages.push({ role: "system", content: "OFFICIAL_COPY_EVIDENCE\n" + context });
              toolTrace.push("official_copy_retrieval hits=" + retrievedCopy.length);
            }
          }
        }
        messages.push(...pendingSystemMessages);
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
      const cardCandidates = displayCandidateIds.length ? Array.from(new Set(displayCandidateIds)) : candidates;
      if (!final.answer.trim() && !exactSelection) {
        toolTrace.push("empty_model_answer");
        if (round < MAX_TOOL_ROUNDS - 1) {
          messages.push({ role: "assistant", content: message?.content ?? "" });
          messages.push({
            role: "user",
            content: "Your answer was empty. Produce the required final JSON with a non-empty grounded answer and productIds from the retrieved candidates.",
          });
          continue;
        }
        return {
          answer: fallbackDecision(matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds).answer,
          answerMode: fallbackDecision(matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds).answerMode,
          fallback: true,
          reasoningUsed,
          conversationFrameUpdate,
          model,
          reason: "empty_model_answer",
          matchedProductIds: fallbackDecision(candidates).matchedProductIds,
          selectedProductIds: fallbackDecision(candidates).selectedProductIds,
          toolTrace,
          usage,
          evidenceTrace: officialCopyHits.length ? officialCopyHits : fallbackOfficialCopyHits,
        };
      }
      if (exactSelection) {
        return {
          answer: exactSelection.answer,
          answerMode: exactSelection.answerMode,
          fallback: false,
          reasoningUsed,
          conversationFrameUpdate,
          model,
          finishReason: data.choices?.[0]?.finish_reason,
          matchedProductIds: candidates,
          selectedProductIds: exactSelection.productIds,
          toolTrace,
          usage,
          evidenceTrace: officialCopyHits.length ? officialCopyHits : fallbackOfficialCopyHits,
        };
      }
      const selectedFromModel = final.productIds.filter((id) => cardCandidates.includes(id)).slice(0, 5);
      const selectedProductIds = filterRecommendedProductIds(
        final.answer,
        cardCandidates,
        selectedFromModel
      );
      const verification = verifyAnswerClaims(
        final.answer,
        [...groundingContext, formatOfficialCopyContext(officialCopyHits)].join("\n")
      );
      if (!verification.passed) {
        toolTrace.push(`claim_verifier blocked=${verification.unsupported.join(",")}`);
        return {
          answer: fallbackDecision(matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds).answer,
          answerMode: fallbackDecision(matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds).answerMode,
          fallback: true,
          reasoningUsed,
          conversationFrameUpdate,
          model,
          reason: "unsupported_model_claim",
          matchedProductIds: fallbackDecision(candidates).matchedProductIds,
          selectedProductIds: fallbackDecision(candidates).selectedProductIds,
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
        conversationFrameUpdate,
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
            reasoning_effort: "medium",
            max_tokens: 3200,
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
        const cardCandidates = displayCandidateIds.length ? Array.from(new Set(displayCandidateIds)) : candidates;
        if (!final.answer.trim() && !exactSelection) {
          toolTrace.push("empty_final_model_answer");
          return {
            answer: fallbackDecision(matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds).answer,
            answerMode: fallbackDecision(matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds).answerMode,
            fallback: true,
            reasoningUsed,
            conversationFrameUpdate,
            model,
            reason: "empty_model_answer",
            matchedProductIds: fallbackDecision(candidates).matchedProductIds,
            selectedProductIds: fallbackDecision(candidates).selectedProductIds,
            toolTrace,
            usage,
            evidenceTrace: officialCopyHits.length ? officialCopyHits : fallbackOfficialCopyHits,
          };
        }
        if (exactSelection) {
          return {
            answer: exactSelection.answer,
            answerMode: exactSelection.answerMode,
            fallback: false,
            reasoningUsed,
            conversationFrameUpdate,
            model,
            finishReason: finalData.choices?.[0]?.finish_reason,
            matchedProductIds: candidates,
            selectedProductIds: exactSelection.productIds,
            toolTrace,
            usage,
          };
        }
        const selectedFromModel = final.productIds.filter((id) => cardCandidates.includes(id)).slice(0, 5);
        const selectedProductIds = filterRecommendedProductIds(
          final.answer,
          cardCandidates,
          selectedFromModel
        );
        const verification = verifyAnswerClaims(
          final.answer,
          [...groundingContext, formatOfficialCopyContext(officialCopyHits)].join("\n")
        );
        if (!verification.passed) {
          toolTrace.push(`claim_verifier blocked=${verification.unsupported.join(",")}`);
          return {
            answer: fallbackDecision(matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds).answer,
            answerMode: fallbackDecision(matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds).answerMode,
            fallback: true,
            reasoningUsed,
            conversationFrameUpdate,
            model,
            reason: "unsupported_model_claim",
            matchedProductIds: fallbackDecision(candidates).matchedProductIds,
            selectedProductIds: fallbackDecision(candidates).selectedProductIds,
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
          conversationFrameUpdate,
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
      answer: fallbackDecision(matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds).answer,
      answerMode: fallbackDecision(matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds).answerMode,
      fallback: true,
      reasoningUsed,
      conversationFrameUpdate,
      model,
      reason: "tool_round_limit",
      matchedProductIds:
        giftFallback?.matchedProductIds ?? (matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds),
      selectedProductIds: fallbackDecision(matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds).selectedProductIds,
      toolTrace,
      usage,
      evidenceTrace: officialCopyHits.length ? officialCopyHits : fallbackOfficialCopyHits,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "unknown_error";
    return {
      answer: fallbackDecision(matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds).answer,
      answerMode: fallbackDecision(matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds).answerMode,
      fallback: true,
      reasoningUsed,
      conversationFrameUpdate,
      model,
      reason: error instanceof Error && error.name === "AbortError"
        ? "deepseek_timeout"
        : errorMessage === "deepseek_internal_protocol_leak"
          ? "internal_protocol_leak"
          : "deepseek_exception",
      errorText: errorMessage,
      matchedProductIds:
        giftFallback?.matchedProductIds ?? (matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds),
      selectedProductIds: fallbackDecision(matchedProductIds.length ? Array.from(new Set(matchedProductIds)) : fallbackMatchedProductIds).selectedProductIds,
      toolTrace,
      usage,
      evidenceTrace: officialCopyHits.length ? officialCopyHits : fallbackOfficialCopyHits,
    };
  } finally {
    clearTimeout(timer);
  }
}
