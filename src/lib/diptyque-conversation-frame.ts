import type { DiptyqueQueryIntent } from "@/lib/diptyque-query-plan";

export type ConversationAction = "KEEP" | "ADD" | "REPLACE" | "CLEAR" | "NEW_TOPIC";

export type ConversationField =
  | "subject"
  | "object"
  | "predicate"
  | "coreFamilies"
  | "productForms"
  | "collections"
  | "excludedTerms"
  | "maxPrice"
  | "sizes"
  | "softPreferences"
  | "resultSet";

export type ConversationEntity = {
  entityType: string;
  text: string;
};

export type ConversationFrame = {
  version: 1;
  turn: number;
  lastAction: ConversationAction;
  actionReason: string;
  intent: DiptyqueQueryIntent;
  subject: ConversationEntity;
  object: ConversationEntity;
  predicate: string;
  coreFamilies: string[];
  productForms: string[];
  collections: string[];
  excludedTerms: string[];
  maxPrice?: number;
  sizes: string[];
  softPreferences: string[];
  lastMatchedProductIds: string[];
  lastSelectedProductIds: string[];
  lastQuestion: string;
};

export type ConversationFrameUpdate = {
  action: ConversationAction;
  clearFields: ConversationField[];
  reason: string;
  intent: DiptyqueQueryIntent;
  subject: ConversationEntity;
  object: ConversationEntity;
  predicate: string;
  coreFamilies: string[];
  productForms: string[];
  collections: string[];
  excludedTerms: string[];
  maxPrice?: number;
  sizes: string[];
  softPreferences: string[];
};

const actions = new Set<ConversationAction>(["KEEP", "ADD", "REPLACE", "CLEAR", "NEW_TOPIC"]);
const fields = new Set<ConversationField>([
  "subject",
  "object",
  "predicate",
  "coreFamilies",
  "productForms",
  "collections",
  "excludedTerms",
  "maxPrice",
  "sizes",
  "softPreferences",
  "resultSet",
]);

function strings(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())))
    : [];
}

function entity(value: unknown): ConversationEntity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { entityType: "unknown", text: "" };
  const record = value as Record<string, unknown>;
  return {
    entityType: typeof record.entityType === "string" ? record.entityType : "unknown",
    text: typeof record.text === "string" ? record.text.trim() : "",
  };
}

export function emptyConversationFrame(): ConversationFrame {
  return {
    version: 1,
    turn: 0,
    lastAction: "NEW_TOPIC",
    actionReason: "",
    intent: "fact",
    subject: { entityType: "unknown", text: "" },
    object: { entityType: "unknown", text: "" },
    predicate: "none",
    coreFamilies: [],
    productForms: [],
    collections: [],
    excludedTerms: [],
    sizes: [],
    softPreferences: [],
    lastMatchedProductIds: [],
    lastSelectedProductIds: [],
    lastQuestion: "",
  };
}

export function sanitizeConversationFrame(value: unknown): ConversationFrame | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  const base = emptyConversationFrame();
  const action = typeof record.lastAction === "string" && actions.has(record.lastAction as ConversationAction)
    ? record.lastAction as ConversationAction
    : base.lastAction;
  const maxPrice = typeof record.maxPrice === "number" && Number.isFinite(record.maxPrice) && record.maxPrice > 0
    ? record.maxPrice
    : undefined;
  return {
    ...base,
    turn: typeof record.turn === "number" && Number.isFinite(record.turn) ? Math.max(0, Math.floor(record.turn)) : 0,
    lastAction: action,
    actionReason: typeof record.actionReason === "string" ? record.actionReason.slice(0, 300) : "",
    intent: typeof record.intent === "string" ? record.intent as DiptyqueQueryIntent : "fact",
    subject: entity(record.subject),
    object: entity(record.object),
    predicate: typeof record.predicate === "string" ? record.predicate : "none",
    coreFamilies: strings(record.coreFamilies),
    productForms: strings(record.productForms),
    collections: strings(record.collections),
    excludedTerms: strings(record.excludedTerms),
    maxPrice,
    sizes: strings(record.sizes),
    softPreferences: strings(record.softPreferences),
    lastMatchedProductIds: strings(record.lastMatchedProductIds),
    lastSelectedProductIds: strings(record.lastSelectedProductIds),
    lastQuestion: typeof record.lastQuestion === "string" ? record.lastQuestion.slice(0, 600) : "",
  };
}

function mergeValues(previous: string[], current: string[], action: ConversationAction) {
  if (!current.length) return previous;
  return action === "ADD" ? Array.from(new Set([...previous, ...current])) : current;
}

export function applyConversationFrameUpdate(
  previous: ConversationFrame | null,
  update: ConversationFrameUpdate,
  result: { matchedProductIds: string[]; selectedProductIds: string[]; question: string }
): ConversationFrame {
  const action = previous ? update.action : "NEW_TOPIC";
  const base = action === "NEW_TOPIC" ? emptyConversationFrame() : previous ?? emptyConversationFrame();
  const cleared = { ...base };
  const clear = new Set(update.clearFields.filter((field) => fields.has(field)));

  if (clear.has("subject")) cleared.subject = { entityType: "unknown", text: "" };
  if (clear.has("object")) cleared.object = { entityType: "unknown", text: "" };
  if (clear.has("predicate")) cleared.predicate = "none";
  if (clear.has("coreFamilies")) cleared.coreFamilies = [];
  if (clear.has("productForms")) cleared.productForms = [];
  if (clear.has("collections")) cleared.collections = [];
  if (clear.has("excludedTerms")) cleared.excludedTerms = [];
  if (clear.has("maxPrice")) delete cleared.maxPrice;
  if (clear.has("sizes")) cleared.sizes = [];
  if (clear.has("softPreferences")) cleared.softPreferences = [];

  const keepExistingTopic = action === "KEEP" && Boolean(cleared.subject.text);
  return {
    ...cleared,
    version: 1,
    turn: (previous?.turn ?? 0) + 1,
    lastAction: action,
    actionReason: update.reason,
    intent: update.intent,
    subject: keepExistingTopic || !update.subject.text ? cleared.subject : update.subject,
    object: ((action === "KEEP" && Boolean(cleared.object.text)) || !update.object.text)
      ? cleared.object
      : update.object,
    predicate: ((action === "KEEP" && cleared.predicate !== "none") || update.predicate === "none")
      ? cleared.predicate
      : update.predicate,
    coreFamilies: mergeValues(cleared.coreFamilies, update.coreFamilies, action),
    productForms: mergeValues(cleared.productForms, update.productForms, action),
    collections: mergeValues(cleared.collections, update.collections, action),
    excludedTerms: mergeValues(cleared.excludedTerms, update.excludedTerms, action),
    maxPrice: update.maxPrice ?? cleared.maxPrice,
    sizes: mergeValues(cleared.sizes, update.sizes, action),
    softPreferences: mergeValues(cleared.softPreferences, update.softPreferences, action),
    lastMatchedProductIds: result.matchedProductIds,
    lastSelectedProductIds: result.selectedProductIds,
    lastQuestion: result.question,
  };
}
