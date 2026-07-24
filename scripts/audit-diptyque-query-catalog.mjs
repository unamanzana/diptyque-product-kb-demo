import { readFileSync } from "node:fs";

import {
  extractScentCatalogTerm,
  productMatchesScentCatalogTerm,
} from "../src/lib/diptyque-query-intent.ts";

const payload = JSON.parse(
  readFileSync(new URL("../src/data/diptyque-frontend-data.json", import.meta.url), "utf8")
);
const products = payload.products;

function uniq(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function productNames(items) {
  return uniq(items.map((product) => product.name)).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function scentScopes(term) {
  return uniq([
    `${term}香味`,
    `${term}气味`,
    `${term}味`,
    term.endsWith("香") ? `${term}调` : `${term}香调`,
  ]);
}

function positiveQueries(scope) {
  return [
    `${scope}有哪些产品`,
    `${scope}的商品有哪些`,
    `有哪些${scope}的产品`,
    `请列出所有${scope}商品`,
    `哪些产品属于${scope}`,
    `含有${scope}的商品包括哪些`,
  ];
}

function negativeQueries(term) {
  return [
    `${term}系列有哪些产品`,
    `哪些产品含有${term}`,
    `${term}产品有哪些香味`,
    `${term}香味是什么`,
  ];
}

const conceptTerms = uniq(products.flatMap((product) => product.scentConcepts)).sort((a, b) =>
  a.localeCompare(b, "zh-CN")
);
const familyTerms = uniq(products.flatMap((product) => product.noteFamilies)).sort((a, b) =>
  a.localeCompare(b, "zh-CN")
);
const vocabulary = uniq([...conceptTerms, ...familyTerms]);
const familyAliases = {
  花香调: "花香",
  木质香调: "木质",
  果香调: "果香",
  辛香调: "辛香",
  草本香调: "草本绿香",
  海洋香调: "海洋矿物",
};
const failures = [];
let positiveQueryCount = 0;
let negativeQueryCount = 0;
let membershipCheckCount = 0;

for (const term of vocabulary) {
  const expectedProducts = productNames(
    products.filter(
      (product) => product.scentConcepts.includes(term) || product.noteFamilies.includes(term)
    )
  );
  const actualProducts = productNames(
    products.filter((product) => productMatchesScentCatalogTerm(product, term))
  );
  membershipCheckCount += expectedProducts.length;

  if (JSON.stringify(actualProducts) !== JSON.stringify(expectedProducts)) {
    failures.push({ type: "membership", term, expectedProducts, actualProducts });
  }

  for (const scope of scentScopes(term)) {
    for (const query of positiveQueries(scope)) {
      positiveQueryCount += 1;
      const parsedTerm = extractScentCatalogTerm(query, vocabulary);
      if (parsedTerm !== term) {
        failures.push({ type: "positive_query", term, query, parsedTerm });
      }
    }
  }

  for (const query of negativeQueries(term)) {
    negativeQueryCount += 1;
    const parsedTerm = extractScentCatalogTerm(query, vocabulary);
    if (parsedTerm) {
      failures.push({ type: "negative_query", term, query, parsedTerm });
    }
  }
}

for (const [alias, canonical] of Object.entries(familyAliases)) {
  for (const query of positiveQueries(alias)) {
    positiveQueryCount += 1;
    const parsedTerm = extractScentCatalogTerm(query, vocabulary);
    if (parsedTerm !== canonical) {
      failures.push({ type: "family_alias_query", alias, canonical, query, parsedTerm });
    }
  }
}

console.log(`Scent concepts: ${conceptTerms.length}`);
console.log(`Scent families: ${familyTerms.length}`);
console.log(`Catalog terms: ${vocabulary.length}`);
console.log(`Positive query variants: ${positiveQueryCount}`);
console.log(`Negative query variants: ${negativeQueryCount}`);
console.log(`Product membership checks: ${membershipCheckCount}`);
console.log(`Audit failures: ${failures.length}`);

if (failures.length) {
  console.error(JSON.stringify(failures.slice(0, 20), null, 2));
  process.exitCode = 1;
}
