import { readFileSync } from "node:fs";

import { selectMentionedProductNames } from "../src/lib/diptyque-recommendation-selection.ts";

const payload = JSON.parse(
  readFileSync(new URL("../src/data/diptyque-frontend-data.json", import.meta.url), "utf8")
);
const products = payload.products;
const failures = [];

function assertNames(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push({ label, actual, expected });
  }
}

const perfumeCandidates = products.filter(
  (product) =>
    product.coreFamily === "个人香氛" &&
    ["淡香水", "淡香精", "香膏", "淡香水礼盒", "礼盒"].includes(product.productForm) &&
    !product.variantTags.includes("补充装")
);
const exactRecommendations = perfumeCandidates.slice(0, 5);
const exactAnswer = exactRecommendations
  .map((product, index) => `${index + 1}. ${product.name}：推荐理由。`)
  .join("\n");
assertNames(
  "five_exact_recommendations",
  selectMentionedProductNames(exactAnswer, perfumeCandidates),
  exactRecommendations.map((product) => product.name)
);

assertNames(
  "exclude_unmentioned_candidates",
  selectMentionedProductNames(`推荐 ${exactRecommendations[0].name}。`, perfumeCandidates),
  [exactRecommendations[0].name]
);

const collectionVariants = new Map();
for (const product of perfumeCandidates) {
  for (const collection of product.collections) {
    const variants = collectionVariants.get(collection) ?? [];
    variants.push(product);
    collectionVariants.set(collection, variants);
  }
}
const variantPairEntry = Array.from(collectionVariants.entries()).find(([, variants]) =>
  variants.some((product) => product.productForm === "淡香精") &&
  variants.some((product) => product.productForm === "淡香水")
);
if (!variantPairEntry) {
  failures.push({ label: "variant_pair_fixture_missing" });
} else {
  const [, variants] = variantPairEntry;
  const eauDeParfum = variants
    .filter((product) => product.productForm === "淡香精")
    .sort((a, b) => a.name.length - b.name.length)[0];
  const eauDeToilette = variants
    .filter((product) => product.productForm === "淡香水")
    .sort((a, b) => a.name.length - b.name.length)[0];
  assertNames(
    "collection_variant_phrase",
    selectMentionedProductNames(`${eauDeParfum.name}（或${eauDeToilette.productForm}）都可以考虑。`, variants),
    [eauDeParfum.name, eauDeToilette.name]
  );
}

const homeCandidates = products
  .filter((product) => ["艺术家居", "文创", "家居香氛"].includes(product.coreFamily))
  .slice(0, 4);
assertNames(
  "mixed_home_recommendations",
  selectMentionedProductNames(homeCandidates.map((product) => product.name).join("、"), homeCandidates),
  homeCandidates.map((product) => product.name)
);

console.log(`Perfume candidates: ${perfumeCandidates.length}`);
console.log(`Recommendation selection cases: 4`);
console.log(`Audit failures: ${failures.length}`);

if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exitCode = 1;
}
