import { NextResponse } from "next/server";

import { generateDiptyqueAnswer } from "@/lib/deepseek";
import { buildDiptyqueContext } from "@/lib/diptyque-search";
import { selectMentionedProductNames } from "@/lib/diptyque-recommendation-selection";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      message?: string;
    };
    const message = body.message?.trim();

    if (!message) {
      return NextResponse.json({ error: "missing_message" }, { status: 400 });
    }

    const { answerMode, deterministicAnswer, matchedProducts, contextText } = buildDiptyqueContext(message);
    if (deterministicAnswer) {
      return NextResponse.json({
        answer: deterministicAnswer,
        answerMode,
        answerSource: "ontology_full_list",
        fallback: false,
        matchedProductNames: matchedProducts.map((product) => product.name),
        model: "ontology",
        reasoningUsed: false,
      });
    }
    const result = await generateDiptyqueAnswer({
      contextText,
      message,
    });

    const recommendedProductNames = answerMode === "gift_recommendation" && !result.fallback
      ? selectMentionedProductNames(result.answer, matchedProducts)
      : [];

    return NextResponse.json({
      answer: result.answer,
      answerMode,
      answerSource: result.fallback ? "local_fallback" : "deepseek",
      fallback: result.fallback,
      matchedProductNames: matchedProducts.map((product) => product.name),
      recommendedProductNames,
      model: result.model,
      reasoningUsed: result.reasoningUsed,
      reason: "reason" in result ? result.reason : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
