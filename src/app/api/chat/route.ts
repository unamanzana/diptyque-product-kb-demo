import { NextResponse } from "next/server";

import { generateDiptyqueAnswer } from "@/lib/deepseek";
import { buildDiptyqueContext } from "@/lib/diptyque-search";

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

    const { matchedProducts, contextText } = buildDiptyqueContext(message);
    const result = await generateDiptyqueAnswer({
      contextText,
      message,
    });

    return NextResponse.json({
      answer: result.answer,
      fallback: result.fallback,
      matchedProductNames: matchedProducts.map((product) => product.name),
      model: result.model,
      reason: "reason" in result ? result.reason : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
