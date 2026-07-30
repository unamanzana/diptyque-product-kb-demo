import { NextResponse } from "next/server";

import { productNamesByIds } from "@/lib/diptyque-agent-tools";
import { logModelRequest, logZeroHit } from "@/lib/chat-observability";
import { generateDiptyqueAnswer, type ChatHistoryMessage } from "@/lib/deepseek";
import { buildDiptyqueQueryPlan, safetyGuardAnswer } from "@/lib/diptyque-query-plan";
import { buildDiptyqueContext } from "@/lib/diptyque-search";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      message?: string;
      history?: ChatHistoryMessage[];
    };
    const message = body.message?.trim();

    if (!message) {
      return NextResponse.json({ error: "missing_message" }, { status: 400 });
    }

    const history = Array.isArray(body.history)
      ? body.history
          .filter(
            (item): item is ChatHistoryMessage =>
              Boolean(item)
              && (item.role === "user" || item.role === "assistant")
              && typeof item.content === "string"
          )
          .slice(-8)
      : [];

    const queryPlan = buildDiptyqueQueryPlan(message, history);
    const safetyAnswer = safetyGuardAnswer(queryPlan);
    if (safetyAnswer) {
      return NextResponse.json({
        answer: safetyAnswer,
        answerMode: "safety_abstention",
        answerSource: "query_plan_guard",
        fallback: false,
        matchedProductNames: [],
        recommendedProductNames: [],
        model: "ontology",
        reasoningUsed: false,
        diagnostics: { queryPlan },
      });
    }

    const deterministic = buildDiptyqueContext(message, {
      allowDeterministicCatalog: queryPlan.allowDeterministicCatalog,
      collectionTerms: queryPlan.constraints.collections,
    });
    if (deterministic.deterministicAnswer) {
      return NextResponse.json({
        answer: deterministic.deterministicAnswer,
        answerMode: deterministic.answerMode,
        answerSource: "ontology_full_list",
        fallback: false,
        matchedProductNames: deterministic.matchedProducts.map((product) => product.name),
        recommendedProductNames: [],
        model: "ontology",
        reasoningUsed: false,
        diagnostics: { queryPlan },
      });
    }

    const modelStartedAt = performance.now();
    const result = await generateDiptyqueAnswer({
      history,
      message,
      queryPlan,
    });
    const durationMs = Math.round(performance.now() - modelStartedAt);
    const reason = "reason" in result ? result.reason : undefined;
    const usage = "usage" in result ? result.usage : undefined;
    const matchedProductNames = productNamesByIds(result.matchedProductIds);
    const recommendedProductNames = productNamesByIds(result.selectedProductIds);
    const zeroHitQueryId = !result.fallback && result.matchedProductIds.length === 0
      ? logZeroHit(message, result.answerMode)
      : undefined;

    logModelRequest({
      answerMode: result.answerMode,
      durationMs,
      fallback: result.fallback,
      model: result.model,
      reason,
      reasoningUsed: result.reasoningUsed,
      toolTrace: result.toolTrace,
      usage,
    });

    return NextResponse.json({
      answer: result.answer,
      answerMode: result.answerMode,
      answerSource: result.fallback ? "local_fallback" : "deepseek_tools",
      fallback: result.fallback,
      matchedProductNames,
      recommendedProductNames,
      model: result.model,
      reasoningUsed: result.reasoningUsed,
      reason,
      diagnostics: {
        durationMs,
        usage,
        zeroHit: Boolean(zeroHitQueryId),
        zeroHitQueryId,
        toolTrace: result.toolTrace,
        evidenceTrace: "evidenceTrace" in result ? result.evidenceTrace : [],
        queryPlan,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
