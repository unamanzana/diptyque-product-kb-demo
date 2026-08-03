import schemaV1Candidate from "../../data-pipeline/diptyque_frontend_schema_v1_candidate.json" with { type: "json" };
import productionData from "../data/diptyque-frontend-data.json" with { type: "json" };
import type { DiptyqueQueryPlan } from "./diptyque-query-plan.ts";

const frontendData = process.env.NEXT_PUBLIC_DIPTYQUE_SCHEMA_V1 === "true"
  ? schemaV1Candidate
  : productionData;

type Product = {
  id: string;
  name: string;
  coreFamily: string;
  productForm: string;
  collections: string[];
  notes: string[];
  scentProfiles: string[];
  scentAccords: string[];
  materials: string[];
  variantTags: string[];
  subtitle: string;
  description: string;
  storyText: string;
  url: string;
};

type CopyField = "description" | "storyText" | "subtitle";

export type OfficialCopyHit = {
  chunkId: string;
  productId: string;
  productName: string;
  sourceField: CopyField;
  sourceLabel: string;
  sourceUrl: string;
  excerpt: string;
  score: number;
  matchedTerms: string[];
};

type Payload = { products: Product[] };

const products = (frontendData as Payload).products;
const productById = new Map(products.map((product) => [product.id, product]));

const FIELD_LABELS: Record<CopyField, string> = {
  description: "官网商品描述",
  storyText: "官网灵感故事",
  subtitle: "官网香气摘要",
};

// These terms only broaden retrieval. They never become evidence by themselves.
const QUERY_EXPANSIONS: Array<[RegExp, string[]]> = [
  [/白花/, ["晚香玉", "茉莉", "橙花", "栀子", "依兰"]],
  [/雨后|花园/, ["绿叶", "青草", "玫瑰", "水汽", "露珠", "湿润", "花园"]],
  [/森林|林间/, ["雪松", "檀香", "木质", "苔藓", "松针", "树脂"]],
  [/海边|海洋|海风/, ["海洋", "海盐", "水汽", "清新", "海岸", "浪花"]],
  [/干净|洁净/, ["白麝香", "皂感", "清新", "轻盈", "纯净"]],
  [/自然/, ["绿叶", "木质", "花香", "草本", "植物"]],
  [/柔和|不浓|不太浓|没有攻击性/, ["柔和", "轻盈", "细腻", "淡雅", "温和"]],
  [/清冷|冷感/, ["清新", "水汽", "矿物", "青绿", "冷冽"]],
  [/木质/, ["雪松", "檀香", "广藿香", "香根草", "木质"]],
  [/不甜/, ["青绿", "木质", "草本", "柑橘", "清新"]],
  [/夏天|夏日/, ["清新", "柑橘", "水汽", "青绿", "轻盈"]],
  [/秋冬/, ["木质", "辛香", "琥珀", "温暖", "香脂"]],
  [/睡前|放松/, ["柔和", "舒缓", "宁静", "温暖"]],
  [/高级酒店/, ["木质", "洁净", "香氛仪式", "空间", "氛围"]],
  [/\u67d1\u6a58\u76ae|\u67d1\u6a58|\u6a58\u76ae/, ["\u67da\u5b50", "\u9752\u67d1", "\u6a59\u76ae", "\u67e0\u6aac", "\u4f5b\u624b\u67d1", "\u6e05\u65b0"]],
  [/\u514b\u5236|\u4e0d[^\u3002\uff01\uff1f]{0,5}\u6d3b\u6cfc/, ["\u5185\u655b", "\u6c89\u9759", "\u5b81\u9759", "\u67d4\u548c", "\u7ec6\u817b"]],
];

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[，。！？、；：,.!?;:'"“”‘’()（）/|\-—]/g, "");
}

function splitSentences(value: string) {
  return unique(
    value
      .replace(/\r/g, "")
      .split(/(?<=[。！？!?])|\n+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 4)
  );
}

function ngrams(value: string) {
  const normalized = normalize(value);
  const terms: string[] = [];
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= normalized.length - size; index += 1) {
      terms.push(normalized.slice(index, index + size));
    }
  }
  return terms;
}

function queryTerms(query: string, plan: DiptyqueQueryPlan) {
  const expanded = QUERY_EXPANSIONS.flatMap(([pattern, terms]) => pattern.test(query) ? terms : []);
  const semanticQuery = query
    .replace(/\u4e0d[^\u3002\uff01\uff1f]{0,5}\u6d3b\u6cfc/g, "\u514b\u5236")
    .replace(
      /diptyque|\u6211|\u5e73\u65f6|\u559c\u6b22|\u4e0d\u559c\u6b22|\u60f3\u8981|\u60f3\u627e|\u6709\u6ca1\u6709|\u95fb\u8d77\u6765|\u6bd4\u8f83|\u54ea\u4e9b|\u54ea\u51e0\u6b3e|\u51e0\u6b3e|\u63a8\u8350|\u9002\u5408|\u9009\u62e9|\u4e0d\u8981|\u53ea\u7ed9|\u4ea7\u54c1|\u9999\u5473|\u6216\u8005/gi,
      ""
    );
  const ontologyTerms = [
    ...plan.constraints.collections,
    ...plan.softPreferences,
  ];
  return unique([
    ...ontologyTerms,
    ...expanded,
    ...ngrams(semanticQuery).filter((term) => term.length >= 2),
  ]).map(normalize).filter((term) => term.length >= 2);
}

const chunks = products.flatMap((product) =>
  (["subtitle", "description", "storyText"] as CopyField[]).flatMap((sourceField) =>
    splitSentences(product[sourceField] || "").map((excerpt, index) => ({
      chunkId: `${product.id}:${sourceField}:${index + 1}`,
      excerpt,
      normalizedExcerpt: normalize(excerpt),
      productId: product.id,
      productName: product.name,
      sourceField,
      sourceLabel: FIELD_LABELS[sourceField],
      sourceUrl: product.url,
    }))
  )
);

export function retrieveOfficialCopy(
  query: string,
  plan: DiptyqueQueryPlan,
  candidateProductIds: string[] = [],
  limit = 10,
  strictCandidateGate = false,
  excludedProductIds: string[] = []
) {
  const terms = queryTerms(query, plan);
  const candidateSet = new Set(candidateProductIds);
  const excludedProductSet = new Set(excludedProductIds);
  const useCandidateGate = strictCandidateGate || candidateSet.size > 0;
  const scored = chunks.flatMap((chunk) => {
    if (useCandidateGate && !candidateSet.has(chunk.productId)) return [];
    if (excludedProductSet.has(chunk.productId)) return [];
    const product = productById.get(chunk.productId);
    if (!product) return [];
    if (plan.constraints.excludeRefills && product.variantTags.includes("\u8865\u5145\u88c5")) return [];
    const matchedTerms = unique(terms.filter((term) => chunk.normalizedExcerpt.includes(term)));
    const exactQuery = normalize(query);
    const exactBonus = exactQuery.length >= 4 && chunk.normalizedExcerpt.includes(exactQuery) ? 12 : 0;
    const fieldWeight = chunk.sourceField === "storyText" ? 1.25 : chunk.sourceField === "description" ? 1.1 : 1;
    const ontologyText = normalize([
      product.name,
      product.coreFamily,
      product.productForm,
      ...product.collections,
      ...product.notes,
      ...product.scentProfiles,
      ...product.scentAccords,
      ...product.materials,
    ].join(" "));
    const ontologyMatches = unique(terms.filter((term) => ontologyText.includes(term)));
    if (!matchedTerms.length) return [];
    const score = exactBonus
      + matchedTerms.reduce((sum, term) => sum + Math.min(6, term.length) * fieldWeight, 0)
      + ontologyMatches.reduce((sum, term) => sum + Math.min(4, term.length) * 0.8, 0);
    if (score <= 0) return [];
    return [{ ...chunk, score: Math.round(score * 100) / 100, matchedTerms: unique([...matchedTerms, ...ontologyMatches]) }];
  });

  const perProduct = new Map<string, number>();
  const ranked = scored
    .sort((left, right) => right.score - left.score || left.productName.localeCompare(right.productName, "zh-CN"))
    .filter((hit) => {
      const count = perProduct.get(hit.productId) ?? 0;
      if (count >= 2) return false;
      perProduct.set(hit.productId, count + 1);
      return true;
    }) as OfficialCopyHit[];
  const requiredCollectionHits = plan.intent === "comparison"
    ? plan.constraints.collections.flatMap((collection) => {
        const hit = ranked.find((candidate) => productById.get(candidate.productId)?.collections.includes(collection));
        return hit ? [hit] : [];
      })
    : [];
  const seenChunks = new Set<string>();
  return [...requiredCollectionHits, ...ranked]
    .filter((hit) => {
      if (seenChunks.has(hit.chunkId)) return false;
      seenChunks.add(hit.chunkId);
      return true;
    })
    .slice(0, limit);
}

export function formatOfficialCopyContext(hits: OfficialCopyHit[]) {
  if (!hits.length) return "No matching official-copy evidence was found.";
  return hits.map((hit, index) => [
    `Official evidence ${index + 1}`,
    `Product ID: ${hit.productId}`,
    `Product: ${hit.productName}`,
    `Source field: ${hit.sourceLabel} (${hit.sourceField})`,
    `Source URL: ${hit.sourceUrl}`,
    `Exact excerpt: ${hit.excerpt}`,
    `Retrieval score: ${hit.score}`,
  ].join("\n")).join("\n\n");
}

export function officialCopyFallback(hits: OfficialCopyHit[], plan: DiptyqueQueryPlan) {
  if (!hits.length || !["recommendation", "comparison", "gifting"].includes(plan.intent)) return null;
  const limit = plan.recommendationLimit ?? 5;
  const seenProducts = new Set<string>();
  const seenScentGroups = new Set<string>();
  const selectedHits = hits.filter((hit) => {
    if (seenProducts.has(hit.productId)) return false;
    seenProducts.add(hit.productId);
    const product = productById.get(hit.productId);
    const scentGroup = product?.collections[0] || hit.productId;
    if (seenScentGroups.has(scentGroup)) return false;
    seenScentGroups.add(scentGroup);
    return true;
  }).slice(0, limit);
  if (!selectedHits.length || (plan.intent === "gifting" && selectedHits.length < 3)) return null;
  const reasons = selectedHits.map((hit) => `${hit.productName}：官网文案提到“${hit.excerpt.slice(0, 70)}${hit.excerpt.length > 70 ? "…" : ""}”`);
  const figComparison = plan.intent === "comparison"
    && plan.constraints.collections.includes("无花果")
    && plan.constraints.collections.includes("希腊无花果")
    ? "无花果家居香味和希腊无花果个人香氛是不同的香气身份与产品体系，不能因为都出现无花果就视为同一个系列。"
    : "";
  const comparisonScope = plan.intent === "comparison" && plan.constraints.collections.length > 1
    ? `本次分别核对了${plan.constraints.collections.join("、")}。`
    : "";
  return {
    answer: `\u6839\u636e\u5f53\u524d\u9700\u6c42\u548c\u5b98\u7f51\u6587\u6848\uff0c\u4f18\u5148\u5019\u9009\u5982\u4e0b\uff1a\n${reasons.join("\n")}\n${figComparison}${comparisonScope}\u8fd9\u4e9b\u63cf\u8ff0\u53ea\u80fd\u652f\u6301\u6587\u6848\u4e2d\u660e\u786e\u5199\u51fa\u7684\u6c14\u5473\u6216\u4f53\u9a8c\uff1b\u751c\u5ea6\u3001\u7559\u9999\u3001\u70ed\u95e8\u7a0b\u5ea6\u7b49\u672a\u88ab\u5b98\u65b9\u8d44\u6599\u660e\u786e\u91cf\u5316\u7684\u7ef4\u5ea6\uff0c\u6211\u4e0d\u4f1a\u5f53\u4f5c\u786e\u5b9a\u4e8b\u5b9e\u3002`,
    productIds: selectedHits.map((hit) => hit.productId),
  };
}

const UNSUPPORTED_CLAIM_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:最热门|销量最高|大家都|最受欢迎)/, label: "热度或销量" },
  { pattern: /(?:一定|保证).{0,8}(?:留香|持续|安全|不过敏)/, label: "绝对效果" },
  { pattern: /(?:适合男生|适合女生|男性专属|女性专属)/, label: "性别定向" },
  { pattern: /(?:宠物安全|对猫安全|对狗安全)/, label: "宠物安全" },
  { pattern: /(?:\u7559\u9999\u9884\u4f30|\u6301\u9999(?:\u65f6\u95f4)?(?:\u8f83\u957f|\u66f4\u4e45|\u66f4\u6301\u4e45)|\u660e\u663e\u66f4\u6301\u4e45|\u9002\u4e2d\u504f\u77ed|\u6325\u53d1\u8f83\u5feb)/, label: "unsupported longevity" },
  { pattern: /(?:\u52a9\u7720|\u6cbb\u6108)/, label: "sleep or therapeutic effect" },
  { pattern: /\u9002\u5408.{0,4}(?:\u7537\u751f|\u5973\u751f|\u7537\u6027|\u5973\u6027)/, label: "gender targeting" },
  { pattern: /(?:\u9152\u5e97|\u7cbe\u54c1\u5e97).{0,8}(?:\u5e38\u7528|\u9996\u9009|\u7231\u7528)/, label: "unsupported venue usage" },
  { pattern: /(?:\u96f6\u8e29\u96f7|\u4e0d\u51fa\u9519|\u6700\u4e0d\u5bb9\u6613\u51fa\u9519)/, label: "risk-free gifting" },
];

export function verifyAnswerClaims(answer: string, evidenceContext: string) {
  const unsupported = UNSUPPORTED_CLAIM_PATTERNS
    .filter(({ pattern }) => pattern.test(answer) && !pattern.test(evidenceContext))
    .map(({ label }) => label);
  return { passed: unsupported.length === 0, unsupported };
}
