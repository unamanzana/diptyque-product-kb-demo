import { readFileSync } from "node:fs";

import {
  extractGiftBudgetCeiling,
  isGiftRecommendationQuery,
} from "../src/lib/diptyque-query-intent.ts";
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

const giftBox = perfumeCandidates.find((product) => product.productForm === "淡香水礼盒");
const giftBoxContents = perfumeCandidates.filter(
  (product) => product.name !== giftBox?.name && product.productForm === "淡香水"
).slice(0, 2);
if (!giftBox || giftBoxContents.length < 2) {
  failures.push({ label: "gift_box_fixture_missing" });
} else {
  assertNames(
    "numbered_heading_excludes_reason_mentions",
    selectMentionedProductNames(
      "1. " + giftBox.name + " —— 内含 " + giftBoxContents.map((product) => product.name).join("、") + "，适合探索。",
      perfumeCandidates
    ),
    [giftBox.name]
  );
}

assertNames(
  "intro_mentions_are_not_cards",
  selectMentionedProductNames(
    "我比较了 " + exactRecommendations[4].name + "。\n1. " + exactRecommendations[0].name + "｜推荐依据：更符合需求。",
    perfumeCandidates
  ),
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
  assertNames(
    "numbered_exact_name_does_not_expand_variant",
    selectMentionedProductNames(
      "1. " + eauDeParfum.name + "｜推荐依据：这一浓度符合需求。",
      variants
    ),
    [eauDeParfum.name]
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

const positiveGiftQueries = [
  "可以送家人什么",
  "给亲人选哪款比较合适",
  "想送同事一份礼物",
  "预算 800 送朋友什么好",
  "送长辈推荐什么当礼物",
  "给妈妈挑一款香水",
  "预算 1500 送朋友",
  "父亲节什么香水合适",
  "有没有适合送人的家居用品",
  "客户乔迁该选什么",
  "想买个伴手礼",
  "推荐一款生日礼物",
];
const negativeGiftQueries = [
  "朋友说杜桑有哪些产品",
  "长辈平时用香水吗",
  "生日香氛蜡烛有哪些",
  "纪念日是哪一天",
  "妈妈喜欢的晚香玉有哪些产品",
];
const giftBudgetCases = [
  ["预算 800 送同事什么好", 800],
  ["送朋友500元以内的礼物", 500],
  ["预算不超过 1,500 元", 1500],
];
for (const [query, expected] of giftBudgetCases) {
  const actual = extractGiftBudgetCeiling(query);
  if (actual !== expected) failures.push({ label: "gift_budget_mismatch", query, actual, expected });
}

for (const query of positiveGiftQueries) {
  if (!isGiftRecommendationQuery(query)) failures.push({ label: "gift_intent_false_negative", query });
}
for (const query of negativeGiftQueries) {
  if (isGiftRecommendationQuery(query)) failures.push({ label: "gift_intent_false_positive", query });
}

console.log(`Gift intent cases: ${positiveGiftQueries.length + negativeGiftQueries.length}`);
console.log(`Perfume candidates: ${perfumeCandidates.length}`);
console.log(`Recommendation selection cases: 7`);
console.log(`Audit failures: ${failures.length}`);

if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exitCode = 1;
}
