const PRODUCT_WORD_PATTERN = /产品|商品|香水/;
const LIST_REQUEST_PATTERN = /哪些|有什么|有哪|包括|列出|全部|所有|多少款|几款/;

const SCENT_FAMILY_CANONICAL: Record<string, string> = {
  花香调: "花香",
  木质香调: "木质",
  果香调: "果香",
  辛香调: "辛香",
  草本香调: "草本绿香",
  海洋香调: "海洋矿物",
};

function normalizeQueryText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[，。！？、,;；:：·\-—_|/]/g, "");
}

function scentScopeVariants(term: string) {
  const normalized = normalizeQueryText(term);
  const variants = [
    `${normalized}香味`,
    `${normalized}气味`,
    `${normalized}香调`,
    `${normalized}味`,
  ];
  if (normalized.endsWith("香")) variants.push(`${normalized}调`);
  Object.entries(SCENT_FAMILY_CANONICAL).forEach(([alias, canonical]) => {
    if (normalizeQueryText(canonical) === normalized) variants.push(normalizeQueryText(alias));
  });
  return variants;
}

export function normalizeScentCatalogTerm(term: string) {
  const trimmed = term.trim();
  return normalizeQueryText(SCENT_FAMILY_CANONICAL[trimmed] ?? trimmed.replace(/香调$/, ""));
}

export function extractScentCatalogTerm(query: string, vocabulary: string[]) {
  const normalizedQuery = normalizeQueryText(query);
  if (!PRODUCT_WORD_PATTERN.test(normalizedQuery) || !LIST_REQUEST_PATTERN.test(normalizedQuery)) return "";

  const candidates = Array.from(new Set(vocabulary.filter(Boolean)))
    .map((term) => ({
      term,
      normalizedTerm: normalizeScentCatalogTerm(term),
      scopeLength: Math.max(
        0,
        ...scentScopeVariants(term)
          .filter((variant) => normalizedQuery.includes(variant))
          .map((variant) => variant.length)
      ),
    }))
    .filter((candidate) => candidate.scopeLength > 0)
    .sort(
      (a, b) =>
        b.scopeLength - a.scopeLength ||
        b.normalizedTerm.length - a.normalizedTerm.length ||
        a.term.localeCompare(b.term, "zh-CN")
    );

  return candidates[0]?.term ?? "";
}

export function productMatchesScentCatalogTerm(
  product: { noteFamilies: string[]; scentConcepts: string[] },
  term: string
) {
  const normalizedTerm = normalizeScentCatalogTerm(term);
  return [...product.scentConcepts, ...product.noteFamilies].some(
    (value) => normalizeScentCatalogTerm(value) === normalizedTerm
  );
}
