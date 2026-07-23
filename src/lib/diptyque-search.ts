import frontendData from "@/data/diptyque-frontend-data.json";

type FrontendSku = {
  price: number | null;
  size: string;
  sku: string;
  stock: number | null;
};

type FrontendProduct = {
  id: string;
  collections: string[];
  coreFamily: string;
  description: string;
  identityName: string;
  marketingTags: string[];
  materials: string[];
  noteFamilies: string[];
  notes: string[];
  name: string;
  priceMax: number | null;
  priceMin: number | null;
  productForm: string;
  scentAccords: string[];
  scentConcepts: string[];
  scentProfiles: string[];
  skuCount: number;
  skus: FrontendSku[];
  sizes: string[];
  storyText: string;
  subtitle: string;
  typeDerived: string;
  variantTags: string[];
};

type FrontendGraphEdge = {
  confidence: string;
  edgeType: string;
  evidenceText: string;
  relationLayer: string;
  reviewStatus: string;
  scenario: string;
  source: string;
  sourceName: string;
  sourceType: string;
  target: string;
  targetName: string;
  targetType: string;
};
type FrontendRecommendationRule = {
  confidence: string;
  evidenceText: string;
  relationType: string;
  reviewStatus: string;
  sourceProductId: string;
  targetCollection: string;
  targetCoreFamily: string;
  targetProductForms: string[];
};
type FrontendPayload = {
  graph: {
    edges: FrontendGraphEdge[];
  };
  products: FrontendProduct[];
  recommendationRules: FrontendRecommendationRule[];
};

const payload = frontendData as FrontendPayload;
const products = payload.products;
const productById = new Map(products.map((product) => [product.id, product]));
const approvedDirectProductRelations = payload.graph.edges.filter(
  (edge) => edge.sourceType === "Product" && edge.targetType === "Product" && edge.reviewStatus === "approved"
);
const approvedRuleDerivedRelations = payload.recommendationRules
  .filter((rule) => rule.reviewStatus === "approved")
  .flatMap((rule) => {
    const source = productById.get(rule.sourceProductId);
    if (!source) return [];
    return products
      .filter(
        (target) =>
          target.id !== source.id &&
          !target.variantTags.includes("补充装") &&
          target.coreFamily === rule.targetCoreFamily &&
          target.collections.includes(rule.targetCollection) &&
          rule.targetProductForms.includes(target.productForm)
      )
      .map<FrontendGraphEdge>((target) => ({
        confidence: rule.confidence,
        edgeType: rule.relationType,
        evidenceText: rule.evidenceText,
        relationLayer: "recommendation_rule",
        reviewStatus: "derived_from_approved_rule",
        scenario: "同系列香气护理仪式",
        source: source.id,
        sourceName: source.name,
        sourceType: "Product",
        target: target.id,
        targetName: target.name,
        targetType: "Product",
      }));
  });
const approvedProductRelations = [
  ...approvedDirectProductRelations,
  ...approvedRuleDerivedRelations,
];
const GENERIC_NOTE_TOKENS = new Set([
  "花香调",
  "木质香调",
  "果香调",
  "辛香调",
  "草本香调",
  "海洋香调",
  "荔枝香调",
]);

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[·\-—_|/]/g, "");
}

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function subtitleNotes(product: FrontendProduct) {
  return uniq(
    (product.subtitle || "")
      .split(/[、,，/|]/)
      .map((part) => part.trim())
      .filter((part) => part && !GENERIC_NOTE_TOKENS.has(part))
  );
}

function productTerms(product: FrontendProduct) {
  return uniq([
    product.name,
    product.identityName,
    product.coreFamily,
    product.productForm,
    ...product.collections,
    ...product.marketingTags,
    ...product.variantTags,
    ...product.sizes,
    ...product.materials,
    ...product.notes,
    ...product.scentProfiles,
    ...product.scentAccords,
    ...product.scentConcepts,
    ...product.noteFamilies,
    ...subtitleNotes(product),
  ]);
}

function scoreProduct(product: FrontendProduct, query: string) {
  const normalizedQuery = normalizeText(query);
  let score = 0;

  for (const term of productTerms(product)) {
    const normalizedTerm = normalizeText(term);
    if (!normalizedTerm) continue;
    if (normalizedQuery === normalizedTerm) {
      score += 10;
      continue;
    }
    if (normalizedQuery.includes(normalizedTerm) || normalizedTerm.includes(normalizedQuery)) {
      score += term === product.name || term === product.identityName ? 8 : 4;
    }
  }

  if ((query.includes("送礼") || query.includes("礼赠") || query.includes("礼物")) && product.marketingTags.includes("臻选礼赠")) {
    score += 7;
  }
  if ((query.includes("精选") || query.includes("人气") || query.includes("热门")) && product.marketingTags.includes("人气精选")) {
    score += 6;
  }
  if ((query.includes("当季") || query.includes("季节")) && product.marketingTags.includes("当季精选")) {
    score += 6;
  }
  if ((query.includes("补充") || query.includes("refill")) && product.variantTags.includes("补充装")) {
    score += 6;
  }
  if ((query.includes("价格") || query.includes("多少钱")) && (product.priceMin != null || product.priceMax != null)) {
    score += 1.5;
  }

  return score;
}

function sortProducts(query: string) {
  return products
    .map((product) => ({ product, score: scoreProduct(product, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => (b.score - a.score) || a.product.name.localeCompare(b.product.name, "zh-CN"))
    .slice(0, 12);
}

function extractScentListTerm(query: string) {
  if (!/(?:产品|商品|香水).*(?:哪些|有什么|有哪|包括)|(?:哪些|有什么|有哪).*(?:产品|商品|香水)/.test(query)) {
    return "";
  }
  const match = query.match(/([\u4e00-\u9fffA-Za-z0-9]{1,16}?)(味|香调)(?:的)?(?:产品|商品|香水)/);
  if (!match) return "";
  const term = match[1].replace(/^(?:请问|我想找|我喜欢|想找|想要|有哪些|哪些|有什么|有哪|有)/, "");
  if (/^(?:什么|哪些|哪种|所有)$/.test(term)) return "";
  return match[2] === "香调" && /^(?:花|果|辛)$/.test(term) ? `${term}香` : term;
}

const SCENT_FAMILY_CANONICAL: Record<string, string> = {
  花香调: "花香",
  木质香调: "木质",
  果香调: "果香",
  辛香调: "辛香",
  草本香调: "草本",
  海洋香调: "海洋",
};

function normalizeScentTerm(term: string) {
  const trimmed = term.trim();
  return normalizeText(SCENT_FAMILY_CANONICAL[trimmed] ?? trimmed.replace(/香调$/, ""));
}
function normalizedScentTerms(product: FrontendProduct) {
  return uniq([
    ...product.collections,
    ...product.notes,
    ...product.scentProfiles,
    ...product.scentAccords,
    ...product.scentConcepts,
    ...product.noteFamilies,
  ]).map(normalizeScentTerm);
}

function scentCatalogProducts(term: string) {
  const normalizedTerm = normalizeScentTerm(term);
  const seenNames = new Set<string>();
  return products
    .filter((product) =>
      normalizedScentTerms(product).includes(normalizedTerm)
    )
    .sort(
      (a, b) =>
        a.coreFamily.localeCompare(b.coreFamily, "zh-CN") ||
        a.productForm.localeCompare(b.productForm, "zh-CN") ||
        a.name.localeCompare(b.name, "zh-CN")
    )
    .filter((product) => {
      if (seenNames.has(product.name)) return false;
      seenNames.add(product.name);
      return true;
    });
}

function isGiftRecommendationQuery(query: string) {
  return /送礼|礼物|礼品|男朋友|女朋友|男友|女友|伴侣|生日|纪念日/.test(query);
}

function giftRecommendationProducts() {
  const preferredForms = new Set(["淡香水", "淡香精", "香膏", "淡香水礼盒", "礼盒"]);
  return products
    .filter(
      (product) =>
        product.coreFamily === "个人香氛" &&
        !product.variantTags.includes("补充装") &&
        preferredForms.has(product.productForm)
    )
    .sort(
      (a, b) =>
        Number(b.marketingTags.includes("臻选礼赠")) - Number(a.marketingTags.includes("臻选礼赠")) ||
        a.productForm.localeCompare(b.productForm, "zh-CN") ||
        a.name.localeCompare(b.name, "zh-CN")
    );
}
function productPrice(product: FrontendProduct) {
  if (product.priceMin == null && product.priceMax == null) return "price unavailable";
  if (product.priceMin != null && product.priceMax != null && product.priceMin !== product.priceMax) {
    return `￥${product.priceMin}-${product.priceMax}`;
  }
  return `￥${product.priceMin ?? product.priceMax}`;
}

function productSummary(product: FrontendProduct) {
  return [
    `Product: ${product.name}`,
    `Core family: ${product.coreFamily || "unknown"}`,
    `Product form: ${product.productForm || "unknown"}`,
    `Collection or scent: ${product.collections.join(" / ") || "none"}`,
    `Marketing tags: ${product.marketingTags.join(" / ") || "none"}`,
    `Variant tags: ${product.variantTags.join(" / ") || "none"}`,
    `Material or craft: ${product.materials.join(" / ") || "none"}`,
    `Note ingredients: ${product.notes.join(" / ") || "none"}`,
    `Scent profiles: ${product.scentProfiles.join(" / ") || "none"}`,
    `Scent accords: ${product.scentAccords.join(" / ") || "none"}`,
    `Scent concepts: ${product.scentConcepts.join(" / ") || "none"}`,
    `Note families: ${product.noteFamilies.join(" / ") || "none"}`,
    `Subtitle notes: ${subtitleNotes(product).join(" / ") || "none"}`,
    `Sizes: ${product.sizes.join(" / ") || "none"}`,
    `Price: ${productPrice(product)}`,
    product.subtitle ? `Subtitle: ${product.subtitle}` : "",
    product.description ? `Description: ${product.description}` : "",
    product.storyText ? `Story: ${product.storyText.slice(0, 220)}` : "",
  ].filter(Boolean).join("\n");
}

const RELATION_LABELS: Record<string, string> = {
  ACCESSORY_FOR: "适配",
  CONTAINS: "包含",
  EXTENDS_TO_HOME: "家居延展",
  GIFT_WITH: "礼赠组合",
  LAYER_WITH: "层叠搭配",
  PAIRS_WITH: "搭配",
  PART_OF_SET: "属于套装",
  REFILL_FOR: "补充",
  SCENT_RITUAL_WITH: "香气延续",
};

function relationSummary(edge: FrontendGraphEdge) {
  return [
    `${edge.sourceName} --[${RELATION_LABELS[edge.edgeType] || edge.edgeType}]--> ${edge.targetName}`,
    `Layer: ${edge.relationLayer}`,
    `Scenario: ${edge.scenario || "none"}`,
    `Confidence: ${edge.confidence || "unknown"}`,
    `Evidence: ${edge.evidenceText || "none"}`,
  ].join("\n");
}

function formatCompleteCatalogAnswer(term: string, matchedProducts: FrontendProduct[]) {
  const grouped = new Map<string, Map<string, FrontendProduct[]>>();
  matchedProducts.forEach((product) => {
    const family = grouped.get(product.coreFamily) ?? new Map<string, FrontendProduct[]>();
    const form = family.get(product.productForm) ?? [];
    form.push(product);
    family.set(product.productForm, form);
    grouped.set(product.coreFamily, family);
  });
  const lines = Array.from(grouped.entries()).flatMap(([familyName, forms]) => {
    const familyCount = Array.from(forms.values()).reduce((sum, formProducts) => sum + formProducts.length, 0);
    return [
      `${familyName}（${familyCount}款）`,
      ...Array.from(forms.entries()).map(
        ([formName, formProducts]) =>
          `- ${formName}（${formProducts.length}款）：${formProducts.map((product) => product.name).join("、")}`
      ),
    ];
  });
  return `${term}相关产品共${matchedProducts.length}款，按商品家族和品型完整列出：\n${lines.join("\n")}`;
}
export function buildDiptyqueContext(query: string) {
  const scentListTerm = extractScentListTerm(query);
  const answerMode = scentListTerm
    ? "ontology_catalog_list"
    : isGiftRecommendationQuery(query)
      ? "gift_recommendation"
      : "knowledge_search";
  const matchedProducts = scentListTerm
    ? scentCatalogProducts(scentListTerm)
    : answerMode === "gift_recommendation"
      ? giftRecommendationProducts()
      : sortProducts(query).map((item) => item.product);
  const primaryProductIds = new Set(matchedProducts.slice(0, 3).map((product) => product.id));
  const matchedRelations = approvedProductRelations.filter(
    (edge) => primaryProductIds.has(edge.source) || primaryProductIds.has(edge.target)
  );
  const productContext = matchedProducts.length
    ? matchedProducts.map((product, index) => `Candidate product ${index + 1}\n${productSummary(product)}`).join("\n\n")
    : "No explicit product match was found. Answer conservatively and suggest asking about series, product forms, gifting tags, refill products, prices, or specific scent notes.";
  const relationContext = matchedRelations.length
    ? matchedRelations.map((edge, index) => `Approved relation ${index + 1}\n${relationSummary(edge)}`).join("\n\n")
    : "No approved direct product relation was found for the primary matched products.";
  const contextText = [
    `RETRIEVAL MODE: ${answerMode}`,
    `RETRIEVED PRODUCT COUNT: ${matchedProducts.length}`,
    "PRODUCT FACTS AND RETRIEVAL CANDIDATES",
    productContext,
    "APPROVED DIRECT PRODUCT RELATIONS",
    relationContext,
  ].join("\n\n");

  return {
    answerMode,
    deterministicAnswer:
      answerMode === "ontology_catalog_list"
        ? formatCompleteCatalogAnswer(scentListTerm, matchedProducts)
        : "",
    matchedProducts,
    contextText,
  };
}