import frontendData, { schemaV1PreviewEnabled } from "@/data/diptyque-frontend-payload";
import {
  extractProductCatalogScope,
  isGiftRecommendationQuery,
  type ProductCatalogScope,
} from "@/lib/diptyque-query-intent";

export type GraphLine = {
  dashed: boolean;
  edgeId: string;
  edgeType: string;
  label: string;
  sourceName: string;
  sourceId: string;
  targetName: string;
  targetId: string;
  relationLayer: string;
  evidenceType: string;
  evidenceText: string;
  evidenceUrl: string;
  confidence: string;
  reviewStatus: string;
  scenario: string;
  viaField: string;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
};

export type GraphNode = {
  anchor: "end" | "start";
  dx: number;
  dy: number;
  fill: string;
  id: string;
  label: string;
  nodeType: string;
  persistent: boolean;
  r: number;
  x: number;
  y: number;
};

export type ProductCard = {
  badges: string[];
  category: string;
  englishName: string;
  focusNodeLabel: string;
  focusPrompt?: string;
  image?: string;
  mode: string;
  url?: string;
  name: string;
  price: string;
  recommendation: string;
  specs: string;
  title: string;
  trace: {
    answerability: string;
    constraints: string;
    intent: string;
    matchedProduct: string;
    mode: string;
    quote: string;
    quoteLabel: string;
    scenario: string;
  };
};

export type KnowledgeMessage = {
  card?: ProductCard;
  cards?: ProductCard[];
  confidence?: string;
  id: string;
  note?: string;
  role: "bot" | "user";
  suggestions?: string[];
  text: string;
};

export type ResponseEntry = {
  answer: string;
  card?: ProductCard;
  cards?: ProductCard[];
  recommendationProductNames?: string[];
  confidence?: string;
  filterNodeIds?: string[];
  focusEdgeIds?: string[];
  focusNodeLabel?: string;
  keywords: string[];
  suggestions?: string[];
};

export type GraphDataset = {
  edgeLabels: string[];
  focusLabel?: string;
  lines: GraphLine[];
  modeLabel: string;
  nodes: GraphNode[];
  summaryText: string;
  viewBox: string;
};

export type FilterTrailItem = {
  id: string;
  label: string;
  nodeType: string;
};

type FrontendSku = {
  id: string;
  image: string;
  price: number | null;
  size: string;
  sku: string;
  stock: number | null;
  url: string;
};

type FrontendProduct = {
  categoryTokens: string[];
  collections: string[];
  coreFamily: string;
  description: string;
  id: string;
  identityName: string;
  image: string;
  marketingTags: string[];
  materials: string[];
  name: string;
  notes: string[];
  scentProfiles: string[];
  scentAccords: string[];
  scentConcepts: string[];
  scentIdentities?: Array<{
    aliases?: string[];
    id: string;
    name: string;
    scentIdentityType: string;
  }>;
  semanticFacts?: {
    functions: string[];
    scenes: string[];
    userNeeds: string[];
    careInstructions: string[];
    semanticMaterials: string[];
    craftTechniques: string[];
  };
  noteFamilies: string[];
  otherTokens: string[];
  priceMax: number | null;
  priceMin: number | null;
  productForm: string;
  skuCount: number;
  skus: FrontendSku[];
  sizes: string[];
  spu: string;
  stockTotal: number;
  storyText: string;
  subtitle: string;
  typeDerived: string;
  typeRaw: string;
  url: string;
  variantTags: string[];
};

type FrontendGraphNode = {
  coreFamily: string;
  displayLabel: string;
  id: string;
  name: string;
  nodeType: string;
  price: number | null;
  productForm: string;
  size: string;
  sku: string;
  spu: string;
  stock: number | null;
  typeDerived: string;
  typeRaw: string;
  url: string;
};

type FrontendGraphEdge = {
  edgeType: string;
  source: string;
  sourceName: string;
  sourceType: string;
  target: string;
  targetName: string;
  targetType: string;
  viaField: string;
  relationLayer: string;
  evidenceType: string;
  evidenceText: string;
  evidenceUrl: string;
  confidence: string;
  reviewStatus: string;
  scenario: string;
  displayLabel?: string;
};

type FrontendRecommendationRule = {
  ruleId: string;
  sourceProductId: string;
  sourceProductName: string;
  relationType: string;
  targetCollection: string;
  targetCoreFamily: string;
  targetProductForms: string[];
  evidenceType: string;
  evidenceField: string;
  evidenceText: string;
  evidenceUrl: string;
  confidence: string;
  reviewStatus: string;
  decisionReason: string;
  notes: string;
};

type FrontendPayload = {
  graph: {
    edges: FrontendGraphEdge[];
    nodes: FrontendGraphNode[];
  };
  products: FrontendProduct[];
  recommendationRules: FrontendRecommendationRule[];
};

type GraphInteractionResult = {
  nextFilterNodeIds: string[];
  nextFocusLabel: string | null;
  response: ResponseEntry;
};

const payload = frontendData as FrontendPayload;
const products = payload.products;
const graphNodes = payload.graph.nodes;
const graphEdges = payload.graph.edges;
const recommendationRules = payload.recommendationRules ?? [];
const approvedProductRelations = graphEdges.filter(
  (edge) =>
    edge.sourceType === "Product" &&
    edge.targetType === "Product" &&
    edge.reviewStatus === "approved"
);
const productById = new Map(products.map((product) => [product.id, product] as const));
const productBySku = new Map(
  products.flatMap((product) => product.skus.map((sku) => [sku.sku, product] as const))
);
const nodeById = new Map(graphNodes.map((node) => [node.id, node] as const));
const edgesBySource = new Map<string, FrontendGraphEdge[]>();
const edgesByTarget = new Map<string, FrontendGraphEdge[]>();

for (const edge of graphEdges) {
  const sourceBucket = edgesBySource.get(edge.source) ?? [];
  sourceBucket.push(edge);
  edgesBySource.set(edge.source, sourceBucket);

  const targetBucket = edgesByTarget.get(edge.target) ?? [];
  targetBucket.push(edge);
  edgesByTarget.set(edge.target, targetBucket);
}

const derivedCompatibilityEdges = buildDerivedCompatibilityEdges();
const derivedRecommendationEdges = buildDerivedRecommendationEdges();

const VIEWBOX_WIDTH = 640;
const VIEWBOX_HEIGHT = 596;
const VIEWBOX_CENTER_X = VIEWBOX_WIDTH / 2;
const VIEWBOX_CENTER_Y = VIEWBOX_HEIGHT / 2;
const hiddenEdgeTypes = new Set<string>();
const filterableNodeTypes = new Set([
  "CoreFamily",
  "ProductForm",
  "CollectionOrScent",
  "NoteIngredient",
  "ScentProfile",
  "ScentAccord",
  "ScentConcept",
  "ScentIdentity",
  "MarketingTag",
  "MaterialOrCraft",
  "Function",
  "UseScene",
  "UserNeed",
  "CareInstruction",
  "UsageInstruction",
  "Material",
  "CraftTechnique",
  "VariantTag",
]);

const edgeLabelMap: Record<string, string> = {
  BELONGS_TO_FAMILY: "归类",
  FAMILY_MAPS_TO_TYPE: "映射",
  FORM_UNDER_FAMILY: "品型",
  HAS_FAMILY: "大类",
  HAS_PRODUCT_FORM: "品型",
  HAS_PRODUCT: "商品",
  HAS_SKU: "SKU",
  HAS_MARKETING_TAG: "标签维度",
  HAS_MATERIAL: "材质",
  HAS_FUNCTION: "功能",
  HAS_SCENE: "场景",
  SERVES_NEED: "需求",
  HAS_CARE_INSTRUCTION: "保养",
  HAS_USAGE_INSTRUCTION: "使用",
  HAS_CRAFT: "工艺",
  HAS_NOTE: "香材",
  HAS_SCENT_PROFILE: "气味类型",
  HAS_SCENT_ACCORD: "复合香调",
  HAS_SCENT_CONCEPT: "具体香味",
  HAS_SCENT: "香气",
  HAS_SCENT_IDENTITY: "香气身份",
  HAS_SEMANTIC_CONCEPT: "包含",
  HAS_SCENT_EXPRESSION: "香味依据",
  HAS_NOTE_FAMILY: "香调家族",
  IN_COLLECTION: "系列维度",
  REFILL_FOR: "\u8865\u5145\u9002\u7528\u4e8e",
  ACCESSORY_FOR: "\u9002\u914d",
  HAS_COMPATIBILITY_SPEC: "\u5546\u54c1\u89c4\u683c",
  ACCESSORY_FOR_SPEC: "\u9002\u914d\u89c4\u683c",
  PART_OF_SET: "\u5c5e\u4e8e\u5957\u88c5",
  SHARES_NOTE: "\u5171\u4eab\u9999\u6750",
  SAME_COLLECTION: "\u540c\u7cfb\u5217",
  PAIRS_WITH: "\u642d\u914d",
  LAYER_WITH: "\u5c42\u53e0\u642d\u914d",
  EXTENDS_TO_HOME: "\u5ef6\u4f38\u81f3\u5bb6\u5c45",
  SCENT_RITUAL_WITH: "香气延续",
  GIFT_WITH: "\u7ec4\u5408\u8d60\u793c",
  ALTERNATIVE_TO: "\u53ef\u66ff\u4ee3",
};

const nodeColorMap: Record<string, string> = {
  CollectionOrScent: "#53645f",
  CompatibilitySpec: "#7b817d",
  CoreFamily: "#252422",
  MarketingTag: "#76706b",
  NoteIngredient: "#6f827d",
  ScentProfile: "#7e8b87",
  ScentAccord: "#667772",
  ScentConcept: "#48635c",
  ScentIdentity: "#315f55",
  NoteFamily: "#61746e",
  OntologyDomain: "#344b45",
  SemanticDomain: "#2f2e2b",
  MaterialOrCraft: "#817965",
  Function: "#b46a3c",
  UseScene: "#527792",
  UserNeed: "#9b5570",
  CareInstruction: "#74665b",
  UsageInstruction: "#74665b",
  Material: "#817965",
  CraftTechnique: "#655b71",
  Product: "#8f1531",
  ProductForm: "#55514d",
  SKU: "#c9c5bd",
  VariantTag: "#98908a",
};

function uniq<T>(values: T[]) {
  return Array.from(new Set(values));
}

const productCatalogVocabulary = {
  coreFamilies: uniq(products.map((product) => product.coreFamily).filter(Boolean)),
  productForms: uniq(products.map((product) => product.productForm).filter(Boolean)),
};

function uniqueProductsByName(items: FrontendProduct[]) {
  const seenNames = new Set<string>();
  return items.filter((product) => {
    if (seenNames.has(product.name)) return false;
    seenNames.add(product.name);
    return true;
  });
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[·\-—_|/]/g, "");
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  return counts;
}

function topKeys(counts: Map<string, number>, limit: number) {
  return Array.from(counts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, limit)
    .map(([key]) => key);
}

function sortProducts(items: FrontendProduct[]) {
  return [...items].sort((a, b) => {
    const priceA = a.priceMin ?? a.priceMax ?? Number.MAX_SAFE_INTEGER;
    const priceB = b.priceMin ?? b.priceMax ?? Number.MAX_SAFE_INTEGER;
    return (priceA - priceB) || a.name.localeCompare(b.name, "zh-CN");
  });
}

function formatPrice(product: FrontendProduct) {
  if (product.priceMin == null && product.priceMax == null) return "价格待补充";
  if (product.priceMin != null && product.priceMax != null && product.priceMin !== product.priceMax) {
    return `￥${product.priceMin} - ￥${product.priceMax}`;
  }
  return `￥${product.priceMin ?? product.priceMax}`;
}

function formatSkuPrice(node: FrontendGraphNode) {
  return node.price == null ? "价格待补充" : `￥${node.price}`;
}

function formatSkuStock(node: FrontendGraphNode) {
  if (node.stock == null) return "库存待补充";
  return node.stock > 0 ? `库存 ${node.stock}` : "当前库存 0";
}

function formatSpecs(product: FrontendProduct) {
  const bits = [
    product.sizes.length ? `规格: ${product.sizes.join(" / ")}` : "",
    product.skuCount ? `SKU: ${product.skuCount}` : "",
    product.stockTotal ? `库存合计: ${product.stockTotal}` : "",
  ].filter(Boolean);
  return bits.join(" · ");
}

function makeConstraints(product: FrontendProduct) {
  const bits = [
    product.coreFamily ? `大类: ${product.coreFamily}` : "",
    product.productForm ? `品型: ${product.productForm}` : "",
    product.collections[0] ? `系列: ${product.collections[0]}` : "",
    product.marketingTags[0] ? `标签: ${product.marketingTags[0]}` : "",
  ].filter(Boolean);
  return bits.join(" · ");
}

function makeQuote(product: FrontendProduct) {
  return product.subtitle || product.description || product.storyText || "当前以清洗后的大类、品型、系列、材质和标签信息为主。";
}

function makeScenario(product: FrontendProduct) {
  if (product.marketingTags.length) return `适配标签: ${product.marketingTags.join(" / ")}`;
  if (product.variantTags.length) return `版本信息: ${product.variantTags.join(" / ")}`;
  if (product.collections.length) return `系列线索: ${product.collections.join(" / ")}`;
  return `核心路径: ${[product.coreFamily, product.productForm].filter(Boolean).join(" / ")}`;
}

function makeRecommendation(product: FrontendProduct) {
  const options = [
    product.collections[0] ? `可继续追问 ${product.collections[0]} 系列的其他产品。` : "",
    product.variantTags.includes("补充装") ? "也可以继续筛补充装与正装的关系。" : "",
    product.marketingTags.includes("臻选礼赠") ? "也适合继续问送礼场景。" : "",
    product.coreFamily === "身体护理" ? "可继续追问护手、洁肤或润肤品型。" : "",
  ].filter(Boolean);
  return options[0] ?? "可继续追问同系列、同品型或同标签商品。";
}

function badgeList(product: FrontendProduct) {
  return uniq([
    product.coreFamily,
    product.productForm,
    ...product.collections,
    ...product.notes,
    ...product.scentProfiles,
    ...product.scentAccords,
    ...product.scentConcepts,
    ...product.marketingTags,
    ...product.variantTags,
  ]).filter(Boolean).slice(0, 5);
}

function makeConfidence(score: number) {
  const percent = Math.max(72, Math.min(95, 72 + Math.round(score * 3.5)));
  const band = percent >= 86 ? "🟢 high" : percent >= 78 ? "🟡 medium" : "🟠 low";
  return `${percent}% · ${band}`;
}

function productKeywords(product: FrontendProduct) {
  return uniq([
    product.name,
    product.identityName,
    product.coreFamily,
    product.productForm,
    ...product.collections,
    ...product.notes,
    ...product.scentProfiles,
    ...product.scentAccords,
    ...product.scentConcepts,
    ...product.marketingTags,
    ...product.variantTags,
    ...product.sizes,
  ]).filter(Boolean);
}

function buildFollowUps(product: FrontendProduct) {
  return uniq([
    product.collections[0] ? `${product.collections[0]} 还有哪些产品？` : "",
    product.productForm ? `${product.productForm} 里有哪些人气精选？` : "",
    "有没有适合送礼的产品？",
    "有哪些补充装？",
    `${product.name} 多少钱？`,
  ]).filter(Boolean).slice(0, 4);
}

function buildProductCard(
  product: FrontendProduct,
  intentLabel: string,
  score: number,
  options?: {
    focusPrompt?: string;
    focusTarget?: string;
  }
): ProductCard {
  return {
    badges: badgeList(product),
    category: [product.coreFamily, product.productForm].filter(Boolean).join(" / "),
    englishName: `SPU ${product.spu}`,
    focusNodeLabel: options?.focusTarget ?? product.id,
    focusPrompt: options?.focusPrompt ?? "图谱",
    image: product.image || undefined,
    mode: intentLabel,
    name: product.name,
    url: product.url || undefined,
    price: formatPrice(product),
    recommendation: makeRecommendation(product),
    specs: formatSpecs(product),
    title: `${product.name} 的图谱聚焦`,
    trace: {
      answerability: `回答力 ${Math.min(4.4, score / 3.2 + 2.1).toFixed(2)}`,
      constraints: makeConstraints(product),
      intent: intentLabel,
      matchedProduct: product.name,
      mode: "ontology_search",
      quote: makeQuote(product),
      quoteLabel: "知识证据",
      scenario: makeScenario(product),
    },
  };
}

export function getProductCardsByNames(productNames: string[], intentLabel = "商品检索") {
  const seen = new Set<string>();
  return productNames
    .map((name) => products.find((product) => product.name === name))
    .filter((product): product is FrontendProduct => {
      if (!product || seen.has(product.name)) return false;
      seen.add(product.name);
      return true;
    })
    .slice(0, 5)
    .map((product) => buildProductCard(product, intentLabel, 9, { focusPrompt: "单品图谱" }));
}

function isFilterableNodeType(nodeType: string) {
  return filterableNodeTypes.has(nodeType);
}

function getFilterTrail(nodeIds: string[]): FilterTrailItem[] {
  return nodeIds
    .map((id) => nodeById.get(id))
    .filter((node): node is FrontendGraphNode => Boolean(node))
    .map((node) => ({ id: node.id, label: node.displayLabel || node.name, nodeType: node.nodeType }));
}

export { getFilterTrail };

function trailText(nodeIds: string[]) {
  const grouped = new Map<string, string[]>();
  getFilterTrail(nodeIds).forEach((item) => {
    const labels = grouped.get(item.nodeType) ?? [];
    labels.push(item.label);
    grouped.set(item.nodeType, labels);
  });
  return Array.from(grouped.values()).map((labels) => labels.join(" / ")).join(" > ");
}

function matchHierarchyNodeIdByQuery(query: string) {
  const normalizedQuery = normalizeText(query);
  const hierarchyTypes = new Set(["OntologyDomain", "SemanticDomain", "NoteFamily"]);
  return Array.from(nodeById.values())
    .filter((node) => hierarchyTypes.has(node.nodeType))
    .map((node) => {
      const label = node.displayLabel || node.name;
      const normalizedLabel = normalizeText(label);
      let score = 0;
      if (normalizedQuery === normalizedLabel) score = 20;
      else if (normalizedQuery.includes(normalizedLabel)) score = Math.max(8, normalizedLabel.length);
      else if (normalizedLabel.includes(normalizedQuery) && normalizedQuery.length >= 2) score = 4;
      return score > 0 ? { id: node.id, score } : null;
    })
    .filter((item): item is { id: string; score: number } => item !== null)
    .sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id, "zh-CN"))[0]?.id;
}

const semanticCollisionTypes = new Set(["CollectionOrScent", "NoteIngredient", "ScentProfile", "ScentAccord", "ScentConcept", "ScentIdentity", "MaterialOrCraft", "Material"]);

function preferredFilterNodeTypes(query: string) {
  if (/含有|香材|成分/.test(query)) return new Set(["NoteIngredient"]);
  if (/(?:味|香调).*(?:产品|商品|香水)/.test(query)) {
    return new Set(schemaV1PreviewEnabled ? ["ScentIdentity"] : ["ScentConcept"]);
  }
  if (/气味类型|香调类型|调性/.test(query)) return new Set(["ScentProfile", "ScentAccord"]);
  if (/系列|香型/.test(query)) return new Set(["CollectionOrScent"]);
  if (/功能|用途/.test(query)) return new Set(["Function"]);
  if (/场景|什么时候|哪里使用/.test(query)) return new Set(["UseScene"]);
  if (/需求|适合做什么|用来做什么/.test(query)) return new Set(["UserNeed"]);
  if (/保养|养护|怎么护理/.test(query)) return new Set(["CareInstruction", "UsageInstruction"]);
  if (/材质/.test(query)) return new Set(["Material", "MaterialOrCraft"]);
  if (/工艺/.test(query)) return new Set(["CraftTechnique", "MaterialOrCraft"]);
  return null;
}

function semanticRoleLabel(nodeType: string) {
  switch (nodeType) {
    case "CollectionOrScent":
      return "系列/香型";
    case "ScentConcept":
      return "香味概念";
    case "ScentIdentity":
      return "香气身份";
    case "NoteIngredient":
      return "具体香材";
    case "ScentProfile":
      return "气味类型";
    case "ScentAccord":
      return "复合香调";
    case "Function":
      return "功能";
    case "UseScene":
      return "使用场景";
    case "UserNeed":
      return "需求";
    case "CareInstruction":
      return "保养说明";
    case "Material":
      return "材质";
    case "CraftTechnique":
      return "工艺";
    default:
      return nodeType;
  }
}

function findSemanticAmbiguity(query: string) {
  if (preferredFilterNodeTypes(query)) return null;
  const normalizedQuery = normalizeText(query);
  const grouped = new Map<string, FrontendGraphNode[]>();
  Array.from(nodeById.values())
    .filter((node) => semanticCollisionTypes.has(node.nodeType))
    .forEach((node) => {
      const normalizedLabel = normalizeText(node.displayLabel || node.name);
      if (normalizedLabel.length < 2 || !normalizedQuery.includes(normalizedLabel)) return;
      const bucket = grouped.get(normalizedLabel) ?? [];
      bucket.push(node);
      grouped.set(normalizedLabel, bucket);
    });

  return Array.from(grouped.entries())
    .filter(([, nodes]) => new Set(nodes.map((node) => node.nodeType)).size > 1)
    .sort((a, b) => b[0].length - a[0].length)[0] ?? null;
}

function matchFilterNodeIdsByQuery(query: string) {
  const normalizedQuery = normalizeText(query);
  const preferredTypes = preferredFilterNodeTypes(query);
  let candidates = Array.from(nodeById.values())
    .filter((node) => isFilterableNodeType(node.nodeType))
    .map((node) => {
      const label = node.displayLabel || node.name;
      const normalizedLabel = normalizeText(label);
      let score = 0;
      if (!normalizedLabel) return null;
      if (normalizedQuery === normalizedLabel) score = 20;
      else if (normalizedQuery.includes(normalizedLabel)) score = Math.max(6, normalizedLabel.length);
      else if (normalizedLabel.includes(normalizedQuery) && normalizedQuery.length >= 2) score = 3;
      return score > 0 ? { id: node.id, label: normalizedLabel, nodeType: node.nodeType, score } : null;
    })
    .filter((item): item is { id: string; label: string; nodeType: string; score: number } => item !== null);

  if (preferredTypes) {
    const preferred = candidates.filter((item) => preferredTypes.has(item.nodeType));
    if (preferred.length) candidates = preferred;
  }

  candidates = candidates.filter((item) =>
    !candidates.some((other) =>
      other.id !== item.id
      && other.label.length > item.label.length
      && other.label.includes(item.label)
      && normalizedQuery.includes(other.label)
    )
  );

  return candidates
    .sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id, "zh-CN"))
    .slice(0, 4)
    .map((item) => item.id);
}
function connectedProductsForNode(node: FrontendGraphNode) {
  switch (node.nodeType) {
    case "Product": {
      const product = productById.get(node.id);
      return product ? [product] : [];
    }
    case "SKU": {
      const product = productBySku.get(node.sku);
      return product ? [product] : [];
    }
    case "CoreFamily":
      return sortProducts(products.filter((product) => product.coreFamily === node.name));
    case "SemanticDomain": {
      const conceptIds = (edgesBySource.get(node.id) ?? [])
        .filter((edge) => edge.edgeType === "HAS_SEMANTIC_CONCEPT")
        .map((edge) => edge.target);
      return sortProducts(uniq(
        conceptIds.flatMap((conceptId) =>
          (edgesByTarget.get(conceptId) ?? [])
            .filter((edge) => edge.sourceType === "Product" && edge.reviewStatus === "approved")
            .map((edge) => edge.source)
        )
      ).map((productId) => productById.get(productId)).filter((product): product is FrontendProduct => Boolean(product)));
    }
    case "ProductForm":
      return sortProducts(products.filter((product) => product.productForm === node.name));
    case "CollectionOrScent":
      return sortProducts(products.filter((product) => product.collections.includes(node.name)));
    case "ScentConcept":
      return sortProducts(products.filter((product) => product.scentConcepts.includes(node.name)));
    case "ScentIdentity":
      return sortProducts(products.filter((product) =>
        (product.scentIdentities ?? []).some((identity) => identity.id === node.id)
      ));
    case "NoteIngredient":
      return sortProducts(products.filter((product) => product.notes.includes(node.name)));
    case "ScentProfile":
      return sortProducts(products.filter((product) => product.scentProfiles.includes(node.name)));
    case "ScentAccord":
      return sortProducts(products.filter((product) => product.scentAccords.includes(node.name)));
    case "MarketingTag":
      return sortProducts(products.filter((product) => product.marketingTags.includes(node.name)));
    case "MaterialOrCraft":
      return sortProducts(products.filter((product) => product.materials.includes(node.name)));
    case "Function":
    case "UseScene":
    case "UserNeed":
    case "CareInstruction":
    case "UsageInstruction":
    case "Material":
    case "CraftTechnique":
      return sortProducts(
        (edgesByTarget.get(node.id) ?? [])
          .filter((edge) => edge.sourceType === "Product" && edge.reviewStatus === "approved")
          .map((edge) => productById.get(edge.source))
          .filter((product): product is FrontendProduct => Boolean(product))
      );
    case "VariantTag":
      return sortProducts(products.filter((product) => product.variantTags.includes(node.name)));
    default:
      return [];
  }
}

function productsForFilterIds(filterNodeIds: string[]) {
  const validNodes = filterNodeIds
    .map((id) => nodeById.get(id))
    .filter((node): node is FrontendGraphNode => node != null && isFilterableNodeType(node.nodeType));

  if (!validNodes.length) return [] as FrontendProduct[];

  const nodeGroups = new Map<string, FrontendGraphNode[]>();
  validNodes.forEach((node) => {
    const group = nodeGroups.get(node.nodeType) ?? [];
    group.push(node);
    nodeGroups.set(node.nodeType, group);
  });

  let current: FrontendProduct[] | null = null;
  for (const nodes of nodeGroups.values()) {
    const groupIds = new Set(
      nodes.flatMap((node) => connectedProductsForNode(node).map((product) => product.id))
    );
    current = current == null
      ? products.filter((product) => groupIds.has(product.id))
      : current.filter((product) => groupIds.has(product.id));
  }

  return uniqueProductsByName(sortProducts(current ?? []));
}

function scoreProduct(product: FrontendProduct, query: string) {
  const normalizedQuery = normalizeText(query);
  const terms = productKeywords(product);
  let score = 0;

  for (const term of terms) {
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

  const matchesCollection = product.collections.some((collection) =>
    normalizedQuery.includes(normalizeText(collection))
  );
  const matchesProductForm = product.productForm
    ? normalizedQuery.includes(normalizeText(product.productForm))
    : false;
  if (matchesCollection && matchesProductForm) {
    score += 10;
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

function rankedProducts(query: string) {
  return products
    .map((product) => ({ product, score: scoreProduct(product, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => (b.score - a.score) || a.product.name.localeCompare(b.product.name, "zh-CN"));
}

function buildDerivedCompatibilityEdges() {
  const result: FrontendGraphEdge[] = [];
  const seen = new Set<string>();
  const accessorySpecEdges = graphEdges.filter(
    (edge) => edge.edgeType === "ACCESSORY_FOR_SPEC" && edge.reviewStatus === "approved"
  );

  accessorySpecEdges.forEach((accessoryEdge) => {
    const specNode = nodeById.get(accessoryEdge.target);
    const productSpecEdges = (edgesByTarget.get(accessoryEdge.target) ?? []).filter(
      (edge) => edge.edgeType === "HAS_COMPATIBILITY_SPEC" && edge.sourceType === "Product"
    );
    productSpecEdges.forEach((productSpecEdge) => {
      if (productSpecEdge.source === accessoryEdge.source) return;
      const key = accessoryEdge.source + "|" + productSpecEdge.source + "|" + accessoryEdge.target;
      if (seen.has(key)) return;
      seen.add(key);
      result.push({
        source: accessoryEdge.source,
        target: productSpecEdge.source,
        edgeType: "ACCESSORY_FOR",
        sourceType: "Product",
        targetType: "Product",
        sourceName: accessoryEdge.sourceName,
        targetName: productSpecEdge.sourceName,
        viaField: accessoryEdge.viaField,
        relationLayer: "derived_compatibility",
        evidenceType: accessoryEdge.evidenceType,
        evidenceText: accessoryEdge.evidenceText,
        evidenceUrl: accessoryEdge.evidenceUrl,
        confidence: accessoryEdge.confidence,
        reviewStatus: "derived_from_approved_spec",
        scenario: accessoryEdge.scenario,
        displayLabel: "\u9002\u914d\uff08" + (specNode?.name ?? accessoryEdge.targetName) + "\uff09",
      });
    });
  });
  return result;
}

function buildDerivedRecommendationEdges() {
  const result: FrontendGraphEdge[] = [];
  const seen = new Set<string>();

  recommendationRules
    .filter((rule) => rule.reviewStatus === "approved")
    .forEach((rule) => {
      const source = productById.get(rule.sourceProductId);
      if (!source) return;
      products
        .filter(
          (target) =>
            target.id !== source.id &&
            !target.variantTags.includes("补充装") &&
            target.coreFamily === rule.targetCoreFamily &&
            target.collections.includes(rule.targetCollection) &&
            rule.targetProductForms.includes(target.productForm)
        )
        .forEach((target) => {
          const key = source.id + "|" + rule.relationType + "|" + target.id;
          if (seen.has(key)) return;
          seen.add(key);
          result.push({
            source: source.id,
            target: target.id,
            edgeType: rule.relationType,
            sourceType: "Product",
            targetType: "Product",
            sourceName: source.name,
            targetName: target.name,
            viaField: rule.evidenceField,
            relationLayer: "recommendation",
            evidenceType: rule.evidenceType,
            evidenceText: rule.evidenceText,
            evidenceUrl: rule.evidenceUrl,
            confidence: rule.confidence,
            reviewStatus: "derived_from_approved_rule",
            scenario: "同系列香气护理仪式",
            displayLabel: "香气延续（策展规则）",
          });
        });
    });
  return result;
}

function relationTypesForQuery(query: string) {
  if (/叠香|层叠搭配|层叠/.test(query)) return new Set(["LAYER_WITH"]);
  if (/空间同香|家居同香/.test(query)) return new Set(["EXTENDS_TO_HOME"]);
  if (/香气延续|护理仪式|用香仪式/.test(query)) return new Set(["SCENT_RITUAL_WITH"]);
  if (query.includes("补充") || query.includes("适用于")) return new Set(["REFILL_FOR"]);
  if (query.includes("适配") || query.includes("兼容")) return new Set(["ACCESSORY_FOR", "REFILL_FOR"]);
  if (query.includes("搭配")) {
    return new Set(["PAIRS_WITH", "SCENT_RITUAL_WITH", "EXTENDS_TO_HOME", "GIFT_WITH", "ACCESSORY_FOR"]);
  }
  return new Set<string>();
}

function requestedProductForms(text: string) {
  if (text.includes("淡香水")) return new Set(["淡香水"]);
  if (text.includes("淡香精")) return new Set(["淡香精"]);
  if (text.includes("发香喷雾")) return new Set(["发香喷雾"]);
  if (text.includes("固体香膏") || text.includes("香膏")) return new Set(["香膏"]);
  if (text.includes("香水")) return new Set(["淡香水", "淡香精"]);
  return new Set<string>();
}

function splitRelationQuery(query: string) {
  const marker = query.match(/搭配什么|(?:可以)?(?:和|与)什么/);
  if (!marker || marker.index == null) {
    return { subject: query, target: "" };
  }
  return {
    subject: query.slice(0, marker.index),
    target: query.slice(marker.index + marker[0].length),
  };
}

function cleanRelationSubject(value: string) {
  return value
    .replace(/搭配|叠香|层叠|空间同香|家居同香|香气延续|护理仪式|用香仪式|补充关系|对应补充|补充装|补充瓶|适用于|适配|兼容|什么|哪些|哪个|是否|可以|能够|请问|的$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolvePublishedRelationQuery(query: string): ResponseEntry | null {
  const relationTypes = relationTypesForQuery(query);
  const availableEdges = [
    ...approvedProductRelations,
    ...derivedCompatibilityEdges,
    ...derivedRecommendationEdges,
  ].filter((edge) => relationTypes.has(edge.edgeType));
  if (!availableEdges.length) return null;

  const endpointIds = new Set(availableEdges.flatMap((edge) => [edge.source, edge.target]));
  const queryParts = splitRelationQuery(query);
  const subjectQuery = cleanRelationSubject(queryParts.subject);
  const targetForms = requestedProductForms(queryParts.target);
  const subjectForms = requestedProductForms(subjectQuery);
  const isGenericFormSubject = /^(香水|淡香水|淡香精|发香喷雾|固体香膏|香膏)$/.test(subjectQuery);
  const rankedEndpoints = subjectQuery
    ? products
        .filter(
          (product) =>
            endpointIds.has(product.id) &&
            (!isGenericFormSubject || subjectForms.has(product.productForm))
        )
        .map((product) => ({
          product,
          score: isGenericFormSubject ? 10 : scoreProduct(product, subjectQuery),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => (b.score - a.score) || a.product.name.localeCompare(b.product.name, "zh-CN"))
    : [];
  const topScore = rankedEndpoints[0]?.score ?? 0;
  const anchorIds = new Set(
    rankedEndpoints.filter((item) => item.score >= topScore - 1).map((item) => item.product.id)
  );
  const matchingEdges = (anchorIds.size
    ? availableEdges.filter((edge) => {
        const sourceIsAnchor = anchorIds.has(edge.source);
        const targetIsAnchor = anchorIds.has(edge.target);
        if (!sourceIsAnchor && !targetIsAnchor) return false;
        if (!targetForms.size) return true;
        const counterpartId = sourceIsAnchor ? edge.target : edge.source;
        const counterpart = productById.get(counterpartId);
        return counterpart != null && targetForms.has(counterpart.productForm);
      })
    : availableEdges
  ).slice(0, 8);
  if (!matchingEdges.length) return null;

  const relationLines = matchingEdges.map(
    (edge) => edge.sourceName + " --" + (edgeLabelMap[edge.edgeType] ?? edge.edgeType) + "--> " + edge.targetName
  );
  const focusId = rankedEndpoints[0]?.product.id ?? matchingEdges[0].source;
  const relationSuggestions = relationTypes.has("LAYER_WITH")
    ? ["影中之水润肤乳可以和什么层叠搭配？", "影中之水洁肤露可以和什么层叠搭配？", "哪些关系有人工审核证据？"]
    : relationTypes.has("SCENT_RITUAL_WITH")
      ? ["奥费恩香氛护手霜搭配什么淡香精？", "玫瑰香调护手霜搭配什么淡香水？", "香水和什么搭配？"]
      : ["杜桑香膏的补充装适用于什么？", "黑色蜡质花瓶 L 和什么搭配？", "有哪些补充装？"];
  const confidenceValues = matchingEdges
    .map((edge) => Number.parseFloat(edge.confidence))
    .filter((value) => Number.isFinite(value));
  const confidencePercent = confidenceValues.length
    ? Math.round(Math.min(...confidenceValues) * 100)
    : 74;
  const confidenceBand = confidencePercent >= 86 ? "high" : confidencePercent >= 78 ? "medium" : "low";
  return {
    answer: "当前有 " + matchingEdges.length + " 条已审核或规则推导关系：\n" + relationLines.join("\n"),
    confidence: confidencePercent + "% · " + confidenceBand,
    keywords: uniq(
      matchingEdges.flatMap((edge) => [
        edge.sourceName,
        edgeLabelMap[edge.edgeType] ?? edge.edgeType,
        edge.targetName,
      ])
    ).slice(0, 8),
    suggestions: relationSuggestions,
    focusEdgeIds: matchingEdges.map((edge) => edge.source + "|" + edge.edgeType + "|" + edge.target),
    focusNodeLabel: focusId,
  };
}

function detectIntent(query: string) {
  if (query.includes("送礼") || query.includes("礼赠") || query.includes("礼物")) return "送礼推荐";
  if (query.includes("补充装") || query.includes("补充瓶") || query.includes("补充")) return "补充装筛选";
  if (query.includes("价格") || query.includes("多少钱")) return "价格查询";
  if (query.includes("精选") || query.includes("人气") || query.includes("热门")) return "标签筛选";
  if (query.includes("系列")) return "系列浏览";
  if (query.includes("搭配") || query.includes("叠香") || query.includes("空间同香")) return "商品关系查询";
  if (query.includes("香调") || query.includes("材质")) return "属性查询";
  return "商品检索";
}


function localProductCatalogResponse(scope: ProductCatalogScope): ResponseEntry {
  const filterNodeIds = uniq([
    ...scope.coreFamilies.map((family) => `family:${family}`),
    ...scope.productForms.map((form) => `form:${form}`),
  ]).filter((id) => nodeById.has(id));
  const matchedProducts = products
    .filter((product) =>
      (!scope.coreFamilies.length || scope.coreFamilies.includes(product.coreFamily))
      && (!scope.productForms.length || scope.productForms.includes(product.productForm))
    )
    .sort(
      (a, b) =>
        a.coreFamily.localeCompare(b.coreFamily, "zh-CN")
        || a.productForm.localeCompare(b.productForm, "zh-CN")
        || a.name.localeCompare(b.name, "zh-CN")
    );
  const uniqueMatchedProducts = uniqueProductsByName(matchedProducts);
  const grouped = new Map<string, Map<string, FrontendProduct[]>>();
  uniqueMatchedProducts.forEach((product) => {
    const family = grouped.get(product.coreFamily) ?? new Map<string, FrontendProduct[]>();
    const form = family.get(product.productForm) ?? [];
    form.push(product);
    family.set(product.productForm, form);
    grouped.set(product.coreFamily, family);
  });
  const lines = Array.from(grouped.entries()).flatMap(([familyName, forms]) => [
    `${familyName}（${Array.from(forms.values()).flat().length}款）`,
    ...Array.from(forms.entries()).map(([formName, formProducts]) =>
      uniqueMatchedProducts.length > 40
        ? `- ${formName}（${formProducts.length}款）`
        : `- ${formName}（${formProducts.length}款）：${formProducts.map((product) => product.name).join("、")}`
    ),
  ]);
  const baseResponse = filterNodeIds.length
    ? resolveCombinedFilterSelection(filterNodeIds)
    : genericFallback();
  return {
    ...baseResponse,
    answer: uniqueMatchedProducts.length > 40
      ? `${scope.label}相关产品共${uniqueMatchedProducts.length}款，先按商品大类和品型概览：\n${lines.join("\n")}\n可以继续问某个具体品型，我会列出该品型的全部商品。`
      : `${scope.label}相关产品共${uniqueMatchedProducts.length}款，按商品大类和品型完整列出：\n${lines.join("\n")}`,
    card: undefined,
    filterNodeIds,
    focusNodeLabel: filterNodeIds.at(-1),
    keywords: uniq([scope.label, ...scope.coreFamilies, ...scope.productForms]),
    suggestions: scope.productForms.length
      ? ["还有哪些相关品型？", "有没有适合送礼的产品？"]
      : [
          ...scope.coreFamilies.map((family) => `${family}有哪些产品？`),
          "香氛蜡烛有哪些？",
        ].slice(0, 4),
  };
}

function localGiftRecommendation(query: string): ResponseEntry {
  const wantsCreativeGift = /文创|笔记本|笔筒|便签本/.test(query);
  const wantsHomeGift = /家居|摆件|装饰|烛台|花瓶|托盘|香氛蜡烛|扩香/.test(query);
  const requestedFamilies = wantsCreativeGift
    ? wantsHomeGift
      ? new Set(["艺术家居", "家居香氛", "文创"])
      : new Set(["文创"])
    : wantsHomeGift
      ? new Set(["艺术家居", "家居香氛"])
      : null;
  const candidates = products
    .filter((product) => {
      if (product.variantTags.includes("补充装")) return false;
      return requestedFamilies
        ? requestedFamilies.has(product.coreFamily)
        : product.coreFamily === "个人香氛" && ["淡香水", "淡香精", "香膏", "淡香水礼盒", "礼盒"].includes(product.productForm);
    })
    .sort(
      (a, b) =>
        Number(b.marketingTags.includes("臻选礼赠")) - Number(a.marketingTags.includes("臻选礼赠")) ||
        Number(Boolean(b.materials.length)) - Number(Boolean(a.materials.length)) ||
        a.productForm.localeCompare(b.productForm, "zh-CN") ||
        a.name.localeCompare(b.name, "zh-CN")
    )
    .slice(0, 5);
  const recommendationProductNames = candidates.map((product) => product.name);
  const categoryLabel = wantsCreativeGift
    ? wantsHomeGift
      ? "家居与文创商品"
      : "文创商品"
    : wantsHomeGift
      ? "家居商品"
      : "个人香氛";
  return {
    answer: `可以先从这 ${candidates.length} 款${categoryLabel}中比较：${recommendationProductNames.join("、")}。你可以再告诉我偏好的风格、预算或送礼对象，我会继续缩小范围。`,
    cards: getProductCardsByNames(recommendationProductNames),
    confidence: "82% · 🟡 medium",
    keywords: recommendationProductNames,
    recommendationProductNames,
    suggestions: wantsCreativeGift && !wantsHomeGift
      ? ["推荐文创礼物", "文创用品有哪些？", "预算 500 元以内", "有哪些笔记本？"]
      : wantsHomeGift
        ? ["推荐陶瓷家居礼物", "推荐有搭配关系的家居用品", "预算 1000 元以内", "有哪些烛台？"]
        : ["推荐木质调香水", "推荐清新香水", "预算 1500 元以内", "有哪些香水礼盒？"],
  };
}
function genericFallback(): ResponseEntry {
  return {
    answer: "这版 Diptyque 图谱区分事实关系、兼容关系和推荐关系。商品分类、系列、香材与 SKU 来自原始数据；搭配和香气延续仅在存在官方文案或已审核策展规则时展示。",
    confidence: "74% · 🟡 medium",
    keywords: [],
    suggestions: defaultSuggestions,
  };
}

export function resolveDiptyqueResponse(input: string): ResponseEntry {
  const query = input.trim();
  if (!query) return genericFallback();

  if (isGiftRecommendationQuery(query)) return localGiftRecommendation(query);

  const productCatalogScope = extractProductCatalogScope(query, productCatalogVocabulary);
  if (productCatalogScope) return localProductCatalogResponse(productCatalogScope);

  if (/搭配|叠香|空间同香|家居同香|补充关系|对应补充|的补充装|适用于|适配|兼容/.test(query)) {
    const publishedRelationResponse = resolvePublishedRelationQuery(query);
    if (publishedRelationResponse) return publishedRelationResponse;
    return {
      answer: "当前已审核关系中没有与这个问题匹配的商品连线。系统不会把同系列、相似香调或装饰品名称自动推断为搭配；需要有官方说明或人工审核证据后才会发布。",
      confidence: "95% · 🟢 high",
      keywords: ["关系证据", "事实图谱"],
      suggestions: ["晚香玉系列有哪些产品？", "哪些产品含有晚香玉？", "有哪些补充装？"],
    };
  }

  const ambiguity = findSemanticAmbiguity(query);
  if (ambiguity) {
    const [, nodes] = ambiguity;
    const label = nodes[0]?.name ?? "该名称";
    const roles = uniq(nodes.map((node) => semanticRoleLabel(node.nodeType)));
    const suggestions = [
      nodes.some((node) => node.nodeType === "CollectionOrScent") ? `${label}系列有哪些产品？` : "",
      nodes.some((node) => node.nodeType === "ScentConcept") ? `${label}香味有哪些产品？` : "",
      nodes.some((node) => node.nodeType === "NoteIngredient") ? `哪些产品含有${label}？` : "",
      nodes.some((node) => node.nodeType === "ScentProfile" || node.nodeType === "ScentAccord") ? `${label}气味类型有哪些产品？` : "",
    ].filter(Boolean);
    return {
      answer: `“${label}”在当前数据中同时表示${roles.join("和")}。为避免把不同概念强行取交集，请明确查询口径。`,
      confidence: "96% · 🟢 high",
      keywords: [label, ...roles],
      suggestions,
    };
  }

  const asksHierarchy = query.includes("家族") || query.includes("包含哪些") || /香调(有哪些|分类)/.test(query);
  const matchedHierarchyNodeId = asksHierarchy ? matchHierarchyNodeIdByQuery(query) : undefined;
  if (matchedHierarchyNodeId) {
    return {
      ...resolveGraphNodeSelection(matchedHierarchyNodeId),
      focusNodeLabel: matchedHierarchyNodeId,
    };
  }

  const matchedFilterNodeIds = matchFilterNodeIdsByQuery(query);
  if (matchedFilterNodeIds.length > 0 && (query.includes("哪些") || query.includes("什么") || query.includes("系列") || query.includes("香调") || query.includes("标签"))) {
    return {
      ...resolveCombinedFilterSelection(matchedFilterNodeIds),
      filterNodeIds: matchedFilterNodeIds,
      focusNodeLabel: matchedFilterNodeIds.at(-1),
    };
  }

  const ranked = rankedProducts(query);
  if (!ranked.length) return genericFallback();

  const top = ranked[0];
  const topProduct = top.product;
  const peers = ranked.slice(0, 5).map((item) => item.product.name);
  const intentLabel = detectIntent(query);
  const confidence = makeConfidence(top.score);
  let answer = "";

  if (intentLabel === "价格查询") {
    answer = `${topProduct.name} 当前图谱里有 ${topProduct.skuCount} 个 SKU，${formatSpecs(topProduct)}，价格区间为 ${formatPrice(topProduct)}。`;
  } else if (intentLabel === "送礼推荐" || intentLabel === "标签筛选" || intentLabel === "补充装筛选") {
    answer = `按当前图谱筛选，和“${query}”最贴近的代表商品有 ${peers.join("、")}。其中可以先从 ${topProduct.name} 开始看，它归在 ${[topProduct.coreFamily, topProduct.productForm].filter(Boolean).join(" / ")}。`;
  } else if ((intentLabel === "系列浏览" || intentLabel === "属性查询") && peers.length > 1) {
    answer = `按当前图谱检索，和“${query}”关联度最高的商品包括 ${peers.join("、")}。当前先用 ${topProduct.name} 作为代表商品，你也可以继续追问这些候选之间的差异。`;
  } else {
    answer = `${topProduct.name} 在线上图谱里的主路径是 ${[topProduct.coreFamily, topProduct.productForm].filter(Boolean).join(" / ")}。${makeQuote(topProduct)}${topProduct.collections.length ? ` 当前还挂到了 ${topProduct.collections.join(" / ")}。` : ""}`;
  }

  return {
    answer,
    card: buildProductCard(topProduct, intentLabel, top.score),
    confidence,
    focusNodeLabel: topProduct.id,
    keywords: productKeywords(topProduct),
    suggestions: buildFollowUps(topProduct),
  };
}

function buildNodeSuggestions(node: FrontendGraphNode, linkedProducts: FrontendProduct[]) {
  const lead = linkedProducts[0];
  return uniq([
    node.nodeType === "CoreFamily" ? `${node.name} 里有哪些人气精选？` : "",
    node.nodeType === "SemanticDomain" ? `${node.name}有哪些共享概念？` : "",
    node.nodeType === "ProductForm" ? `${node.name} 里有哪些补充装？` : "",
    node.nodeType === "CollectionOrScent" ? `${node.name} 系列还有哪些品型？` : "",
    node.nodeType === "MarketingTag" ? `还有哪些 ${node.name} 商品？` : "",
    node.nodeType === "NoteFamily" ? `${node.name}包含哪些下级气味节点？` : "",
    node.nodeType === "ScentConcept" || node.nodeType === "ScentIdentity" ? `${node.name}有哪些产品？` : "",
    node.nodeType === "NoteIngredient" ? `哪些产品含有${node.name}？` : "",
    node.nodeType === "ScentProfile" || node.nodeType === "ScentAccord" ? `${node.name}有哪些产品？` : "",
    lead ? `${lead.name} 多少钱？` : "",
    "有没有适合送礼的产品？",
  ]).filter(Boolean).slice(0, 4);
}

function buildNodeAnswer(node: FrontendGraphNode, linkedProducts: FrontendProduct[]) {
  const count = linkedProducts.length;
  const topForms = topKeys(countBy(linkedProducts.map((product) => product.productForm).filter(Boolean)), 3);
  const topFamilies = topKeys(countBy(linkedProducts.map((product) => product.coreFamily).filter(Boolean)), 3);
  const topCollections = topKeys(countBy(linkedProducts.flatMap((product) => product.collections)), 3);
  const sampleNames = linkedProducts.slice(0, 4).map((product) => product.name).join("、");

  switch (node.nodeType) {
    case "SKU": {
      const parentProduct = linkedProducts[0];
      return `${parentProduct?.name ?? "该商品"} 的这个 SKU 当前对应 ${node.size || node.name}，${formatSkuPrice(node)}，${formatSkuStock(node)}。它是最细的一层销售单元，适合继续往上回看所属商品。`;
    }
    case "CoreFamily":
      return `${node.name} 当前在图谱里关联 ${count} 个产品。常见品型包括 ${topForms.join("、") || "待补充"}。你可以继续从 ${sampleNames || node.name} 往下看具体系列、标签和 SKU。`;
    case "ProductForm":
      return `${node.name} 当前关联 ${count} 个产品，主要分布在 ${topFamilies.join("、") || "待补充"} 下。代表产品有 ${sampleNames || "待补充"}。`;
    case "CollectionOrScent":
      return `${node.name} 当前在图谱中连到 ${count} 个产品，覆盖的品型主要有 ${topForms.join("、") || "待补充"}。如果你想继续看系列延展，可以从代表产品 ${sampleNames || node.name} 开始。`;
    case "ScentConcept":
      return `${node.name} 是归一后的香味概念，汇总结构化系列、香材与复合香调证据，当前完整关联 ${count} 个产品。覆盖品型主要有 ${topForms.join("、") || "待补充"}，代表产品有 ${sampleNames || "待补充"}。`;
    case "ScentIdentity":
      return `${node.name} 是 Schema v1 的香气身份，当前依据可追溯事实关联 ${count} 个产品。覆盖品型主要有 ${topForms.join("、") || "待补充"}，代表产品有 ${sampleNames || "待补充"}。`;
    case "NoteIngredient":
      return `${node.name} 当前作为具体香材关联 ${count} 个产品，依据来自原始商品的香气描述。覆盖品型主要有 ${topForms.join("、") || "待补充"}，代表产品有 ${sampleNames || "待补充"}。`;
    case "ScentProfile":
      return `${node.name} 是气味类型，不是具体香材。当前关联 ${count} 个产品，代表产品有 ${sampleNames || "待补充"}。`;
    case "ScentAccord":
      return `${node.name} 是原始描述中的复合香调词，当前关联 ${count} 个产品，代表产品有 ${sampleNames || "待补充"}。`;
    case "OntologyDomain":
      return `${node.name} 是一级本体入口。点击下一级节点可以继续查看完整分类。`;
    case "SemanticDomain": {
      const childCount = (edgesBySource.get(node.id) ?? []).filter((edge) => edge.edgeType === "HAS_SEMANTIC_CONCEPT").length;
      return `${node.name} 是共享语义入口，包含 ${childCount} 个已审核概念，当前覆盖 ${count} 款商品。左侧只展示这个分支，不会把全部商品同时铺开。`;
    }
    case "Function":
      return `${node.name} 是共享功能节点，当前由官网文案直接支持 ${count} 款商品。代表产品有 ${sampleNames || "待补充"}。`;
    case "UseScene":
      return `${node.name} 是有官方依据的使用场景，当前关联 ${count} 款商品。代表产品有 ${sampleNames || "待补充"}。`;
    case "UserNeed":
      return `${node.name} 是有官方依据的需求，当前关联 ${count} 款商品。代表产品有 ${sampleNames || "待补充"}。`;
    case "CareInstruction":
      return `${node.name} 是共享保养说明，当前适用于 ${count} 款商品。点击商品与说明之间的连线可查看官网原文证据。`;
    case "Material":
      return `${node.name} 是物理材质节点，仅连接艺术家居或文创商品，当前关联 ${count} 款商品。代表产品有 ${sampleNames || "待补充"}。`;
    case "NoteFamily":
      return `${node.name} 是香调家族，当前完整香材清单已在左侧图谱展开。`;

    case "MarketingTag":
      return `${node.name} 这类标签当前命中 ${count} 个产品。它更像运营筛选维度，代表商品有 ${sampleNames || node.name}，核心大类主要分布在 ${topFamilies.join("、") || "待补充"}。`;
    case "MaterialOrCraft":
      return `${node.name} 当前主要关联 ${count} 个产品，常见品型包括 ${topForms.join("、") || "待补充"}。你可以继续看它在花瓶、烛罩或托盘里的分布。`;
    case "VariantTag":
      return `${node.name} 当前关联 ${count} 个产品，代表商品有 ${sampleNames || node.name}。这类节点适合继续对比正装、补充装和不同 SKU。`;
    default:
      return `${node.displayLabel || node.name} 当前连到了 ${count} 个产品。代表商品有 ${sampleNames || "待补充"}，常见系列包括 ${topCollections.join("、") || "待补充"}。`;
  }
}

export function resolveGraphNodeSelection(nodeId: string): ResponseEntry {
  const node = nodeById.get(nodeId);
  if (!node) return genericFallback();

  const linkedProducts = connectedProductsForNode(node);
  if (node.nodeType === "Product") {
    const product = linkedProducts[0];
    if (!product) return genericFallback();

    return {
      answer: `${product.name} 在线上图谱里的主路径是 ${[product.coreFamily, product.productForm].filter(Boolean).join(" / ")}。${makeQuote(product)}${product.collections.length ? ` 当前挂到 ${product.collections.join(" / ")}。` : ""}`,
      card: buildProductCard(product, "图谱点击", 8.5),
      confidence: "90% · 🟢 high",
      focusNodeLabel: product.id,
      keywords: productKeywords(product),
      suggestions: buildFollowUps(product),
    };
  }

  const leadProduct = linkedProducts[0];
  return {
    answer: buildNodeAnswer(node, linkedProducts),
    card: leadProduct
      ? buildProductCard(leadProduct, `${node.displayLabel || node.name} 代表商品`, Math.max(5, Math.min(9, linkedProducts.length + 2)), {
          focusPrompt: "商品图谱",
          focusTarget: leadProduct.id,
        })
      : undefined,
    confidence: makeConfidence(Math.max(3, Math.min(9, linkedProducts.length + 2))),
    focusNodeLabel: node.nodeType === "SKU" ? leadProduct?.id ?? node.id : node.id,
    keywords: uniq([
      node.name,
      node.displayLabel,
      ...linkedProducts.flatMap((product) => productKeywords(product)),
    ]).filter(Boolean),
    suggestions: buildNodeSuggestions(node, linkedProducts),
  };
}

function combinedFilterSuggestions(filterNodeIds: string[], matchedProducts: FrontendProduct[]) {
  const trail = getFilterTrail(filterNodeIds);
  const lead = matchedProducts[0];
  const last = trail.at(-1)?.label ?? "当前筛选";
  return uniq([
    lead ? `${lead.name} 多少钱？` : "",
    `${last} 里还有哪些补充装？`,
    `${last} 里有哪些人气精选？`,
    "有没有适合送礼的产品？",
    trail.length < 3 ? "还能继续加一个筛选条件吗？" : "如果太窄，可以移除一个条件再试。",
  ]).filter(Boolean).slice(0, 4);
}

function resolveCombinedFilterSelection(filterNodeIds: string[]): ResponseEntry {
  const trail = getFilterTrail(filterNodeIds);
  const matchedProducts = productsForFilterIds(filterNodeIds);
  const pathText = trailText(filterNodeIds);
  const focusNodeLabel = filterNodeIds.at(-1) ?? null;

  if (!matchedProducts.length) {
    return {
      answer: `按 ${pathText} 当前没有筛到交集商品。你可以移除一个条件，或者换一个系列/标签再试。`,
      confidence: "67% · 🟠 low",
      focusNodeLabel: focusNodeLabel ?? undefined,
      keywords: trail.map((item) => item.label),
      suggestions: combinedFilterSuggestions(filterNodeIds, matchedProducts),
    };
  }

  const lead = matchedProducts[0];
  const isScentIdentityFilter = trail.some((item) => item.nodeType === "ScentIdentity");
  const listedProducts = isScentIdentityFilter ? matchedProducts : matchedProducts.slice(0, 4);
  const productList = listedProducts.map((product) => product.name).join("、");
  const score = Math.max(5, Math.min(9, matchedProducts.length + filterNodeIds.length + 1));
  const answer = matchedProducts.length === 1
    ? `按 ${pathText} 当前已筛到 1 个商品：${lead.name}。它归在 ${[lead.coreFamily, lead.productForm].filter(Boolean).join(" / ")}。`
    : `按 ${pathText} 当前已筛到 ${matchedProducts.length} 个商品：${productList}。${isScentIdentityFilter ? "以上为当前香气身份的完整关联商品。" : "你可以继续沿着这个交集查看商品，或者继续叠加筛选条件。"}`;

  const cardOptions = {
    focusPrompt: "商品图谱",
    focusTarget: lead.id,
  };
  return {
    answer,
    card: matchedProducts.length === 1
      ? buildProductCard(lead, `${trail.at(-1)?.label ?? "组合筛选"} 命中商品`, score, cardOptions)
      : undefined,
    cards: matchedProducts.length > 1
      ? listedProducts.map((product) => buildProductCard(product, `${trail.at(-1)?.label ?? "组合筛选"} 命中商品`, score, {
          focusPrompt: "商品图谱",
          focusTarget: product.id,
        }))
      : undefined,
    confidence: makeConfidence(score),
    focusNodeLabel: focusNodeLabel ?? undefined,
    keywords: uniq([...trail.map((item) => item.label), ...productKeywords(lead)]),
    suggestions: combinedFilterSuggestions(filterNodeIds, matchedProducts),
  };
}

export function resolveGraphInteraction(nodeId: string, currentFilterNodeIds: string[]): GraphInteractionResult {
  const node = nodeById.get(nodeId);
  if (!node) {
    return {
      nextFilterNodeIds: currentFilterNodeIds,
      nextFocusLabel: currentFilterNodeIds.at(-1) ?? null,
      response: genericFallback(),
    };
  }

  if (node.nodeType === "Product") {
    return {
      nextFilterNodeIds: currentFilterNodeIds,
      nextFocusLabel: node.id,
      response: resolveGraphNodeSelection(node.id),
    };
  }

  if (node.nodeType === "SKU") {
    const response = resolveGraphNodeSelection(node.id);
    return {
      nextFilterNodeIds: currentFilterNodeIds,
      nextFocusLabel: response.focusNodeLabel ?? node.id,
      response,
    };
  }

  if (isFilterableNodeType(node.nodeType)) {
    const nextFilterNodeIds = currentFilterNodeIds.includes(node.id)
      ? currentFilterNodeIds.filter((id) => id !== node.id)
      : [...currentFilterNodeIds, node.id];

    if (!nextFilterNodeIds.length) {
      return {
        nextFilterNodeIds: [],
        nextFocusLabel: node.id,
        response: resolveGraphNodeSelection(node.id),
      };
    }

    return {
      nextFilterNodeIds,
      nextFocusLabel: node.id,
      response: resolveCombinedFilterSelection(nextFilterNodeIds),
    };
  }

  return {
    nextFilterNodeIds: currentFilterNodeIds,
    nextFocusLabel: node.id,
    response: resolveGraphNodeSelection(node.id),
  };
}

function polarPosition(radius: number, angle: number) {
  return {
    x: VIEWBOX_CENTER_X + Math.cos(angle) * radius,
    y: VIEWBOX_CENTER_Y + Math.sin(angle) * radius,
  };
}

function linePositions(ids: string[], y: number, gap = 120) {
  const positions = new Map<string, { x: number; y: number }>();
  if (!ids.length) return positions;
  const startX = VIEWBOX_CENTER_X - ((ids.length - 1) * gap) / 2;
  ids.forEach((id, index) => {
    positions.set(id, { x: startX + index * gap, y });
  });
  return positions;
}

function arcPositions(ids: string[], radius: number, startAngle: number, endAngle: number) {
  const positions = new Map<string, { x: number; y: number }>();
  if (!ids.length) return positions;
  if (ids.length === 1) {
    positions.set(ids[0], polarPosition(radius, (startAngle + endAngle) / 2));
    return positions;
  }
  ids.forEach((id, index) => {
    const ratio = index / (ids.length - 1);
    const angle = startAngle + (endAngle - startAngle) * ratio;
    positions.set(id, polarPosition(radius, angle));
  });
  return positions;
}

function circlePositions(ids: string[], radius: number, startAngle = -Math.PI / 2) {
  const positions = new Map<string, { x: number; y: number }>();
  ids.forEach((id, index) => {
    const angle = startAngle + (Math.PI * 2 * index) / Math.max(ids.length, 1);
    positions.set(id, polarPosition(radius, angle));
  });
  return positions;
}

function concentricPositions(ids: string[]) {
  const positions = new Map<string, { x: number; y: number }>();
  const capacities = [12, 18, 24, 30];
  const radii = [92, 144, 194, 236];
  let offset = 0;

  capacities.forEach((capacity, index) => {
    const ringIds = ids.slice(offset, offset + capacity);
    circlePositions(ringIds, radii[index], -Math.PI / 2).forEach((value, key) => positions.set(key, value));
    offset += capacity;
  });

  return positions;
}

function overviewSecondaryPositions(ids: string[]) {
  const positions = new Map<string, { x: number; y: number }>();
  const capacities = [18, 24, 31];
  const radii = [264, 274, 282];
  let offset = 0;

  capacities.forEach((capacity, index) => {
    const ringIds = ids.slice(offset, offset + capacity);
    circlePositions(ringIds, radii[index], -Math.PI / 2).forEach((value, key) => positions.set(key, value));
    offset += capacity;
  });

  return positions;
}

function mergePositions(...groups: Array<Map<string, { x: number; y: number }>>) {
  const positions = new Map<string, { x: number; y: number }>();
  groups.forEach((group) => {
    group.forEach((value, key) => positions.set(key, value));
  });
  return positions;
}

function nodeRadius(nodeType: string) {
  switch (nodeType) {
    case "Product":
      return 15;
    case "CoreFamily":
    case "OntologyDomain":
    case "SemanticDomain":
      return 12;
    case "ProductForm":
      return 10;
    case "CollectionOrScent":
    case "ScentConcept":
    case "ScentIdentity":
      return 9;
    case "NoteFamily":
      return 10;
    case "MaterialOrCraft":
    case "Function":
    case "UseScene":
    case "UserNeed":
    case "CareInstruction":
    case "UsageInstruction":
    case "Material":
    case "CraftTechnique":
    case "NoteIngredient":
    case "ScentProfile":
    case "ScentAccord":
    case "MarketingTag":
    case "VariantTag":
      return 8.5;
    case "SKU":
      return 8;
    default:
      return 7.5;
  }
}

function makeNode(id: string, positions: Map<string, { x: number; y: number }>, focusId?: string): GraphNode | null {
  const source = nodeById.get(id);
  const position = positions.get(id);
  if (!source || !position) return null;

  const anchor = position.x < VIEWBOX_CENTER_X ? "end" : "start";
  const dx = anchor === "end" ? -16 : 16;
  return {
    anchor,
    dx,
    dy: 4,
    fill: nodeColorMap[source.nodeType] ?? "#777777",
    id: source.id,
    label: source.displayLabel || source.name,
    nodeType: source.nodeType,
    persistent: ["Product", "CoreFamily", "ProductForm", "CollectionOrScent", "ScentConcept", "ScentIdentity", "OntologyDomain", "SemanticDomain", "NoteFamily", "Function", "UseScene", "UserNeed", "CareInstruction", "UsageInstruction", "Material", "CraftTechnique"].includes(source.nodeType),
    r: id === focusId ? nodeRadius(source.nodeType) + 1.8 : nodeRadius(source.nodeType),
    x: position.x,
    y: position.y,
  };
}

function lineDataFromEdges(edges: FrontendGraphEdge[], positions: Map<string, { x: number; y: number }>) {
  const lines: GraphLine[] = [];
  const edgeLabels: string[] = [];

  edges.forEach((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target || hiddenEdgeTypes.has(edge.edgeType)) return;

    lines.push({
      dashed:
        edge.edgeType === "HAS_DERIVED_TYPE" ||
        edge.edgeType === "HAS_SKU" ||
        edge.relationLayer === "recommendation",
      edgeId: edge.source + "|" + edge.edgeType + "|" + edge.target,
      edgeType: edge.edgeType,
      label: edge.displayLabel ?? edgeLabelMap[edge.edgeType] ?? edge.edgeType,
      sourceName: edge.sourceName,
      sourceId: edge.source,
      targetName: edge.targetName,
      targetId: edge.target,
      relationLayer: edge.relationLayer,
      evidenceType: edge.evidenceType,
      evidenceText: edge.evidenceText,
      evidenceUrl: edge.evidenceUrl,
      confidence: edge.confidence,
      reviewStatus: edge.reviewStatus,
      scenario: edge.scenario,
      viaField: edge.viaField,
      x1: source.x,
      x2: target.x,
      y1: source.y,
      y2: target.y,
    });
    edgeLabels.push(edge.displayLabel ?? edgeLabelMap[edge.edgeType] ?? edge.edgeType);
  });

  return { edgeLabels, lines };
}

function directNeighborIds(nodeId: string) {
  const outgoing = (edgesBySource.get(nodeId) ?? [])
    .filter((edge) => !hiddenEdgeTypes.has(edge.edgeType))
    .map((edge) => edge.target);
  const incoming = (edgesByTarget.get(nodeId) ?? [])
    .filter((edge) => !hiddenEdgeTypes.has(edge.edgeType))
    .map((edge) => edge.source);
  return uniq([...outgoing, ...incoming].filter((id) => id !== nodeId));
}

function relatedProducts(product: FrontendProduct) {
  const siblings = products.filter((candidate) => candidate.id !== product.id);
  if (product.collections.length) {
    return siblings.filter((candidate) => candidate.collections.includes(product.collections[0])).slice(0, 2);
  }
  if (product.marketingTags.length) {
    return siblings.filter((candidate) => candidate.marketingTags.includes(product.marketingTags[0])).slice(0, 2);
  }
  return siblings.filter((candidate) => candidate.productForm === product.productForm).slice(0, 2);
}

function buildProductFocusGraph(focusId: string, filterNodeIds: string[] = []): GraphDataset {
  const product = productById.get(focusId);
  if (!product) {
    return buildOverviewGraph();
  }

  const directIds = directNeighborIds(product.id);
  const compatibilityEdges = derivedCompatibilityEdges.filter(
    (edge) => edge.source === product.id || edge.target === product.id
  );
  const recommendationEdges = derivedRecommendationEdges.filter(
    (edge) => edge.source === product.id || edge.target === product.id
  );
  const reviewedRecommendationEdges = approvedProductRelations.filter(
    (edge) =>
      (edge.source === product.id || edge.target === product.id) &&
      ["PAIRS_WITH", "SCENT_RITUAL_WITH", "EXTENDS_TO_HOME", "LAYER_WITH", "GIFT_WITH"].includes(edge.edgeType)
  );
  const compatibilityProductIds = compatibilityEdges.map((edge) =>
    edge.source === product.id ? edge.target : edge.source
  );
  const recommendationProductIds = recommendationEdges.map((edge) =>
    edge.source === product.id ? edge.target : edge.source
  );
  const reviewedRecommendationProductIds = reviewedRecommendationEdges.map((edge) =>
    edge.source === product.id ? edge.target : edge.source
  );
  const familyIds = directIds
    .filter((id) => nodeById.get(id)?.nodeType === "ProductForm")
    .flatMap((id) => directNeighborIds(id))
    .filter((id) => nodeById.get(id)?.nodeType === "CoreFamily");
  const filterPathIds = uniq([...hierarchyAncestorIdsFor(filterNodeIds), ...filterNodeIds]);
  const filterPathSet = new Set(filterPathIds);
  const neighborIds = uniq([...directIds, ...familyIds, ...filterPathIds.filter((id) => id !== product.id)]);
  const relationProductIds = directIds.filter((id) => nodeById.get(id)?.nodeType === "Product");
  const siblingIds = uniq([
    ...reviewedRecommendationProductIds.slice(0, 4),
    ...recommendationProductIds.slice(0, 4),
    ...compatibilityProductIds.slice(0, 4),
    ...relationProductIds,
    ...relatedProducts(product).map((item) => item.id),
  ]).slice(0, 8);
  const catalogIds = neighborIds.filter((id) => {
    const node = nodeById.get(id);
    return !filterPathSet.has(id) && (node?.nodeType === "CoreFamily" || node?.nodeType === "ProductForm");
  }).slice(0, 2);
  const scentIds = neighborIds.filter((id) => {
    const nodeType = nodeById.get(id)?.nodeType ?? "";
    return !filterPathSet.has(id) && ["CollectionOrScent", "ScentConcept", "ScentIdentity", "NoteIngredient", "ScentProfile", "ScentAccord"].includes(nodeType);
  }).slice(0, 2);
  const purposeIds = neighborIds.filter((id) =>
    ["Function", "UseScene", "UserNeed"].includes(nodeById.get(id)?.nodeType ?? "")
  ).slice(0, 4);
  const physicalIds = neighborIds.filter((id) =>
    ["Material", "CraftTechnique", "MaterialOrCraft"].includes(nodeById.get(id)?.nodeType ?? "")
  ).slice(0, 3);
  const instructionIds = neighborIds.filter((id) =>
    ["CareInstruction", "UsageInstruction", "SKU"].includes(nodeById.get(id)?.nodeType ?? "")
  ).slice(0, 4);
  const metadataIds = neighborIds.filter((id) =>
    ["MarketingTag", "VariantTag"].includes(nodeById.get(id)?.nodeType ?? "")
  ).slice(0, 1);
  const visibleSiblingIds = siblingIds.slice(0, 2);

  const positions = new Map<string, { x: number; y: number }>();
  linePositions(filterPathIds, 62, 100).forEach((value, key) => positions.set(key, value));
  positions.set(product.id, { x: VIEWBOX_CENTER_X, y: 286 });
  arcPositions(catalogIds, 168, Math.PI * 0.82, Math.PI * 1.18).forEach((value, key) => positions.set(key, value));
  arcPositions(scentIds, 178, -Math.PI * 0.86, -Math.PI * 0.14).forEach((value, key) => positions.set(key, value));
  arcPositions(purposeIds, 188, -0.18, 0.86).forEach((value, key) => positions.set(key, value));
  arcPositions(physicalIds, 184, 2.12, 2.92).forEach((value, key) => positions.set(key, value));
  arcPositions(instructionIds, 174, 0.78, 2.18).forEach((value, key) => positions.set(key, value));
  arcPositions(metadataIds, 252, -0.18, 0.42).forEach((value, key) => positions.set(key, value));
  arcPositions(visibleSiblingIds, 258, 0.64, 2.5).forEach((value, key) => positions.set(key, value));

  const nodeIds = uniq([...filterPathIds, product.id, ...catalogIds, ...scentIds, ...purposeIds, ...physicalIds, ...instructionIds, ...metadataIds, ...visibleSiblingIds]);
  const nodeSet = new Set(nodeIds);
  const linesSource = [
    ...graphEdges.filter(
      (edge) => nodeSet.has(edge.source) && nodeSet.has(edge.target) && !hiddenEdgeTypes.has(edge.edgeType)
    ),
    ...compatibilityEdges.filter((edge) => nodeSet.has(edge.source) && nodeSet.has(edge.target)),
    ...recommendationEdges.filter((edge) => nodeSet.has(edge.source) && nodeSet.has(edge.target)),
  ];

  const nodes = nodeIds.map((id) => makeNode(id, positions, product.id)).filter((node): node is GraphNode => node !== null);
  const { edgeLabels, lines } = lineDataFromEdges(linesSource, positions);

  return {
    edgeLabels,
    focusLabel: product.id,
    lines,
    modeLabel: `${product.name} 聚焦`,
    nodes,
    summaryText: `${product.coreFamily} · ${product.productForm} · 当前展示 ${nodeIds.length} 个局部节点${filterNodeIds.length ? ` · 当前筛选 ${trailText(filterNodeIds)}` : ""}`,
    viewBox: `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`,
  };
}

function buildRecommendationGraph(productNames: string[]): GraphDataset {
  const seenProductIds = new Set<string>();
  const selectedProducts = productNames
    .map((name) => products.find((product) => product.name === name))
    .filter((product): product is FrontendProduct => {
      if (!product || seenProductIds.has(product.id)) return false;
      seenProductIds.add(product.id);
      return true;
    })
    .slice(0, 5);
  if (!selectedProducts.length) return buildOverviewGraph();

  const selectedProductIds = selectedProducts.map((product) => product.id);
  const selectedProductIdSet = new Set(selectedProductIds);
  const attributeEdges: FrontendGraphEdge[] = [];
  const hierarchyEdges: FrontendGraphEdge[] = [];
  const semanticFactEdges: FrontendGraphEdge[] = [];

  selectedProducts.forEach((product) => {
    const incoming = (edgesByTarget.get(product.id) ?? []).filter((edge) => edge.targetType === "Product");
    const outgoing = edgesBySource.get(product.id) ?? [];
    semanticFactEdges.push(...outgoing.filter((edge) =>
      edge.relationLayer === "fact"
      && edge.reviewStatus === "approved"
      && ["Function", "UseScene", "UserNeed", "CareInstruction", "UsageInstruction", "Material", "CraftTechnique"].includes(edge.targetType)
    ));
    const formEdge = incoming.find((edge) => edge.sourceType === "ProductForm");
    if (formEdge) {
      attributeEdges.push(formEdge);
      const familyEdge = (edgesByTarget.get(formEdge.source) ?? []).find(
        (edge) => edge.sourceType === "CoreFamily" && edge.targetType === "ProductForm"
      );
      if (familyEdge) hierarchyEdges.push(familyEdge);
    }

    const prefersMaterial = ["艺术家居", "文创"].includes(product.coreFamily);
    const schemaScentEdges = outgoing.filter(
      (edge) => edge.edgeType === "HAS_SCENT" && edge.targetType === "ScentIdentity"
    );
    const preferredType = prefersMaterial ? "MaterialOrCraft" : "ScentConcept";
    const legacyPreferredEdges = incoming.filter((edge) => edge.sourceType === preferredType);
    const preferredEdges = !prefersMaterial && schemaScentEdges.length ? schemaScentEdges : legacyPreferredEdges;
    const fallbackEdges = incoming.filter(
      (edge) => edge.sourceType === "CollectionOrScent" && !preferredEdges.some((item) => item.source === edge.source)
    );
    attributeEdges.push(...[...preferredEdges, ...fallbackEdges].slice(0, 2));
  });

  const semanticTargetUsage = new Map<string, Set<string>>();
  semanticFactEdges.forEach((edge) => {
    const sources = semanticTargetUsage.get(edge.target) ?? new Set<string>();
    sources.add(edge.source);
    semanticTargetUsage.set(edge.target, sources);
  });
  const semanticTypePriority: Record<string, number> = {
    Function: 0,
    UseScene: 1,
    UserNeed: 2,
    Material: 3,
    CraftTechnique: 4,
    CareInstruction: 5,
    UsageInstruction: 6,
  };
  const chosenSemanticIds = Array.from(semanticTargetUsage.keys())
    .sort((a, b) =>
      (semanticTargetUsage.get(b)?.size ?? 0) - (semanticTargetUsage.get(a)?.size ?? 0)
      || (semanticTypePriority[nodeById.get(a)?.nodeType ?? ""] ?? 99) - (semanticTypePriority[nodeById.get(b)?.nodeType ?? ""] ?? 99)
      || (nodeById.get(a)?.name ?? a).localeCompare(nodeById.get(b)?.name ?? b, "zh-CN")
    )
    .slice(0, 12);
  const chosenSemanticIdSet = new Set(chosenSemanticIds);
  selectedProductIds.forEach((productId) => {
    attributeEdges.push(...semanticFactEdges
      .filter((edge) => edge.source === productId && chosenSemanticIdSet.has(edge.target))
      .sort((a, b) =>
        (semanticTargetUsage.get(b.target)?.size ?? 0) - (semanticTargetUsage.get(a.target)?.size ?? 0)
        || (semanticTypePriority[a.targetType] ?? 99) - (semanticTypePriority[b.targetType] ?? 99)
      )
      .slice(0, 4));
  });
  const relationPool = [
    ...approvedProductRelations,
    ...derivedCompatibilityEdges,
    ...derivedRecommendationEdges,
  ];
  const relationEdges: FrontendGraphEdge[] = [];
  const usedRelationKeys = new Set<string>();
  selectedProductIds.forEach((productId) => {
    const relation = relationPool
      .filter((edge) => edge.source === productId || edge.target === productId)
      .sort((a, b) => {
        const aOther = a.source === productId ? a.target : a.source;
        const bOther = b.source === productId ? b.target : b.source;
        return (
          Number(selectedProductIdSet.has(bOther)) - Number(selectedProductIdSet.has(aOther)) ||
          Number(b.relationLayer === "recommendation") - Number(a.relationLayer === "recommendation") ||
          a.edgeType.localeCompare(b.edgeType)
        );
      })
      .find((edge) => {
        const key = `${edge.source}|${edge.edgeType}|${edge.target}`;
        if (usedRelationKeys.has(key)) return false;
        usedRelationKeys.add(key);
        return true;
      });
    if (relation) relationEdges.push(relation);
  });

  const allEdges = [...hierarchyEdges, ...attributeEdges, ...relationEdges].filter(
    (edge, index, edges) =>
      edges.findIndex((candidate) =>
        candidate.source === edge.source && candidate.edgeType === edge.edgeType && candidate.target === edge.target
      ) === index
  );
  const semanticIds = uniq(
    attributeEdges.flatMap((edge) => {
      if (!["Product", "CoreFamily", "ProductForm", "SKU"].includes(edge.sourceType)) return [edge.source];
      if (!["Product", "CoreFamily", "ProductForm", "SKU"].includes(edge.targetType)) return [edge.target];
      return [];
    })
  ).slice(0, 14);
  const hierarchyIds = uniq(
    [...hierarchyEdges, ...attributeEdges]
      .flatMap((edge) => [edge.source, edge.target])
      .filter((id) => ["CoreFamily", "ProductForm"].includes(nodeById.get(id)?.nodeType ?? ""))
  ).slice(0, 6);
  const relationProductIds = uniq(
    relationEdges
      .flatMap((edge) => [edge.source, edge.target])
      .filter((id) => !selectedProductIdSet.has(id) && nodeById.get(id)?.nodeType === "Product")
  ).slice(0, 3);

  const productPositions = new Map<string, { x: number; y: number }>();
  selectedProductIds.forEach((id, index) => {
    const isRightColumn = index % 2 === 1;
    productPositions.set(id, {
      x: isRightColumn ? 442 : 198,
      y: 218 + Math.floor(index / 2) * 92 + (isRightColumn ? 46 : 0),
    });
  });
  const positions = mergePositions(
    productPositions,
    arcPositions(semanticIds, 226, Math.PI * 1.12, Math.PI * 1.88),
    linePositions(hierarchyIds, 520, 92),
    arcPositions(relationProductIds, 232, Math.PI * 0.02, Math.PI * 0.42)
  );
  const nodeIds = uniq([
    ...selectedProductIds,
    ...semanticIds,
    ...hierarchyIds,
    ...relationProductIds,
  ]);
  const nodeSet = new Set(nodeIds);
  const visibleEdges = allEdges.filter((edge) => nodeSet.has(edge.source) && nodeSet.has(edge.target));
  const nodes = nodeIds
    .map((id) => makeNode(id, positions))
    .filter((node): node is GraphNode => node !== null);
  const { edgeLabels, lines } = lineDataFromEdges(visibleEdges, positions);

  return {
    edgeLabels,
    lines,
    modeLabel: "推荐子图",
    nodes,
    summaryText: `推荐商品 ${selectedProducts.length} · 关键属性 ${semanticIds.length} · 已审核关系 ${relationEdges.length}`,
    viewBox: `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`,
  };
}
const hierarchyAncestorTypes = new Set(["CoreFamily", "OntologyDomain", "SemanticDomain", "NoteFamily", "ScentConcept", "ScentIdentity", "ProductForm"]);

function hierarchyAncestorIdsFor(nodeIds: string[]) {
  const result: string[] = [];
  const visited = new Set<string>();

  function visit(nodeId: string) {
    (edgesByTarget.get(nodeId) ?? [])
      .filter((edge) => hierarchyAncestorTypes.has(edge.sourceType))
      .forEach((edge) => {
        visit(edge.source);
        if (!visited.has(edge.source)) {
          visited.add(edge.source);
          result.push(edge.source);
        }
      });
  }

  nodeIds.forEach(visit);
  return result;
}

function buildFilteredGraph(filterNodeIds: string[], activeNodeId?: string | null): GraphDataset {
  const trail = getFilterTrail(filterNodeIds);
  const activeFocusId = activeNodeId && filterNodeIds.includes(activeNodeId) ? activeNodeId : filterNodeIds.at(-1) ?? undefined;
  const matchedProducts = productsForFilterIds(filterNodeIds);
  const productIds = matchedProducts.slice(0, 12).map((product) => product.id);
  const ancestorIds = hierarchyAncestorIdsFor(filterNodeIds);
  const pathIds = uniq([...ancestorIds, ...filterNodeIds]);
  const hasFamilyFilter = pathIds.some((id) => nodeById.get(id)?.nodeType === "CoreFamily");
  const hierarchyIds = hasFamilyFilter
    ? uniq(
        matchedProducts
          .map((product) => `form:${product.productForm}`)
          .filter((id) => nodeById.has(id) && !pathIds.includes(id))
      ).slice(0, 12)
    : [];

  const positions = mergePositions(
    linePositions(pathIds, 106, 118),
    arcPositions(hierarchyIds, 176, Math.PI * 0.76, Math.PI * 1.24),
    circlePositions(productIds, matchedProducts.length > 5 ? 150 : 124)
  );

  const nodeIds = uniq([...pathIds, ...hierarchyIds, ...productIds]);
  const nodeSet = new Set(nodeIds);
  const linesSource = graphEdges.filter(
    (edge) => nodeSet.has(edge.source) && nodeSet.has(edge.target) && !hiddenEdgeTypes.has(edge.edgeType)
  );

  const nodes = nodeIds.map((id) => makeNode(id, positions, activeFocusId)).filter((node): node is GraphNode => node !== null);
  const { edgeLabels, lines } = lineDataFromEdges(linesSource, positions);

  return {
    edgeLabels,
    focusLabel: activeFocusId,
    lines,
    modeLabel: trail.length > 1 ? "组合筛选" : `${trail[0]?.label ?? "筛选"}`,
    nodes,
    summaryText: `已选 ${trailText(filterNodeIds)} · 命中 ${matchedProducts.length} 商品${matchedProducts.length > productIds.length ? ` · 当前展示 ${productIds.length}` : ""}`,
    viewBox: `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`,
  };
}

function buildNeighborhoodGraph(focusId: string): GraphDataset {
  const focusNode = nodeById.get(focusId);
  if (!focusNode) {
    return buildOverviewGraph();
  }

  const directIds = directNeighborIds(focusId);
  if (focusNode.nodeType === "SemanticDomain") {
    const childIds = (edgesBySource.get(focusId) ?? [])
      .filter((edge) => edge.edgeType === "HAS_SEMANTIC_CONCEPT")
      .map((edge) => edge.target)
      .slice(0, 24);
    const leafIds = uniq(
      childIds.slice(0, 8).flatMap((childId) =>
        (edgesByTarget.get(childId) ?? [])
          .filter((edge) => edge.sourceType === "Product" && edge.reviewStatus === "approved")
          .slice(0, 1)
          .map((edge) => edge.source)
      )
    );
    const positions = mergePositions(
      linePositions([focusId], 78, 118),
      concentricPositions(childIds),
      circlePositions(leafIds, 278, -Math.PI / 2)
    );
    const nodeIds = uniq([focusId, ...childIds, ...leafIds]);
    const nodeSet = new Set(nodeIds);
    const linesSource = graphEdges.filter((edge) => nodeSet.has(edge.source) && nodeSet.has(edge.target));
    const nodes = nodeIds.map((id) => makeNode(id, positions, focusId)).filter((node): node is GraphNode => node !== null);
    const { edgeLabels, lines } = lineDataFromEdges(linesSource, positions);

    return {
      edgeLabels,
      focusLabel: focusId,
      lines,
      modeLabel: `${focusNode.name} 本体`,
      nodes,
      summaryText: `${focusNode.name} · 共享概念 ${childIds.length} · 商品叶子示例 ${leafIds.length}`,
      viewBox: `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`,
    };
  }
  if (focusNode.nodeType === "OntologyDomain") {
    const allChildIds = (edgesBySource.get(focusId) ?? []).map((edge) => edge.target);
    const identityChildIds = allChildIds.filter((id) => nodeById.get(id)?.nodeType === "ScentIdentity");
    const conceptChildIds = allChildIds.filter((id) => nodeById.get(id)?.nodeType === "ScentConcept");
    const childIds = identityChildIds.length ? identityChildIds : conceptChildIds.length ? conceptChildIds : allChildIds;
    const leafIds = uniq(
      childIds.flatMap((childId) =>
        [...(edgesBySource.get(childId) ?? []), ...(edgesByTarget.get(childId) ?? [])]
          .filter((edge) => edge.sourceType === "Product" || edge.targetType === "Product")
          .slice(0, 1)
          .map((edge) => edge.source === childId ? edge.target : edge.source)
      )
    );
    const positions = mergePositions(
      linePositions([focusId], 106, 118),
      arcPositions(childIds, 176, Math.PI * 0.76, Math.PI * 1.24),
      circlePositions(leafIds, 252, -Math.PI / 2)
    );
    const nodeIds = [focusId, ...childIds, ...leafIds];
    const nodeSet = new Set(nodeIds);
    const linesSource = graphEdges.filter((edge) => nodeSet.has(edge.source) && nodeSet.has(edge.target));
    const nodes = nodeIds.map((id) => makeNode(id, positions, focusId)).filter((node): node is GraphNode => node !== null);
    const { edgeLabels, lines } = lineDataFromEdges(linesSource, positions);

    return {
      edgeLabels,
      focusLabel: focusId,
      lines,
      modeLabel: `${focusNode.name} 分类`,
      nodes,
      summaryText: `${focusNode.name} · 二级香气身份 ${childIds.length} · 商品叶子示例 ${leafIds.length}`,
      viewBox: `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`,
    };
  }

  if (focusNode.nodeType === "NoteFamily") {
    const parentIds = (edgesByTarget.get(focusId) ?? [])
      .filter((edge) => edge.sourceType === "OntologyDomain")
      .map((edge) => edge.source);
    const allChildIds = (edgesBySource.get(focusId) ?? []).map((edge) => edge.target);
    const conceptChildIds = allChildIds.filter((id) => nodeById.get(id)?.nodeType === "ScentConcept");
    const childIds = conceptChildIds.length ? conceptChildIds : allChildIds;
    const productLeafIds = uniq(
      childIds.flatMap((childId) =>
        (edgesBySource.get(childId) ?? [])
          .filter((edge) => edge.targetType === "Product")
          .slice(0, 1)
          .map((edge) => edge.target)
      )
    ).slice(0, 20);
    const pathIds = [...parentIds, focusId];
    const positions = mergePositions(
      linePositions(pathIds, 72, 118),
      concentricPositions(childIds),
      circlePositions(productLeafIds, 282, -Math.PI / 2)
    );
    const nodeIds = [...pathIds, ...childIds, ...productLeafIds];
    const nodeSet = new Set(nodeIds);
    const linesSource = graphEdges.filter((edge) => nodeSet.has(edge.source) && nodeSet.has(edge.target));
    const nodes = nodeIds.map((id) => makeNode(id, positions, focusId)).filter((node): node is GraphNode => node !== null);
    const { edgeLabels, lines } = lineDataFromEdges(linesSource, positions);

    return {
      edgeLabels,
      focusLabel: focusId,
      lines,
      modeLabel: `${focusNode.name} 本体`,
      nodes,
      summaryText: `${parentIds.map((id) => nodeById.get(id)?.name).filter(Boolean).join(" > ")} > ${focusNode.name} · 具体香味 ${childIds.length} · 商品叶子 ${productLeafIds.length}`,
      viewBox: `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`,
    };
  }

  const linkedProducts = connectedProductsForNode(focusNode).slice(0, 5);
  const productIds = uniq([
    ...directIds.filter((id) => nodeById.get(id)?.nodeType === "Product"),
    ...linkedProducts.map((product) => product.id),
  ]).filter((id) => id !== focusId).slice(0, 5);

  const semanticIds = directIds
    .filter((id) => {
      const nodeType = nodeById.get(id)?.nodeType;
      return nodeType && nodeType !== "Product" && nodeType !== "SKU";
    })
    .slice(0, 12);

  const skuIds = directIds
    .filter((id) => nodeById.get(id)?.nodeType === "SKU")
    .slice(0, 6);

  const leftIds = semanticIds.filter((id) => {
    const nodeType = nodeById.get(id)?.nodeType;
    return nodeType === "CoreFamily" || nodeType === "ProductForm";
  });
  const topIds = semanticIds.filter((id) => {
    const nodeType = nodeById.get(id)?.nodeType;
    return ["CollectionOrScent", "ScentConcept", "ScentIdentity", "MaterialOrCraft", "NoteIngredient", "ScentProfile", "ScentAccord", "NoteFamily"].includes(nodeType ?? "");
  });
  const rightIds = semanticIds.filter((id) => {
    const nodeType = nodeById.get(id)?.nodeType;
    return nodeType === "MarketingTag" || nodeType === "VariantTag";
  });

  const positions = new Map<string, { x: number; y: number }>();
  positions.set(focusId, { x: VIEWBOX_CENTER_X, y: 258 });
  circlePositions(productIds, 164, -Math.PI / 2).forEach((value, key) => positions.set(key, value));
  arcPositions(leftIds, 218, Math.PI * 0.78, Math.PI * 1.22).forEach((value, key) => positions.set(key, value));
  arcPositions(topIds, 224, -Math.PI * 0.92, -Math.PI * 0.08).forEach((value, key) => positions.set(key, value));
  arcPositions(rightIds, 218, -0.18, 1.02).forEach((value, key) => positions.set(key, value));
  arcPositions(skuIds, 176, 0.74, 2.4).forEach((value, key) => positions.set(key, value));

  const nodeIds = uniq([focusId, ...productIds, ...leftIds, ...topIds, ...rightIds, ...skuIds]);
  const nodeSet = new Set(nodeIds);
  const linesSource = graphEdges.filter(
    (edge) => nodeSet.has(edge.source) && nodeSet.has(edge.target) && !hiddenEdgeTypes.has(edge.edgeType)
  );

  const nodes = nodeIds.map((id) => makeNode(id, positions, focusId)).filter((node): node is GraphNode => node !== null);
  const { edgeLabels, lines } = lineDataFromEdges(linesSource, positions);

  return {
    edgeLabels,
    focusLabel: focusId,
    lines,
    modeLabel: `${focusNode.displayLabel || focusNode.name} 关联`,
    nodes,
    summaryText: `${focusNode.nodeType} · 直接邻居 ${directIds.length} · 关联商品 ${linkedProducts.length}`,
    viewBox: `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`,
  };
}

function overviewNodeId(kind: string, value: string) {
  switch (kind) {
    case "family":
      return `family:${value}`;
    case "form":
      return `form:${value}`;
    case "collection":
      return `collection:${value}`;
    case "marketing":
      return `marketing_tag:${value}`;
    case "material":
      return `material:${value}`;
    default:
      return value;
  }
}

const allFamilies = uniq(products.map((product) => product.coreFamily).filter(Boolean));

function linkedProductCount(nodeId: string) {
  return uniq([
    ...(edgesBySource.get(nodeId) ?? []).filter((edge) => edge.targetType === "Product").map((edge) => edge.target),
    ...(edgesByTarget.get(nodeId) ?? []).filter((edge) => edge.sourceType === "Product").map((edge) => edge.source),
  ]).length;
}

function buildOverviewGraph(): GraphDataset {
  const familyIds = allFamilies.map((family) => overviewNodeId("family", family)).filter((id) => nodeById.has(id));
  const scentDomainIds = ["domain:香调"].filter((id) => nodeById.has(id));
  const semanticDomainIds = Array.from(nodeById.values())
    .filter((node) => node.nodeType === "SemanticDomain")
    .map((node) => node.id);
  const coreIds = [...familyIds, ...scentDomainIds, ...semanticDomainIds];
  const familyIdSet = new Set(familyIds);

  const allFormEdges = graphEdges.filter(
    (edge) => edge.edgeType === "HAS_PRODUCT_FORM"
      && edge.sourceType === "CoreFamily"
      && edge.targetType === "ProductForm"
      && familyIdSet.has(edge.source)
  );
  const formEdges = familyIds.flatMap((familyId) =>
    allFormEdges
      .filter((edge) => edge.source === familyId)
      .sort((a, b) => linkedProductCount(b.target) - linkedProductCount(a.target))
      .slice(0, 1)
  );
  const formIds = uniq(formEdges.map((edge) => edge.target));
  const allScentSecondaryEdges = graphEdges.filter((edge) =>
    schemaV1PreviewEnabled
      ? edge.edgeType === "HAS_SCENT_IDENTITY"
        && edge.source === "domain:香调"
        && edge.targetType === "ScentIdentity"
      : edge.edgeType === "HAS_NOTE_FAMILY"
        && edge.source === "domain:香调"
        && edge.targetType === "NoteFamily"
  );
  const scentSecondaryEdges = [...allScentSecondaryEdges]
    .sort((a, b) => linkedProductCount(b.target) - linkedProductCount(a.target))
    .slice(0, 2);
  const scentSecondaryIds = uniq(scentSecondaryEdges.map((edge) => edge.target));
  const semanticSecondaryEdges = semanticDomainIds.flatMap((domainId) =>
    (edgesBySource.get(domainId) ?? [])
      .filter((edge) => edge.edgeType === "HAS_SEMANTIC_CONCEPT")
      .sort((a, b) => linkedProductCount(b.target) - linkedProductCount(a.target))
      .slice(0, 2)
  );
  const semanticSecondaryIds = uniq(semanticSecondaryEdges.map((edge) => edge.target));
  const secondaryIds = [...formIds, ...scentSecondaryIds, ...semanticSecondaryIds];

  const positions = mergePositions(
    circlePositions(coreIds, coreIds.length > 8 ? 180 : 132),
    overviewSecondaryPositions(secondaryIds)
  );
  const overviewEdges = [...formEdges, ...scentSecondaryEdges, ...semanticSecondaryEdges];
  const nodes = Array.from(positions.keys()).map((id) => makeNode(id, positions)).filter((node): node is GraphNode => node !== null);
  const { edgeLabels, lines } = lineDataFromEdges(overviewEdges, positions);

  return {
    edgeLabels,
    lines,
    modeLabel: "分类概览",
    nodes,
    summaryText: `核心入口 ${coreIds.length} · 当前展示代表性下级 ${secondaryIds.length} · 点击入口查看完整分支`,
    viewBox: `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`,
  };
}
export const legendItems = [
  { color: nodeColorMap.CoreFamily, label: "商品大类" },
  { color: nodeColorMap.OntologyDomain, label: "香调入口" },
  ...(schemaV1PreviewEnabled
    ? [{ color: nodeColorMap.ScentIdentity, label: "香气身份" }]
    : [
        { color: nodeColorMap.NoteFamily, label: "香调家族" },
        { color: nodeColorMap.ScentConcept, label: "具体香味" },
        { color: nodeColorMap.CollectionOrScent, label: "系列/香型" },
      ]),
  { color: nodeColorMap.ProductForm, label: "具体品型" },
  ...(schemaV1PreviewEnabled
    ? [
        { color: nodeColorMap.Function, label: "功能" },
        { color: nodeColorMap.UseScene, label: "场景" },
        { color: nodeColorMap.UserNeed, label: "需求" },
        { color: nodeColorMap.CareInstruction, label: "保养" },
        { color: nodeColorMap.Material, label: "材质" },
      ]
    : [{ color: nodeColorMap.MaterialOrCraft, label: "材质/工艺" }]),
  { color: nodeColorMap.Product, label: "商品" },
  { color: nodeColorMap.SKU, label: "SKU" },
] as const;

export const defaultSuggestions = schemaV1PreviewEnabled
  ? ["功能有哪些？", "哪些产品适合旅行？", "香调有哪些香气身份？", "有哪些保养说明？"]
  : ["香调有哪些家族？", "晚香玉系列有哪些产品？", "哪些产品含有晚香玉？", "有哪些补充装？"];

export const initialMessages: KnowledgeMessage[] = [
  {
    id: "welcome",
    note: "支持按商品分类、系列、香材、气味类型、材质、标签和 SKU 继续追问",
    role: "bot",
    suggestions: defaultSuggestions,
    text: "欢迎使用 Diptyque 商品知识图谱。页面区分原始事实、规格兼容和经审核推荐关系；同名的系列、香材和气味类型会按查询口径区分。",
  },
];

const overviewDataset = buildOverviewGraph();

export function getGraphDataset(
  focusLabel: string | null,
  filterNodeIds: string[] = [],
  recommendationProductNames: string[] = []
): GraphDataset {
  if (recommendationProductNames.length) {
    return buildRecommendationGraph(recommendationProductNames);
  }
  if (focusLabel) {
    const node = nodeById.get(focusLabel);
    if (node?.nodeType === "Product") {
      return buildProductFocusGraph(node.id, filterNodeIds);
    }
  }

  if (filterNodeIds.length) {
    return buildFilteredGraph(filterNodeIds, focusLabel);
  }

  if (focusLabel) {
    const node = nodeById.get(focusLabel);
    if (!node) {
      const product = products.find((candidate) => candidate.name === focusLabel);
      return product ? buildProductFocusGraph(product.id) : overviewDataset;
    }
    return node.nodeType === "Product" ? buildProductFocusGraph(node.id) : buildNeighborhoodGraph(node.id);
  }

  return overviewDataset;
}
