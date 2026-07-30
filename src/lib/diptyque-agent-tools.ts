import frontendData from "@/data/diptyque-frontend-payload";
import type { DiptyqueQueryPlan } from "@/lib/diptyque-query-plan";

type Product = {
  id: string;
  name: string;
  identityName: string;
  coreFamily: string;
  productForm: string;
  collections: string[];
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
  materials: string[];
  marketingTags: string[];
  variantTags: string[];
  sizes: string[];
  priceMin: number | null;
  priceMax: number | null;
  description: string;
  storyText: string;
  subtitle: string;
  image: string;
  url: string;
  stockTotal: number;
};

type ProductEdge = {
  source: string;
  target: string;
  sourceName: string;
  targetName: string;
  sourceType: string;
  targetType: string;
  edgeType: string;
  relationLayer: string;
  reviewStatus: string;
  scenario: string;
  evidenceText: string;
  evidenceUrl: string;
};

type Payload = {
  products: Product[];
  graph: { edges: ProductEdge[] };
};

type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolExecution = {
  content: string;
  productIds: string[];
  summary: string;
  exactSelection?: {
    answer: string;
    answerMode: "price_search";
    productIds: string[];
  };
};

const payload = frontendData as Payload;
const products = payload.products;
const productById = new Map(products.map((product) => [product.id, product]));
const coreFamilies = Array.from(new Set(products.map((product) => product.coreFamily))).sort((a, b) =>
  a.localeCompare(b, "zh-CN")
);
const productForms = Array.from(new Set(products.map((product) => product.productForm))).sort((a, b) =>
  a.localeCompare(b, "zh-CN")
);

const familyAliases: Record<string, string[]> = {
  家居: ["家居香氛", "艺术家居"],
  家居产品: ["家居香氛", "艺术家居"],
  家居用品: ["家居香氛", "艺术家居"],
  香水: ["个人香氛"],
  文创用品: ["文创"],
  家居装饰: ["艺术家居"],
};

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[，。！？、,;；:：·\-—_|/]/g, "");
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function productPrice(product: Product) {
  return product.priceMin ?? product.priceMax;
}

function productMatchesExcludedScent(product: Product, excludedTerms: string[]) {
  const scentValues = [
    product.name,
    ...product.collections,
    ...product.notes,
    ...product.scentProfiles,
    ...product.scentAccords,
    ...product.scentConcepts,
    ...product.noteFamilies,
  ].map(normalize);
  return excludedTerms.some((term) => {
    const normalizedTerm = normalize(term);
    return normalizedTerm && scentValues.some((value) => value.includes(normalizedTerm));
  });
}

function compactProduct(product: Product) {
  return {
    id: product.id,
    name: product.name,
    coreFamily: product.coreFamily,
    productForm: product.productForm,
    collections: product.collections,
    notes: product.notes,
    scentProfiles: product.scentProfiles,
    scentAccords: product.scentAccords,
    scentConcepts: product.scentConcepts,
    scentIdentities: product.scentIdentities ?? [],
    semanticFacts: product.semanticFacts ?? {},
    noteFamilies: product.noteFamilies,
    materials: product.materials,
    marketingTags: product.marketingTags,
    variantTags: product.variantTags,
    sizes: product.sizes,
    priceMin: product.priceMin,
    priceMax: product.priceMax,
    stockTotal: product.stockTotal,
    url: product.url,
  };
}

function matchesAny(values: string[], requested: string[]) {
  if (!requested.length) return true;
  const normalizedValues = values.map(normalize);
  return requested.some((term) => {
    const normalizedTerm = normalize(term);
    return normalizedValues.some(
      (value) => value === normalizedTerm || value.includes(normalizedTerm) || normalizedTerm.includes(value)
    );
  });
}

function expandFamilies(requested: string[]) {
  return Array.from(new Set(requested.flatMap((family) => familyAliases[family] ?? [family])));
}

function queryScore(product: Product, query: string) {
  if (!query.trim()) return 0;
  const normalizedQuery = normalize(query);
  const fields = [
    product.name,
    product.identityName,
    product.coreFamily,
    product.productForm,
    ...product.collections,
    ...product.notes,
    ...product.scentProfiles,
    ...product.scentAccords,
    ...product.scentConcepts,
    ...(product.scentIdentities ?? []).flatMap((identity) => [identity.name, ...(identity.aliases ?? [])]),
    ...Object.values(product.semanticFacts ?? {}).flat(),
    ...product.noteFamilies,
    ...product.materials,
    ...product.marketingTags,
    ...product.variantTags,
  ].map(normalize).filter((value) => value.length >= 2);

  return fields.reduce((score, field) => {
    if (normalizedQuery === field) return score + 12;
    if (normalizedQuery.includes(field)) return score + Math.min(8, field.length);
    if (field.includes(normalizedQuery) && normalizedQuery.length >= 2) return score + 5;
    return score;
  }, 0);
}

function searchProducts(args: Record<string, unknown>): ToolExecution {
  const query = typeof args.query === "string" ? args.query : "";
  const requestedFamilies = expandFamilies(stringArray(args.core_families));
  const requestedForms = stringArray(args.product_forms);
  const collections = stringArray(args.collections);
  const excludedCollections = stringArray(args.exclude_collections);
  const excludedForms = stringArray(args.exclude_product_forms);
  const scentTerms = stringArray(args.scent_terms);
  const requestedSizes = stringArray(args.sizes).map(normalize);
  const materials = stringArray(args.materials);
  const functions = stringArray(args.functions);
  const scenes = stringArray(args.scenes);
  const userNeeds = stringArray(args.user_needs);
  const careInstructions = stringArray(args.care_instructions);
  const marketingTags = stringArray(args.marketing_tags);
  const variantTags = stringArray(args.variant_tags);
  const minPrice = numberValue(args.min_price);
  const maxPrice = numberValue(args.max_price);
  const excludeRefills = args.exclude_refills === true;
  const sort = typeof args.sort === "string" ? args.sort : "relevance";
  const limit = Math.min(100, Math.max(1, Math.floor(numberValue(args.limit) ?? 40)));

  const ranked = products
    .map((product) => ({ product, score: queryScore(product, query) }))
    .filter(({ product, score }) => {
      if (requestedFamilies.length && !requestedFamilies.includes(product.coreFamily)) return false;
      if (!matchesAny([product.productForm], requestedForms)) return false;
      if (requestedSizes.length && !product.sizes.some((size) => requestedSizes.includes(normalize(size)))) return false;
      if (excludedForms.includes(product.productForm)) return false;
      if (!matchesAny(product.collections, collections)) return false;
      if (productMatchesExcludedScent(product, excludedCollections)) return false;
      if (
        !matchesAny(
          [
            ...product.notes,
            ...product.scentProfiles,
            ...product.scentAccords,
            ...product.scentConcepts,
            ...(product.scentIdentities ?? []).flatMap((identity) => [identity.name, ...(identity.aliases ?? [])]),
            ...product.noteFamilies,
          ],
          scentTerms
        )
      ) return false;
      if (!matchesAny([...product.materials, ...(product.semanticFacts?.semanticMaterials ?? [])], materials)) return false;
      if (!matchesAny(product.semanticFacts?.functions ?? [], functions)) return false;
      if (!matchesAny(product.semanticFacts?.scenes ?? [], scenes)) return false;
      if (!matchesAny(product.semanticFacts?.userNeeds ?? [], userNeeds)) return false;
      if (!matchesAny(product.semanticFacts?.careInstructions ?? [], careInstructions)) return false;
      if (!matchesAny(product.marketingTags, marketingTags)) return false;
      if (!matchesAny(product.variantTags, variantTags)) return false;
      if (excludeRefills && product.variantTags.includes("补充装")) return false;
      const price = productPrice(product);
      if (minPrice != null && (price == null || price < minPrice)) return false;
      if (maxPrice != null && (price == null || price > maxPrice)) return false;
      const hasStructuredFilter = Boolean(
        requestedFamilies.length
        || requestedForms.length
        || requestedSizes.length
        || collections.length
        || scentTerms.length
        || materials.length
        || functions.length
        || scenes.length
        || userNeeds.length
        || careInstructions.length
        || marketingTags.length
        || variantTags.length
        || minPrice != null
        || maxPrice != null
      );
      return hasStructuredFilter || !query || score > 0;
    })
    .sort((a, b) => {
      const priceA = productPrice(a.product) ?? Number.MAX_SAFE_INTEGER;
      const priceB = productPrice(b.product) ?? Number.MAX_SAFE_INTEGER;
      if (sort === "price_asc") return priceA - priceB || a.product.name.localeCompare(b.product.name, "zh-CN");
      if (sort === "price_desc") return priceB - priceA || a.product.name.localeCompare(b.product.name, "zh-CN");
      return b.score - a.score || priceA - priceB || a.product.name.localeCompare(b.product.name, "zh-CN");
    });

  const selected = ranked.slice(0, limit).map(({ product }) => product);
  const exactPriceProduct = (sort === "price_asc" || sort === "price_desc") && limit <= 3
    ? selected[0]
    : undefined;
  const exactPrice = exactPriceProduct ? productPrice(exactPriceProduct) : null;
  const exactSelection = exactPriceProduct && exactPrice != null
    ? {
        answer: `按当前筛选条件，价格${sort === "price_asc" ? "最低" : "最高"}的商品是${exactPriceProduct.name}，价格为 ¥${exactPrice}。`,
        answerMode: "price_search" as const,
        productIds: [exactPriceProduct.id],
      }
    : undefined;
  return {
    content: JSON.stringify({
      total: ranked.length,
      returned: selected.length,
      truncated: ranked.length > selected.length,
      products: selected.map(compactProduct),
    }),
    productIds: selected.map((product) => product.id),
    summary: [
      "search_products",
      "total=" + ranked.length,
      "returned=" + selected.length,
      "sort=" + sort,
      minPrice != null ? "minPrice=" + minPrice : "",
      maxPrice != null ? "maxPrice=" + maxPrice : "",
      requestedFamilies.length ? "families=" + requestedFamilies.join("|") : "",
    ].filter(Boolean).join(" "),
    exactSelection,
  };
}

function selectDiverseGiftProducts(candidates: Product[], limit: number) {
  const ranked = [...candidates].sort((a, b) => {
    const availability = Number(b.stockTotal > 0) - Number(a.stockTotal > 0);
    const popularity =
      Number(b.marketingTags.includes("人气精选")) - Number(a.marketingTags.includes("人气精选"));
    return availability
      || popularity
      || (productPrice(a) ?? Number.MAX_SAFE_INTEGER) - (productPrice(b) ?? Number.MAX_SAFE_INTEGER)
      || a.name.localeCompare(b.name, "zh-CN");
  });
  const selected: Product[] = [];
  const selectedIds = new Set<string>();
  const usedFamilies = new Set<string>();
  const usedForms = new Set<string>();

  const take = (product: Product) => {
    if (selected.length >= limit || selectedIds.has(product.id)) return;
    selected.push(product);
    selectedIds.add(product.id);
    usedFamilies.add(product.coreFamily);
    usedForms.add(product.productForm);
  };

  ranked.forEach((product) => {
    if (!usedFamilies.has(product.coreFamily)) take(product);
  });
  ranked.forEach((product) => {
    if (!usedForms.has(product.productForm)) take(product);
  });
  ranked.forEach(take);
  return selected;
}

function searchGiftCandidates(args: Record<string, unknown>): ToolExecution {
  const requestedFamilies = expandFamilies(stringArray(args.core_families));
  const excludedCollections = stringArray(args.exclude_collections);
  const excludedForms = stringArray(args.exclude_product_forms);
  const maxPrice = numberValue(args.max_price);
  const limit = Math.min(5, Math.max(3, Math.floor(numberValue(args.limit) ?? 5)));
  const eligible = products.filter((product) => {
    if (!product.marketingTags.includes("臻选礼赠")) return false;
    if (product.variantTags.includes("补充装")) return false;
    if (requestedFamilies.length && !requestedFamilies.includes(product.coreFamily)) return false;
    if (excludedForms.includes(product.productForm)) return false;
    if (productMatchesExcludedScent(product, excludedCollections)) return false;
    const price = productPrice(product);
    if (maxPrice != null && (price == null || price > maxPrice)) return false;
    return true;
  });
  const inStock = eligible.filter((product) => product.stockTotal > 0);
  const pool = inStock.length >= Math.min(5, limit) ? inStock : eligible;
  const selected = selectDiverseGiftProducts(pool, limit);
  return {
    content: JSON.stringify({
      total: eligible.length,
      returned: selected.length,
      selectionPolicy: "official_gifting_tag_non_refill_diverse_family_and_form",
      products: selected.map(compactProduct),
    }),
    productIds: selected.map((product) => product.id),
    summary: [
      "search_gift_candidates",
      "total=" + eligible.length,
      "returned=" + selected.length,
      maxPrice != null ? "maxPrice=" + maxPrice : "",
      requestedFamilies.length ? "families=" + requestedFamilies.join("|") : "",
    ].filter(Boolean).join(" "),
  };
}

function formatGiftPrice(product: Product) {
  if (product.priceMin == null && product.priceMax == null) return "价格待确认";
  if (product.priceMin != null && product.priceMax != null && product.priceMin !== product.priceMax) {
    return "¥" + product.priceMin + "-" + product.priceMax;
  }
  return "¥" + (product.priceMin ?? product.priceMax);
}

export function buildGiftFallbackRecommendation(options: {
  coreFamilies?: string[];
  excludedCollections?: string[];
  excludedProductForms?: string[];
  maxPrice?: number;
} = {}) {
  const selected = selectDiverseGiftProducts(
    products.filter((product) => {
      if (!product.marketingTags.includes("臻选礼赠")) return false;
      if (product.variantTags.includes("补充装") || product.stockTotal <= 0) return false;
      if (options.coreFamilies?.length && !options.coreFamilies.includes(product.coreFamily)) return false;
      if (options.excludedProductForms?.includes(product.productForm)) return false;
      if (productMatchesExcludedScent(product, options.excludedCollections ?? [])) return false;
      const price = productPrice(product);
      return options.maxPrice == null || (price != null && price <= options.maxPrice);
    }),
    5
  );
  const lines = selected.map((product, index) => {
    const evidence = [
      product.coreFamily,
      product.productForm,
      product.collections[0],
      product.notes[0],
      product.materials[0],
    ].filter(Boolean).slice(0, 4).join(" / ");
    return (index + 1) + ". " + product.name + "（" + formatGiftPrice(product) + "）- " + evidence;
  });
  return {
    answer: [
      "我先按当前图谱中的“臻选礼赠”标签、在售状态和商品资料，给你几个不同方向的选择：",
      ...lines,
      "你可以再告诉我更具体的送礼对象、预算，以及更偏向香水、身体护理还是家居用品，我会继续缩小范围。",
    ].join("\n"),
    answerMode: "gift_recommendation",
    matchedProductIds: selected.map((product) => product.id),
    selectedProductIds: selected.map((product) => product.id),
  };
}

function getProductDetails(args: Record<string, unknown>): ToolExecution {
  const ids = stringArray(args.product_ids).slice(0, 12);
  const selected = ids.map((id) => productById.get(id)).filter((product): product is Product => Boolean(product));
  return {
    content: JSON.stringify({
      products: selected.map((product) => ({
        ...compactProduct(product),
        subtitle: product.subtitle,
        description: product.description,
        storyText: product.storyText.slice(0, 700),
        image: product.image,
      })),
    }),
    productIds: selected.map((product) => product.id),
    summary: "get_product_details returned=" + selected.length,
  };
}

function getProductRelations(args: Record<string, unknown>): ToolExecution {
  const ids = new Set(stringArray(args.product_ids).slice(0, 100));
  const relationTypes = new Set(stringArray(args.relation_types));
  const relations = payload.graph.edges
    .filter(
      (edge) =>
        edge.sourceType === "Product"
        && edge.targetType === "Product"
        && edge.reviewStatus === "approved"
        && (ids.has(edge.source) || ids.has(edge.target))
        && (!relationTypes.size || relationTypes.has(edge.edgeType))
    )
    .slice(0, 60);
  const productIds = Array.from(
    new Set(relations.flatMap((edge) => [edge.source, edge.target]).filter((id) => productById.has(id)))
  );
  return {
    content: JSON.stringify({
      relations: relations.map((edge) => ({
        sourceId: edge.source,
        sourceName: edge.sourceName,
        targetId: edge.target,
        targetName: edge.targetName,
        relationType: edge.edgeType,
        relationLayer: edge.relationLayer,
        scenario: edge.scenario,
        evidence: edge.evidenceText,
        evidenceUrl: edge.evidenceUrl,
      })),
    }),
    productIds,
    summary: "get_product_relations returned=" + relations.length,
  };
}

function listCatalogValues(args: Record<string, unknown>): ToolExecution {
  const dimension = typeof args.dimension === "string" ? args.dimension : "";
  const values =
    dimension === "core_family"
      ? coreFamilies
      : dimension === "product_form"
        ? productForms
        : dimension === "collection"
          ? Array.from(new Set(products.flatMap((product) => product.collections))).sort((a, b) => a.localeCompare(b, "zh-CN"))
          : dimension === "scent"
            ? Array.from(
                new Set(
                  products.flatMap((product) => [
                    ...product.notes,
                    ...product.scentProfiles,
                    ...product.scentAccords,
                    ...product.scentConcepts,
                    ...(product.scentIdentities ?? []).flatMap((identity) => [identity.name, ...(identity.aliases ?? [])]),
                    ...product.noteFamilies,
                  ])
                )
              ).sort((a, b) => a.localeCompare(b, "zh-CN"))
            : dimension === "material"
              ? Array.from(new Set(products.flatMap((product) => [...product.materials, ...(product.semanticFacts?.semanticMaterials ?? [])]))).sort((a, b) => a.localeCompare(b, "zh-CN"))
              : dimension === "function"
                ? Array.from(new Set(products.flatMap((product) => product.semanticFacts?.functions ?? []))).sort((a, b) => a.localeCompare(b, "zh-CN"))
                : dimension === "scene"
                  ? Array.from(new Set(products.flatMap((product) => product.semanticFacts?.scenes ?? []))).sort((a, b) => a.localeCompare(b, "zh-CN"))
                  : dimension === "user_need"
                    ? Array.from(new Set(products.flatMap((product) => product.semanticFacts?.userNeeds ?? []))).sort((a, b) => a.localeCompare(b, "zh-CN"))
                    : dimension === "care_instruction"
                      ? Array.from(new Set(products.flatMap((product) => product.semanticFacts?.careInstructions ?? []))).sort((a, b) => a.localeCompare(b, "zh-CN"))
                      : [];
  return {
    content: JSON.stringify({ dimension, values }),
    productIds: [],
    summary: "list_catalog_values dimension=" + dimension + " returned=" + values.length,
  };
}

export const diptyqueAgentTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Search the complete Diptyque product catalog using structured filters. Use conversation context to carry forward active category or product-form constraints unless the user changes them.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Short semantic search phrase when structured filters are insufficient." },
          core_families: { type: "array", items: { type: "string", enum: coreFamilies } },
          product_forms: { type: "array", items: { type: "string" } },
          sizes: { type: "array", items: { type: "string" } },
          collections: { type: "array", items: { type: "string" } },
          exclude_collections: { type: "array", items: { type: "string" } },
          exclude_product_forms: { type: "array", items: { type: "string" } },
          scent_terms: { type: "array", items: { type: "string" } },
          materials: { type: "array", items: { type: "string" } },
          functions: { type: "array", items: { type: "string" } },
          scenes: { type: "array", items: { type: "string" } },
          user_needs: { type: "array", items: { type: "string" } },
          care_instructions: { type: "array", items: { type: "string" } },
          marketing_tags: { type: "array", items: { type: "string" } },
          variant_tags: { type: "array", items: { type: "string" } },
          min_price: { type: "number" },
          max_price: { type: "number" },
          exclude_refills: { type: "boolean" },
          sort: { type: "string", enum: ["relevance", "price_asc", "price_desc"] },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_gift_candidates",
      description:
        "Retrieve diverse, in-stock, non-refill products supported by the official gifting tag. Use this first for vague gifting questions, then ask for recipient, budget or category preferences after presenting useful candidates.",
      parameters: {
        type: "object",
        properties: {
          core_families: { type: "array", items: { type: "string", enum: coreFamilies } },
          exclude_collections: { type: "array", items: { type: "string" } },
          exclude_product_forms: { type: "array", items: { type: "string" } },
          max_price: { type: "number" },
          limit: { type: "integer", minimum: 3, maximum: 5 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_product_details",
      description: "Get detailed factual fields for selected products before explaining or recommending them.",
      parameters: {
        type: "object",
        properties: {
          product_ids: { type: "array", items: { type: "string" }, maxItems: 12 },
        },
        required: ["product_ids"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_product_relations",
      description:
        "Get approved direct product relations such as pairing, layering, refill, accessory, set membership or gift combinations. Do not infer a relation from shared attributes.",
      parameters: {
        type: "object",
        properties: {
          product_ids: { type: "array", items: { type: "string" }, maxItems: 100 },
          relation_types: { type: "array", items: { type: "string" } },
        },
        required: ["product_ids"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_catalog_values",
      description: "List valid ontology values when a user's term is ambiguous or a filter value is unknown.",
      parameters: {
        type: "object",
        properties: {
          dimension: {
            type: "string",
            enum: ["core_family", "product_form", "collection", "scent", "material", "function", "scene", "user_need", "care_instruction"],
          },
        },
        required: ["dimension"],
        additionalProperties: false,
      },
    },
  },
];

export type PlannedRetrieval = {
  answerMode: "gift_recommendation" | "price_search" | "product_search" | "relation_search";
  content: string;
  exactSelection?: ToolExecution["exactSelection"];
  fallbackAnswer: string;
  productIds: string[];
  selectedProductIds: string[];
  toolTrace: string[];
};

function plannedFallback(
  plan: DiptyqueQueryPlan,
  primary: ToolExecution,
  relationExecution?: ToolExecution
) {
  if (primary.exactSelection) {
    return {
      answer: primary.exactSelection.answer,
      answerMode: "price_search" as const,
      selectedProductIds: primary.exactSelection.productIds,
    };
  }
  const primaryProducts = primary.productIds
    .map((id) => productById.get(id))
    .filter((product): product is Product => Boolean(product));
  if (
    plan.relationIntent === "series_membership"
    && !plan.constraints.collections.length
    && /搭配关系|同系列关系|应该理解/.test(plan.currentQuery)
  ) {
    return {
      answer: "同一个香味下的香水、身体乳和护手霜应理解为共享同一香味身份的同系列商品，不自动构成搭配关系。只有存在官方文案或已审核关系证据时，才能另外标记为搭配或叠香。",
      answerMode: "relation_search" as const,
      selectedProductIds: [],
    };
  }
  if (plan.relationIntent === "series_membership") {
    const scope = plan.constraints.collections.join(" / ") || "当前香味";
    return {
      answer: primaryProducts.length
        ? `${scope}同系列且符合当前条件的产品共${primaryProducts.length}款：${primaryProducts.map((product) => product.name).join("、")}。`
        : `当前商品资料中没有找到${scope}同系列且符合条件的产品。`,
      answerMode: "relation_search" as const,
      selectedProductIds: primary.productIds.slice(0, 5),
    };
  }
  if (plan.intent === "relation") {
    const relationData = relationExecution
      ? JSON.parse(relationExecution.content) as {
          relations?: Array<{ evidence?: string; relationType: string; sourceName: string; targetName: string }>;
        }
      : {};
    const relations = relationData.relations ?? [];
    const relationLabel = plan.relationIntent === "layering"
      ? "叠香"
      : plan.relationIntent === "accessory"
        ? "配件"
        : plan.relationIntent === "refill_compatibility"
          ? "补充装适配"
          : "搭配";
    return {
      answer: relations.length
        ? `当前已审核的${relationLabel}关系：${relations.map((relation) =>
            `${relation.sourceName}与${relation.targetName}${relation.evidence ? `（依据：${relation.evidence}）` : ""}`
          ).join("；")}。`
        : `当前已审核商品关系中没有找到符合条件的${relationLabel}关系，因此不能根据同系列、同香材或名称相似自行推断。`,
      answerMode: "relation_search" as const,
      selectedProductIds: (relationExecution?.productIds ?? primary.productIds).slice(0, 5),
    };
  }
  if (/容量|规格|尺寸/.test(plan.currentQuery) && primaryProducts.some((product) => product.sizes.length)) {
    const productsWithSizes = primaryProducts.filter((product) => product.sizes.length);
    return {
      answer: productsWithSizes.map((product) =>
        `${product.name}在当前商品记录中可确认的规格为：${product.sizes.join("、")}`
      ).join("；") + "。",
      answerMode: "product_search" as const,
      selectedProductIds: productsWithSizes.slice(0, 5).map((product) => product.id),
    };
  }
  if (plan.constraints.variantTags.includes("补充装")) {
    return {
      answer: primaryProducts.length
        ? `当前商品记录中找到${primaryProducts.length}款真正的补充装：${primaryProducts.map((product) => product.name).join("、")}。`
        : "当前商品记录中没有找到符合条件的真正补充装。",
      answerMode: "product_search" as const,
      selectedProductIds: primary.productIds.slice(0, 5),
    };
  }
  if (plan.intent === "catalog") {
    return {
      answer: primaryProducts.length
        ? `符合当前条件的产品共${primaryProducts.length}款：${primaryProducts.map((product) => product.name).join("、")}。`
        : "当前商品资料中没有找到符合全部条件的产品。",
      answerMode: "product_search" as const,
      selectedProductIds: [],
    };
  }
  if (/含有|包含|真的含/.test(plan.currentQuery) && primaryProducts.length === 1) {
    const product = primaryProducts[0];
    const evidenceTerms = Array.from(new Set([
      ...product.notes,
      ...product.scentConcepts,
      ...product.noteFamilies,
    ])).filter((term) => term && plan.currentQuery.includes(term));
    if (evidenceTerms.length) {
      return {
        answer: `${product.name}的商品数据中明确记录了${evidenceTerms.join("、")}，因此可以确认包含${evidenceTerms.join("、")}。`,
        answerMode: "product_search" as const,
        selectedProductIds: primary.productIds,
      };
    }
  }
  const recommendationLimit = plan.recommendationLimit ?? 5;
  return {
    answer: primaryProducts.length
      ? `已按当前硬性条件检索到${primaryProducts.length}款候选：${primaryProducts.slice(0, recommendationLimit).map((product) => product.name).join("、")}。当前无法完成需要官方文案支持的主观比较，因此不额外推断气味感受或适用场景。`
      : "按当前全部硬性条件检索结果为0款；没有符合条件的商品，因此不放宽条件另行推荐。",
    answerMode: plan.intent === "gifting" ? "gift_recommendation" as const : "product_search" as const,
    selectedProductIds: primary.productIds.slice(0, recommendationLimit),
  };
}

export function executeDiptyqueQueryPlan(plan: DiptyqueQueryPlan): PlannedRetrieval {
  const constraints = plan.constraints;
  const commonArgs = {
    core_families: constraints.coreFamilies,
    collections: constraints.collections,
    exclude_collections: constraints.excludedCollections,
    exclude_product_forms: constraints.excludedProductForms,
    product_forms: constraints.productForms,
    sizes: constraints.sizes,
    variant_tags: constraints.variantTags,
    exclude_refills: constraints.excludeRefills,
    max_price: constraints.maxPrice,
  };
  const executions: Array<{ label: string; result: ToolExecution }> = [];
  const cheapest = /最低|最便宜/.test(plan.currentQuery);
  const primary = plan.intent === "gifting"
    ? searchGiftCandidates({
        core_families: constraints.coreFamilies,
        exclude_collections: constraints.excludedCollections,
        exclude_product_forms: constraints.excludedProductForms,
        max_price: constraints.maxPrice,
        limit: 5,
      })
    : searchProducts({
        ...commonArgs,
        query: cheapest || plan.softPreferences.length ? "" : plan.currentQuery,
        limit: cheapest ? 3 : plan.intent === "catalog" || plan.intent === "relation" || plan.softPreferences.length ? 100 : 30,
        sort: cheapest ? "price_asc" : "relevance",
      });
  executions.push({ label: "PLANNED_PRODUCT_SEARCH", result: primary });

  let relationExecution: ToolExecution | undefined;
  if (plan.intent === "relation" && plan.relationTypes.length && primary.productIds.length) {
    relationExecution = getProductRelations({
      product_ids: primary.productIds,
      relation_types: plan.relationTypes,
    });
    executions.push({ label: "PLANNED_APPROVED_RELATIONS", result: relationExecution });
  }
  if (plan.requiresEvidence && primary.productIds.length) {
    executions.push({
      label: "PLANNED_PRODUCT_DETAILS",
      result: getProductDetails({ product_ids: primary.productIds.slice(0, 12) }),
    });
  }

  const fallback = plannedFallback(plan, primary, relationExecution);
  return {
    answerMode: fallback.answerMode,
    content: executions.map(({ label, result }) => `${label}\n${result.content}`).join("\n\n"),
    exactSelection: primary.exactSelection,
    fallbackAnswer: fallback.answer,
    productIds: Array.from(new Set(executions.flatMap(({ result }) => result.productIds))),
    selectedProductIds: fallback.selectedProductIds,
    toolTrace: executions.map(({ result }) => "query_plan " + result.summary),
  };
}
export function executeDiptyqueTool(name: string, rawArguments: string): ToolExecution {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArguments) as Record<string, unknown>;
  } catch {
    return {
      content: JSON.stringify({ error: "invalid_tool_arguments" }),
      productIds: [],
      summary: name + " invalid_arguments",
    };
  }

  if (name === "search_products") return searchProducts(args);
  if (name === "search_gift_candidates") return searchGiftCandidates(args);
  if (name === "get_product_details") return getProductDetails(args);
  if (name === "get_product_relations") return getProductRelations(args);
  if (name === "list_catalog_values") return listCatalogValues(args);
  return {
    content: JSON.stringify({ error: "unknown_tool" }),
    productIds: [],
    summary: name + " unknown_tool",
  };
}

export function productNamesByIds(ids: string[]) {
  return Array.from(new Set(ids))
    .map((id) => productById.get(id)?.name)
    .filter((name): name is string => Boolean(name));
}

export function productIdsMentionedInAnswer(answer: string, candidateIds: string[]) {
  return Array.from(new Set(candidateIds)).filter((id) => {
    const product = productById.get(id);
    return product ? answer.includes(product.name) : false;
  });
}
