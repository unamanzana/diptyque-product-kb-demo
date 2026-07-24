const PRODUCT_WORD_PATTERN = /产品|商品|香水/;
const LIST_REQUEST_PATTERN = /哪些|有什么|有哪|包括|列出|全部|所有|多少款|几款/;
const PRODUCT_ATTRIBUTE_QUESTION_PATTERN = /(?:哪些|什么|有何)(?:香调|香味|气味|香材|成分|材质|规格|尺寸|价格)|(?:香调|香味|气味|香材|成分|材质|规格|尺寸|价格)(?:有哪些|是什么|如何|怎么样)/;
const DIRECT_GIFT_PATTERN = /送礼|礼赠|礼物|礼品|赠礼|伴手礼|送人|赠送|送给|作为礼物|当礼物/;
const GIFT_RECIPIENT_PATTERN = /家人|亲人|长辈|父母|爸妈|妈妈|爸爸|母亲|父亲|岳父|岳母|朋友|同事|客户|领导|老师|爱人|伴侣|男朋友|女朋友|男友|女友|丈夫|妻子|老公|老婆/;
const GIFT_OCCASION_PATTERN = /生日|纪念日|母亲节|父亲节|教师节|情人节|春节|新年|乔迁|婚礼|节日/;
const GIFT_CHOICE_PATTERN = /推荐|选|挑|买|送|合适|适合|哪款|哪个好|什么/;
const OPEN_GIFT_REQUEST_PATTERN = /(?:可以|想|要|适合)?(?:送|赠)(?:给)?[^，。！？]{0,12}(?:什么|哪款|哪种|哪个好|合适|适合|推荐)/;

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

export function extractGiftBudgetCeiling(query: string) {
  const normalizedQuery = query.replace(/,/g, "").replace(/\s+/g, "");
  const prefixMatch = normalizedQuery.match(
    /(?:预算|不超过|不高于|最高)[¥￥]?(\d+(?:\.\d+)?)/
  );
  const suffixMatch = normalizedQuery.match(
    /[¥￥]?(\d+(?:\.\d+)?)元?(?:以内|以下|之内)/
  );
  const value = Number(prefixMatch?.[1] ?? suffixMatch?.[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function isGiftRecommendationQuery(query: string) {
  const normalizedQuery = normalizeQueryText(query);
  if (DIRECT_GIFT_PATTERN.test(normalizedQuery)) return true;
  if (OPEN_GIFT_REQUEST_PATTERN.test(normalizedQuery)) return true;
  if (GIFT_RECIPIENT_PATTERN.test(normalizedQuery) && GIFT_CHOICE_PATTERN.test(normalizedQuery)) return true;
  return GIFT_OCCASION_PATTERN.test(normalizedQuery) && GIFT_CHOICE_PATTERN.test(normalizedQuery);
}

export type ProductCatalogScope = {
  coreFamilies: string[];
  label: string;
  productForms: string[];
};

type ProductCatalogVocabulary = {
  coreFamilies: string[];
  productForms: string[];
};

const PRODUCT_CATALOG_ALIASES: Array<{
  coreFamilies: string[];
  label: string;
  pattern: RegExp;
  productForms?: string[];
}> = [
  {
    coreFamilies: ["家居香氛", "艺术家居"],
    label: "家居用品",
    pattern: /家居用品|家居产品|家居类/,
  },
  {
    coreFamilies: ["个人香氛"],
    label: "香水",
    pattern: /香水/,
    productForms: ["淡香水", "淡香精"],
  },
  {
    coreFamilies: ["家居香氛"],
    label: "香氛蜡烛",
    pattern: /香氛蜡烛|蜡烛/,
    productForms: [
      "迷你香氛蜡烛",
      "经典香氛蜡烛",
      "中号香氛蜡烛",
      "大号香氛蜡烛",
      "超大号香氛蜡烛",
      "大千之境香氛蜡烛",
      "烛台香氛蜡烛",
    ],
  },
  {
    coreFamilies: ["艺术家居"],
    label: "家居装饰品",
    pattern: /家居装饰|装饰品|家居饰品/,
  },
  {
    coreFamilies: ["身体护理"],
    label: "身体护理",
    pattern: /身体护理用品|身体护理产品/,
  },
  {
    coreFamilies: ["文创"],
    label: "文创",
    pattern: /文创用品|文创产品/,
  },
];

function catalogSubject(query: string) {
  return normalizeQueryText(query)
    .replace(/请问|请|帮我|告诉我|查一下|看看|列出|展示/g, "")
    .replace(/有哪些|有什么|有哪|包括哪些|都包括|全部|所有|多少款|几款/g, "")
    .replace(/相关的|相关|这一类|这类|类别|种类/g, "")
    .replace(/产品|商品|用品/g, "")
    .replace(/的|是/g, "");
}

export function extractProductCatalogScope(
  query: string,
  vocabulary: ProductCatalogVocabulary
): ProductCatalogScope | null {
  const normalizedQuery = normalizeQueryText(query);
  if (!LIST_REQUEST_PATTERN.test(normalizedQuery)) return null;
  if (PRODUCT_ATTRIBUTE_QUESTION_PATTERN.test(normalizedQuery)) return null;

  const subject = catalogSubject(query);
  if (subject.length < 2) return null;

  const exactFamilies = vocabulary.coreFamilies.filter((family) => normalizeQueryText(family) === subject);
  const exactForms = vocabulary.productForms.filter((form) => normalizeQueryText(form) === subject);
  if (exactFamilies.length || exactForms.length) {
    return {
      coreFamilies: exactFamilies,
      label: [...exactFamilies, ...exactForms].join(" / "),
      productForms: exactForms,
    };
  }

  const mentionedFamilies = vocabulary.coreFamilies.filter((family) =>
    normalizedQuery.includes(normalizeQueryText(family))
  );
  const mentionedForms = vocabulary.productForms
    .filter((form) => normalizedQuery.includes(normalizeQueryText(form)))
    .filter((form, _index, forms) =>
      !forms.some(
        (other) =>
          other !== form
          && normalizeQueryText(other).length > normalizeQueryText(form).length
          && normalizeQueryText(other).includes(normalizeQueryText(form))
      )
    );
  if (mentionedFamilies.length || mentionedForms.length) {
    return {
      coreFamilies: mentionedFamilies,
      label: [...mentionedFamilies, ...mentionedForms].join(" / "),
      productForms: mentionedForms,
    };
  }

  const alias = PRODUCT_CATALOG_ALIASES.find((item) => item.pattern.test(normalizedQuery));
  if (alias) {
    return {
      coreFamilies: alias.coreFamilies.filter((family) => vocabulary.coreFamilies.includes(family)),
      label: alias.label,
      productForms: (alias.productForms ?? []).filter((form) => vocabulary.productForms.includes(form)),
    };
  }

  const coreFamilies = vocabulary.coreFamilies.filter((family) => {
    const normalizedFamily = normalizeQueryText(family);
    return normalizedFamily.includes(subject) || subject.includes(normalizedFamily);
  });
  const productForms = vocabulary.productForms.filter((form) => {
    const normalizedForm = normalizeQueryText(form);
    return normalizedForm.includes(subject) || subject.includes(normalizedForm);
  });
  if (!coreFamilies.length && !productForms.length) return null;

  return {
    coreFamilies,
    label: subject,
    productForms,
  };
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
