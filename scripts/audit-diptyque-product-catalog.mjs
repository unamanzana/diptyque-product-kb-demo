import { readFileSync } from "node:fs";

import { extractProductCatalogScope } from "../src/lib/diptyque-query-intent.ts";

const payload = JSON.parse(
  readFileSync(new URL("../src/data/diptyque-frontend-data.json", import.meta.url), "utf8")
);
const products = payload.products;
const vocabulary = {
  coreFamilies: Array.from(new Set(products.map((product) => product.coreFamily).filter(Boolean))),
  productForms: Array.from(new Set(products.map((product) => product.productForm).filter(Boolean))),
};
const failures = [];
let queryChecks = 0;
let membershipChecks = 0;

function sorted(values) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function productsForScope(scope) {
  return sorted(
    products
      .filter((product) =>
        (!scope.coreFamilies.length || scope.coreFamilies.includes(product.coreFamily))
        && (!scope.productForms.length || scope.productForms.includes(product.productForm))
      )
      .map((product) => product.name)
  );
}

function assertScope(label, query, expectedFamilies, expectedForms) {
  queryChecks += 1;
  const scope = extractProductCatalogScope(query, vocabulary);
  const actualFamilies = sorted(scope?.coreFamilies ?? []);
  const actualForms = sorted(scope?.productForms ?? []);
  if (
    JSON.stringify(actualFamilies) !== JSON.stringify(sorted(expectedFamilies))
    || JSON.stringify(actualForms) !== JSON.stringify(sorted(expectedForms))
  ) {
    failures.push({
      type: label,
      query,
      expectedFamilies: sorted(expectedFamilies),
      actualFamilies,
      expectedForms: sorted(expectedForms),
      actualForms,
    });
    return;
  }

  const expectedProducts = sorted(
    products
      .filter((product) =>
        (!expectedFamilies.length || expectedFamilies.includes(product.coreFamily))
        && (!expectedForms.length || expectedForms.includes(product.productForm))
      )
      .map((product) => product.name)
  );
  const actualProducts = scope ? productsForScope(scope) : [];
  membershipChecks += expectedProducts.length;
  if (JSON.stringify(actualProducts) !== JSON.stringify(expectedProducts)) {
    failures.push({ type: label + "_membership", query, expectedProducts, actualProducts });
  }
}

for (const family of vocabulary.coreFamilies) {
  for (const query of [
    family + "有哪些",
    family + "有哪些产品",
    "请列出所有" + family + "商品",
  ]) {
    assertScope("core_family", query, [family], []);
  }
}

for (const form of vocabulary.productForms) {
  for (const query of [
    form + "有哪些",
    form + "有哪些产品",
    "请列出全部" + form + "商品",
  ]) {
    assertScope("product_form", query, [], [form]);
  }
}

assertScope(
  "home_alias",
  "家居用品有哪些",
  ["家居香氛", "艺术家居"],
  []
);
assertScope("perfume_alias", "香水有哪些", ["个人香氛"], ["淡香水", "淡香精"]);
assertScope(
  "decor_alias",
  "家居装饰品都有什么",
  ["艺术家居"],
  []
);
assertScope("creative_alias", "文创用品有哪些", ["文创"], []);
assertScope(
  "candle_alias",
  "香氛蜡烛有哪些",
  ["家居香氛"],
  [
    "迷你香氛蜡烛",
    "经典香氛蜡烛",
    "中号香氛蜡烛",
    "大号香氛蜡烛",
    "超大号香氛蜡烛",
    "大千之境香氛蜡烛",
    "烛台香氛蜡烛",
  ]
);
assertScope("cross_dimension", "艺术家居里的烛台有哪些", ["艺术家居"], ["烛台"]);
assertScope(
  "partial_form_group",
  "扩香有哪些",
  [],
  vocabulary.productForms.filter((form) => form.includes("扩香"))
);

for (const query of [
  "家居用品适合送礼吗",
  "朋友说杜桑有哪些产品",
  "晚香玉香味有哪些产品",
  "为什么香水留香时间不同",
  "奥费恩香氛护手霜有哪些香调",
  "这款花瓶的材质是什么",
]) {
  queryChecks += 1;
  if (extractProductCatalogScope(query, vocabulary)) {
    failures.push({ type: "negative_query", query });
  }
}

console.log("Core families: " + vocabulary.coreFamilies.length);
console.log("Product forms: " + vocabulary.productForms.length);
console.log("Product catalog query checks: " + queryChecks);
console.log("Product membership checks: " + membershipChecks);
console.log("Audit failures: " + failures.length);

if (failures.length) {
  console.error(JSON.stringify(failures.slice(0, 20), null, 2));
  process.exitCode = 1;
}