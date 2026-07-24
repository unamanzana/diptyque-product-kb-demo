import { createHash } from "node:crypto";

export type ModelUsage = {
  completionTokens?: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  promptTokens?: number;
};

function sanitizeQuery(query: string) {
  return query
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/(?:\+?86[- ]?)?1\d{10}/g, "[phone]")
    .replace(/\d{7,}/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function queryId(query: string) {
  return createHash("sha256").update(query).digest("hex").slice(0, 12);
}

export function logZeroHit(query: string, answerMode: string) {
  const sanitizedQuery = sanitizeQuery(query);
  const id = queryId(sanitizedQuery);
  console.warn(JSON.stringify({
    event: "diptyque_zero_hit",
    timestamp: new Date().toISOString(),
    queryId: id,
    query: sanitizedQuery,
    answerMode,
  }));
  return id;
}

export function logModelRequest(input: {
  answerMode: string;
  durationMs: number;
  fallback: boolean;
  model: string;
  reason?: string;
  reasoningUsed: boolean;
  toolTrace?: string[];
  usage?: ModelUsage;
}) {
  console.info(JSON.stringify({
    event: "diptyque_model_request",
    timestamp: new Date().toISOString(),
    ...input,
  }));
}
