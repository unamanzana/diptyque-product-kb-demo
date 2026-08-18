import schemaV1Candidate from "../../data-pipeline/diptyque_frontend_schema_v1_candidate.json" with { type: "json" };
import productionData from "../data/diptyque-frontend-data.json" with { type: "json" };
import {
  extractProductCatalogScope,
  isGiftRecommendationQuery,
} from "./diptyque-query-intent.ts";

const frontendData = process.env.NEXT_PUBLIC_DIPTYQUE_SCHEMA_V1 === "true"
  ? schemaV1Candidate
  : productionData;

type QueryHistoryMessage = {
  role: "assistant" | "user";
  content: string;
};

export type DiptyqueQueryIntent =
  | "catalog"
  | "comparison"
  | "fact"
  | "gifting"
  | "recommendation"
  | "relation"
  | "safety";

export type DiptyqueRelationIntent =
  | "accessory"
  | "layering"
  | "pairing"
  | "refill_compatibility"
  | "series_membership";

export type DiptyqueQueryConstraints = {
  collections: string[];
  excludedCollections: string[];
  coreFamilies: string[];
  excludeRefills: boolean;
  excludedProductForms: string[];
  maxPrice?: number;
  productForms: string[];
  sizes: string[];
  variantTags: string[];
};

export type DiptyqueConversationState = {
  contextualQuery: string;
  hardConstraintKeys: Array<keyof DiptyqueQueryConstraints>;
  isFollowUp: boolean;
  previousUserQuery: string;
  previouslyPresentedProductIds: string[];
};

export type DiptyqueQueryPlan = {
  allowDeterministicCatalog: boolean;
  conversationState: DiptyqueConversationState;
  constraints: DiptyqueQueryConstraints;
  currentQuery: string;
  inheritedConstraintKeys: Array<keyof DiptyqueQueryConstraints>;
  intent: DiptyqueQueryIntent;
  relationIntent?: DiptyqueRelationIntent;
  relationTypes: string[];
  recommendationLimit?: number;
  requiresEvidence: boolean;
  safety: {
    blockProductRecommendation: boolean;
    reason: string;
    topic: "none" | "pet_safety";
  };
  softPreferences: string[];
};

type Payload = {
  products: Array<{
    collections: string[];
    coreFamily: string;
    id: string;
    name: string;
    productForm: string;
  }>;
};

const payload = frontendData as Payload;
const coreFamilies = unique(payload.products.map((product) => product.coreFamily));
const productForms = unique(payload.products.map((product) => product.productForm));
const collections = unique(payload.products.flatMap((product) => product.collections));
const vocabulary = { coreFamilies, productForms };

const COMPARISON_PATTERN = /区别|对比|一样吗|一回事吗|闻起来像吗|完全一样|按[^。！？]*比较/;
const PREFERENCE_PATTERN = /喜欢|不喜欢|不想|推荐|适合|偏好|柔和|清新|清冷|小众|甜|浓|自然|氛围|入门|撞香|怎么选|闻起来|水汽|通透|轻盈|像.*(?:花园|森林|海边)|有没有.*(?:香味|气味)|(?:想要|想找|想买|想选).{0,20}(?:香水|香氛|香味|气味|味道)/;
const CATALOG_PATTERN = /有哪些|有什么|列出|全部|所有|多少款|几款/;
const REFERENTIAL_PATTERN = /其中|这些|刚才|那款|这款|上述|前面/;
const PET_PATTERN = /宠物|猫|猫咪|狗|狗狗/;
const SAFETY_PATTERN = /安全|无害|没有风险|放心|适合.*宠物|宠物.*适合/;
const GIFT_FALLBACK_PATTERN = /想送|送给|作为礼物|当礼物/;
const EVIDENCE_PATTERN = /依据|证据|核对|官方|确认|真的|为什么/;

const RELATION_RULES: Array<{
  intent: DiptyqueRelationIntent;
  pattern: RegExp;
  relationTypes: string[];
}> = [
  { intent: "layering", pattern: /叠香/, relationTypes: ["LAYER_WITH"] },
  { intent: "accessory", pattern: /配件|烛盖|烛罩|灭烛|修剪器/, relationTypes: ["ACCESSORY_FOR"] },
  {
    intent: "refill_compatibility",
    pattern: /补充装.*(?:适用|对应|兼容|容器)|(?:适用|对应|兼容).*补充装|补充瓶.*(?:适用|容器)/,
    relationTypes: ["REFILL_FOR"],
  },
  { intent: "series_membership", pattern: /同系列|同一个香味|除了香水|系列关系/, relationTypes: [] },
  { intent: "pairing", pattern: /搭配|组合|一起用/, relationTypes: ["PAIRS_WITH", "SCENT_RITUAL_WITH", "EXTENDS_TO_HOME"] },
];

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[，。！？、；：,.!?;:]/g, "");
}

function occurrenceIndexes(text: string, term: string) {
  const indexes: number[] = [];
  for (let index = text.indexOf(term); index >= 0; index = text.indexOf(term, index + 1)) {
    indexes.push(index);
  }
  return indexes;
}

function mentionedValues(query: string, values: string[]) {
  const normalizedQuery = normalize(query);
  const matches = values.filter((value) => normalizedQuery.includes(normalize(value)));
  return matches.filter((value) => {
    const normalizedValue = normalize(value);
    const longerMatches = matches.filter(
      (other) => other !== value && normalize(other).length > normalizedValue.length && normalize(other).includes(normalizedValue)
    );
    if (!longerMatches.length) return true;
    return occurrenceIndexes(normalizedQuery, normalizedValue).some((index) =>
      !longerMatches.some((other) => {
        const normalizedOther = normalize(other);
        return occurrenceIndexes(normalizedQuery, normalizedOther).some(
          (otherIndex) => index >= otherIndex && index + normalizedValue.length <= otherIndex + normalizedOther.length
        );
      })
    );
  });
}

function extractPriceCeiling(query: string) {
  const normalized = query.replace(/,/g, "").replace(/\s+/g, "");
  const match = normalized.match(/(?:预算|不超过|不高于|最高|控制在)?[¥￥]?(\d+(?:\.\d+)?)元?(?:以内|以下|之内|左右)/);
  const value = Number(match?.[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function extractConstraints(query: string): DiptyqueQueryConstraints {
  const normalized = normalize(query);
  const excludesPerfume = /除了香水/.test(normalized);
  const catalogScope = excludesPerfume ? null : extractProductCatalogScope(query, vocabulary);
  const mentionedFamilies = mentionedValues(query, coreFamilies);
  const mentionedForms = mentionedValues(query, productForms);
  const allMentionedCollections = mentionedValues(query, collections);
  const excludedCollections = allMentionedCollections.filter((collection) =>
    new RegExp(`(?:不要|不喜欢|排除|不含)${normalize(collection)}`).test(normalized)
  );
  const evidencePredicateIndex = normalized.search(/含有|包含|含哪|香材/);
  const collectionIsPreferenceSeed = /喜欢.*但.*(?:想找|找一款)/.test(normalized);
  const positiveCollections = allMentionedCollections
    .filter(() => !collectionIsPreferenceSeed)
    .filter((collection) => !excludedCollections.includes(collection))
    .filter((collection) =>
      evidencePredicateIndex < 0 || normalized.indexOf(normalize(collection)) < evidencePredicateIndex
    );
  const hasSpecificPerfumeForm = mentionedForms.some((form) => form === "淡香水" || form === "淡香精");
  const perfumeForms = /香水/.test(normalized) && !hasSpecificPerfumeForm && !/除了香水/.test(normalized)
    ? productForms.filter((form) => form === "淡香水" || form === "淡香精")
    : [];
  const candleForms = /(?:香氛)?蜡烛/.test(normalized)
    ? productForms.filter((form) => form.includes("香氛蜡烛") && !form.includes("配饰"))
    : [];
  const excludedProductForms = /除了香水/.test(normalized)
    ? productForms.filter((form) => form === "淡香水" || form === "淡香精")
    : [];
  const broadHomeFamilies = /家居产品|家居用品|乔迁/.test(normalized)
    ? coreFamilies.filter((family) => family === "家居香氛" || family === "艺术家居")
    : [];
  const homeFragranceFamilies = /家里|家中|空间|卧室|客厅|卫生间|高级酒店|家居香味|家居香氛/.test(normalized)
    ? coreFamilies.filter((family) => family === "家居香氛")
    : [];
  const personalFragranceFamilies = !excludesPerfume && !/蜡烛|护手霜|家居/.test(normalized) && /香水|白花香|撞香|通勤.*香/.test(normalized)
    ? coreFamilies.filter((family) => family === "个人香氛")
    : [];
  const scentExperienceFamilies = /香味|气味|闻起来/.test(normalized)
    && !personalFragranceFamilies.length
    && !homeFragranceFamilies.length
    ? coreFamilies.filter((family) => family === "个人香氛" || family === "家居香氛")
    : [];
  return {
    collections: positiveCollections,
    excludedCollections,
    coreFamilies: unique([
      ...mentionedFamilies,
      ...(catalogScope?.coreFamilies ?? []),
      ...broadHomeFamilies,
      ...homeFragranceFamilies,
      ...personalFragranceFamilies,
      ...scentExperienceFamilies,
    ]),
    excludeRefills: /不要补充装|不含补充装|排除补充装/.test(normalized),
    excludedProductForms,
    maxPrice: extractPriceCeiling(query),
    productForms: unique([
      ...mentionedForms,
      ...(catalogScope?.productForms ?? []),
      ...perfumeForms,
      ...candleForms,
    ]),
    sizes: unique(Array.from(query.matchAll(/\b\d+(?:\.\d+)?\s*(?:ml|g)\b/gi)).map((match) => match[0].replace(/\s+/g, "").toUpperCase())),
    variantTags: /补充装|补充瓶/.test(normalized) && !/不要补充装|不含补充装|排除补充装/.test(normalized) ? ["补充装"] : [],
  };
}

function mergeWithHistory(
  current: DiptyqueQueryConstraints,
  history: QueryHistoryMessage[]
) {
  const previousUserQueries = history
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => message.content)
    .reverse();
  const previous = previousUserQueries.map(extractConstraints);
  const inheritedConstraintKeys: Array<keyof DiptyqueQueryConstraints> = [];
  const inheritArray = (key: "collections" | "excludedCollections" | "coreFamilies" | "productForms" | "sizes" | "variantTags") => {
    if (current[key].length) return current[key];
    const value = previous.find((constraints) => constraints[key].length)?.[key] ?? [];
    if (value.length) inheritedConstraintKeys.push(key);
    return value;
  };
  const excludedProductForms = current.excludedProductForms.length
    ? current.excludedProductForms
    : previous.find((constraints) => constraints.excludedProductForms.length)?.excludedProductForms ?? [];
  if (!current.excludedProductForms.length && excludedProductForms.length) {
    inheritedConstraintKeys.push("excludedProductForms");
  }
  let maxPrice = current.maxPrice;
  if (maxPrice == null) {
    maxPrice = previous.find((constraints) => constraints.maxPrice != null)?.maxPrice;
    if (maxPrice != null) inheritedConstraintKeys.push("maxPrice");
  }
  let excludeRefills = current.excludeRefills;
  if (!excludeRefills && previous.some((constraints) => constraints.excludeRefills)) {
    excludeRefills = true;
    inheritedConstraintKeys.push("excludeRefills");
  }
  return {
    constraints: {
      collections: inheritArray("collections"),
      excludedCollections: inheritArray("excludedCollections"),
      coreFamilies: inheritArray("coreFamilies"),
      excludeRefills,
      excludedProductForms,
      maxPrice,
      productForms: inheritArray("productForms"),
      sizes: inheritArray("sizes"),
      variantTags: inheritArray("variantTags"),
    },
    inheritedConstraintKeys,
  };
}

function relationRule(query: string) {
  return RELATION_RULES.find((rule) => rule.pattern.test(query));
}

function extractRecommendationLimit(query: string) {
  const digitMatch = query.match(/([2-5])\s*款/);
  if (digitMatch) return Number(digitMatch[1]);
  const chinese = query.match(/([两二三四五])款/)?.[1];
  return chinese ? { 两: 2, 二: 2, 三: 3, 四: 4, 五: 5 }[chinese] : undefined;
}

function extractSoftPreferences(query: string) {
  const preferences = [
    ...["\u6728\u8d28", "\u5976\u9999", "\u767d\u82b1", "\u6e05\u65b0", "\u6e05\u51b7", "\u67d4\u548c", "\u81ea\u7136", "\u4e0d\u751c", "\u5fae\u751c", "\u5c0f\u4f17", "\u4e0d\u5bb9\u6613\u649e\u9999", "\u6c34\u6c7d", "\u901a\u900f", "\u8f7b\u76c8"]
      .filter((term) => query.includes(term)),
    ...["\u590f\u5929", "\u79cb\u51ac", "\u901a\u52e4", "\u5367\u5ba4", "\u7761\u524d", "\u7ea6\u4f1a", "\u9ad8\u7ea7\u9152\u5e97", "\u96e8\u540e\u82b1\u56ed", "\u68ee\u6797", "\u6d77\u8fb9"]
      .filter((term) => query.includes(term)),
  ];
  if (/\u6e05\u723d/.test(query)) preferences.push("\u6e05\u65b0");
  if (/\u67d1\u6a58\u76ae|\u6a58\u76ae|\u67d1\u6a58/.test(query)) preferences.push("\u67d1\u6a58");
  if (/\u4e0d[^\u3002\uff01\uff1f]{0,5}\u6d3b\u6cfc|\u514b\u5236|\u6c89\u9759/.test(query)) preferences.push("\u514b\u5236");
  if (/\u4e0d[^\u3002\uff01\uff1f]{0,4}\u751c/.test(query)) preferences.push("\u4e0d\u751c");
  if (/(?:\u4e0d\u60f3|\u4e0d\u8981|\u4e0d\u559c\u6b22)[^\u3002\uff01\uff1f]{0,12}(?:\u751c\u70b9|\u751c\u98df|\u751c\u5473)/.test(query)) preferences.push("\u4e0d\u751c");
  return unique(preferences);
}

const FOLLOW_UP_PATTERN = /\u8fd8\u6709|\u66f4\u591a|\u5176\u4ed6|\u522b\u7684|\u518d(?:\u63a8\u8350|\u6765|\u7ed9|\u770b\u770b)|\u5c31\u53ea\u6709|\u6362(?:\u4e00|\u51e0|\u4e9b)|\u90a3(?:\u6b3e|\u4e9b)|\u5b83\u4eec/;

function populatedConstraintKeys(constraints: DiptyqueQueryConstraints) {
  return (Object.keys(constraints) as Array<keyof DiptyqueQueryConstraints>).filter((key) => {
    const value = constraints[key];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "boolean") return value;
    return value != null;
  });
}

function previouslyPresentedProductIds(history: QueryHistoryMessage[]) {
  const assistantText = history
    .filter((message) => message.role === "assistant")
    .slice(-3)
    .map((message) => message.content)
    .join("\n");
  if (!assistantText) return [];
  return payload.products
    .filter((product) => product.name.length >= 2 && assistantText.includes(product.name))
    .map((product) => product.id);
}

export function buildDiptyqueQueryPlan(
  currentQuery: string,
  history: QueryHistoryMessage[] = []
): DiptyqueQueryPlan {
  const relation = relationRule(currentQuery);
  const extractedConstraints = extractConstraints(currentQuery);
  const currentConstraints = relation?.intent === "accessory"
    ? {
        ...extractedConstraints,
        coreFamilies: [],
        productForms: productForms.filter((form) => form === "\u70db\u76d6\u548c\u706d\u70db\u7f69"),
      }
    : extractedConstraints;
  const previousUserQuery = history
    .filter((message) => message.role === "user")
    .slice(-1)[0]?.content ?? "";
  const isShortContextualFollowUp = Boolean(
    previousUserQuery
    && currentQuery.length <= 18
    && /推荐|适合|送|预算|便宜|贵|哪款|怎么选/.test(currentQuery)
  );
  const isFollowUp = FOLLOW_UP_PATTERN.test(currentQuery)
    || REFERENTIAL_PATTERN.test(currentQuery)
    || isShortContextualFollowUp;
  const merged = mergeWithHistory(currentConstraints, isFollowUp ? history : []);
  const petSafety = PET_PATTERN.test(currentQuery) && SAFETY_PATTERN.test(currentQuery);
  const gifting = isGiftRecommendationQuery(currentQuery) || GIFT_FALLBACK_PATTERN.test(currentQuery);
  const comparison = COMPARISON_PATTERN.test(currentQuery);
  const preference = PREFERENCE_PATTERN.test(currentQuery) || /\u9009\u62e9|\u60f3\u8ba9/.test(currentQuery);
  const catalog = CATALOG_PATTERN.test(currentQuery);
  const preliminaryIntent: DiptyqueQueryIntent = petSafety
    ? "safety"
    : gifting
      ? "gifting"
      : comparison
        ? "comparison"
        : relation
          ? "relation"
          : preference
            ? "recommendation"
            : catalog
              ? "catalog"
              : "fact";

  const preferenceSeedCollections = /\u559c\u6b22.*\u4f46.*(?:\u60f3\u627e|\u627e\u4e00\u6b3e)/.test(normalize(currentQuery))
    ? mentionedValues(currentQuery, collections)
    : [];
  const currentSoftPreferences = unique([
    ...extractSoftPreferences(currentQuery),
    ...preferenceSeedCollections,
  ]);
  const inheritedSoftPreferences = history
    .filter((message) => message.role === "user")
    .slice(-3)
    .reverse()
    .map((message) => extractSoftPreferences(message.content))
    .find((values) => values.length) ?? [];
  const previousWasRecommendation = Boolean(
    previousUserQuery
    && (PREFERENCE_PATTERN.test(previousUserQuery)
      || /\u9009\u62e9|\u60f3\u8ba9/.test(previousUserQuery)
      || isGiftRecommendationQuery(previousUserQuery))
  );
  const effectiveIntent = preliminaryIntent === "fact"
    && ((isFollowUp && previousWasRecommendation) || inheritedSoftPreferences.length)
    ? "recommendation"
    : preliminaryIntent;
  const finalConstraints = {
    ...merged.constraints,
    excludeRefills:
      merged.constraints.excludeRefills
      || ((effectiveIntent === "recommendation" || effectiveIntent === "gifting")
        && !/\u8865\u5145\u88c5|\u8865\u5145\u74f6/.test(currentQuery)),
  };
  const hardConstraintKeys = Array.from(new Set([
    ...populatedConstraintKeys(currentConstraints),
    ...merged.inheritedConstraintKeys,
  ]));
  const contextualQuery = isFollowUp && previousUserQuery
    ? previousUserQuery + "\n" + currentQuery
    : currentQuery;
  const allowDeterministicCatalog = false;

  return {
    allowDeterministicCatalog,
    conversationState: {
      contextualQuery,
      hardConstraintKeys,
      isFollowUp,
      previousUserQuery,
      previouslyPresentedProductIds: isFollowUp ? previouslyPresentedProductIds(history) : [],
    },
    constraints: finalConstraints,
    currentQuery,
    inheritedConstraintKeys: merged.inheritedConstraintKeys,
    intent: effectiveIntent,
    relationIntent: relation?.intent,
    relationTypes: relation?.relationTypes ?? [],
    recommendationLimit: extractRecommendationLimit(currentQuery),
    requiresEvidence: effectiveIntent === "comparison" || effectiveIntent === "relation" || effectiveIntent === "safety" || EVIDENCE_PATTERN.test(currentQuery),
    safety: {
      blockProductRecommendation: petSafety,
      reason: petSafety ? "\u5f53\u524d\u5546\u54c1\u8d44\u6599\u6ca1\u6709\u5ba0\u7269\u5b89\u5168\u8ba4\u8bc1\u6216\u5b98\u65b9\u8bf4\u660e" : "",
      topic: petSafety ? "pet_safety" : "none",
    },
    softPreferences: currentSoftPreferences.length ? currentSoftPreferences : inheritedSoftPreferences,
  };
}

export function safetyGuardAnswer(plan: DiptyqueQueryPlan) {
  if (!plan.safety.blockProductRecommendation) return "";
  return "现有官方商品资料没有提供对宠物安全的认证或说明，因此我无法确认或推荐具体商品。气味柔和也不能作为宠物安全的证据。建议先向 Diptyque 官方核对完整成分，并咨询兽医后再决定。";
}
