import frontendData from "@/data/diptyque-frontend-data.json";

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
  const scentTerms = stringArray(args.scent_terms);
  const materials = stringArray(args.materials);
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
      if (!matchesAny(product.collections, collections)) return false;
      if (
        !matchesAny(
          [
            ...product.notes,
            ...product.scentProfiles,
            ...product.scentAccords,
            ...product.scentConcepts,
            ...product.noteFamilies,
          ],
          scentTerms
        )
      ) return false;
      if (!matchesAny(product.materials, materials)) return false;
      if (!matchesAny(product.marketingTags, marketingTags)) return false;
      if (!matchesAny(product.variantTags, variantTags)) return false;
      if (excludeRefills && product.variantTags.includes("补充装")) return false;
      const price = productPrice(product);
      if (minPrice != null && (price == null || price < minPrice)) return false;
      if (maxPrice != null && (price == null || price > maxPrice)) return false;
      const hasStructuredFilter = Boolean(
        requestedFamilies.length
        || requestedForms.length
        || collections.length
        || scentTerms.length
        || materials.length
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
  const ids = new Set(stringArray(args.product_ids).slice(0, 12));
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
                    ...product.noteFamilies,
                  ])
                )
              ).sort((a, b) => a.localeCompare(b, "zh-CN"))
            : dimension === "material"
              ? Array.from(new Set(products.flatMap((product) => product.materials))).sort((a, b) => a.localeCompare(b, "zh-CN"))
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
          collections: { type: "array", items: { type: "string" } },
          scent_terms: { type: "array", items: { type: "string" } },
          materials: { type: "array", items: { type: "string" } },
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
          product_ids: { type: "array", items: { type: "string" }, maxItems: 12 },
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
            enum: ["core_family", "product_form", "collection", "scent", "material"],
          },
        },
        required: ["dimension"],
        additionalProperties: false,
      },
    },
  },
];

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
