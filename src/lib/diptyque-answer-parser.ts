const INTERNAL_PROTOCOL_PATTERN = /(?:<[^>]*(?:DSML|tool_calls|invoke\s+name=)[^>]*>|\btool_calls\b|<\|(?:assistant|tool)[^|]*\|>)/i;

export function containsInternalProtocol(value: string) {
  return INTERNAL_PROTOCOL_PATTERN.test(value);
}

export function cleanAnswer(value: string) {
  if (containsInternalProtocol(value)) throw new Error("deepseek_internal_protocol_leak");

  const answerOnly = value.replace(/\x60\x60\x60(?:json)?[\s\S]*?\x60\x60\x60/gi, "");
  const rawLines = answerOnly.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];
  for (let index = 0; index < rawLines.length; index += 1) {
    const rawLine = rawLines[index].trim();
    if (!rawLine || /^[-*_]{3,}$/.test(rawLine)) {
      if (lines.at(-1) !== "") lines.push("");
      continue;
    }
    if (/^(?:product_ids|answer_mode|answer_m)(?:\s*:|$)/i.test(rawLine)) continue;
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

type ParsedAnswer = {
  answer: string;
  answerMode: string;
  productIds: string[];
};

function stripOuterFence(value: string) {
  return value.trim()
    .replace(/^\x60\x60\x60(?:json)?\s*/i, "")
    .replace(/\s*\x60\x60\x60$/, "")
    .trim();
}

function parseJsonValue(value: string): unknown {
  const stripped = stripOuterFence(value);
  try {
    return JSON.parse(stripped);
  } catch {
    const starts = Array.from(stripped.matchAll(/\{\s*"answer"\s*:/g));
    const start = starts.at(-1)?.index;
    const end = stripped.lastIndexOf("}");
    if (start == null || end <= start) return undefined;
    try {
      return JSON.parse(stripped.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

function parseStructured(value: string, depth = 0): ParsedAnswer | null {
  if (depth > 3) return null;
  const parsed = parseJsonValue(value);
  if (typeof parsed === "string") return parseStructured(parsed, depth + 1);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const outerIds = Array.isArray(record.product_ids)
    ? record.product_ids.filter((id): id is string => typeof id === "string")
    : [];
  const outerMode = typeof record.answer_mode === "string" ? record.answer_mode : "agentic_search";
  if (typeof record.answer !== "string") return null;

  const nested = parseStructured(record.answer, depth + 1);
  if (nested) {
    return {
      answer: nested.answer,
      answerMode: nested.answerMode === "agentic_search" ? outerMode : nested.answerMode,
      productIds: nested.productIds.length ? nested.productIds : outerIds,
    };
  }

  return {
    answer: cleanAnswer(record.answer),
    answerMode: outerMode,
    productIds: outerIds,
  };
}

export function parseFinalResponse(content: string): ParsedAnswer {
  const structured = parseStructured(content);
  if (structured) return structured;
  return {
    answer: cleanAnswer(content),
    answerMode: "agentic_search",
    productIds: [],
  };
}
