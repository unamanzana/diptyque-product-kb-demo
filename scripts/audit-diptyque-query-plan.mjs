import { buildDiptyqueQueryPlan } from "../src/lib/diptyque-query-plan.ts";

const cases = [
  {
    name: "pure scent catalog still goes through semantic interpretation",
    query: "杜桑系列有哪些产品？请完整列出。",
    check: (plan) => plan.intent === "catalog" && !plan.allowDeterministicCatalog,
  },
  {
    name: "preference must not be hijacked by perfume catalog",
    query: "我喜欢木质香，但不想太沉，有什么香水推荐？",
    check: (plan) => plan.intent === "recommendation" && !plan.allowDeterministicCatalog,
  },
  {
    name: "price constrained catalog goes through structured retrieval",
    query: "500元以内有哪些香氛蜡烛？",
    check: (plan) => plan.constraints.maxPrice === 500 && !plan.allowDeterministicCatalog,
  },
  {
    name: "product attribute question bypasses broad catalog answer",
    query: "杜桑淡香水有哪些容量？",
    check: (plan) =>
      plan.intent === "catalog"
      && !plan.allowDeterministicCatalog
      && plan.constraints.productForms.length === 1
      && plan.constraints.productForms[0] === "淡香水",
  },
  {
    name: "series query can exclude perfume forms",
    query: "我喜欢杜桑，除了香水还有哪些同系列产品？",
    check: (plan) =>
      plan.relationIntent === "series_membership"
      && plan.constraints.productForms.length === 0
      && plan.constraints.excludedProductForms.includes("淡香水")
      && plan.constraints.excludedProductForms.includes("淡香精"),
  },
  {
    name: "negative collection becomes an exclusion",
    query: "想送女生，不要玫瑰味，预算800元左右。",
    check: (plan) =>
      plan.intent === "gifting"
      && plan.constraints.maxPrice === 800
      && plan.constraints.collections.length === 0
      && plan.constraints.excludedCollections.includes("玫瑰"),
  },
  {
    name: "home ambience maps to home fragrance and excludes refills",
    query: "想让家里闻起来像安静的高级酒店，预算1200元以内，有什么选择？",
    check: (plan) =>
      plan.intent === "recommendation"
      && plan.constraints.coreFamilies.length === 1
      && plan.constraints.coreFamilies[0] === "家居香氛"
      && plan.constraints.excludeRefills,
  },
  {
    name: "housewarming gift keeps both home families",
    query: "朋友乔迁，推荐几款适合家里的礼物。",
    check: (plan) =>
      plan.intent === "gifting"
      && plan.constraints.coreFamilies.includes("家居香氛")
      && plan.constraints.coreFamilies.includes("艺术家居")
      && plan.constraints.excludeRefills,
  },
  {
    name: "layering is a reviewed relation",
    query: "影中之水香氛洁肤露可以和哪些产品叠香？",
    check: (plan) => plan.intent === "relation" && plan.relationTypes.includes("LAYER_WITH"),
  },
  {
    name: "accessory query is a reviewed relation",
    query: "香氛蜡烛有哪些经过确认的配件可以搭配？",
    check: (plan) => plan.relationIntent === "accessory" && plan.relationTypes.includes("ACCESSORY_FOR"),
  },
  {
    name: "refill compatibility is a reviewed relation",
    query: "扩香精补充瓶分别适用于哪些容器？",
    check: (plan) => plan.relationIntent === "refill_compatibility" && plan.relationTypes.includes("REFILL_FOR"),
  },
  {
    name: "pet safety blocks product recommendations",
    query: "家里有宠物，想买味道柔和、对宠物安全的家居香氛。",
    check: (plan) => plan.intent === "safety" && plan.safety.blockProductRecommendation,
  },
  {
    name: "gift follow-up inherits home category",
    query: "送长辈适合送什么？",
    history: [{ role: "user", content: "家居产品有哪些？" }],
    check: (plan) =>
      plan.intent === "gifting"
      && plan.constraints.coreFamilies.includes("家居香氛")
      && plan.constraints.coreFamilies.includes("艺术家居")
      && plan.inheritedConstraintKeys.includes("coreFamilies"),
  },
  {
    name: "referential follow-up inherits price and candle form",
    query: "其中哪几款更适合卧室？",
    history: [{ role: "user", content: "500元以内有哪些香氛蜡烛？" }],
    check: (plan) =>
      plan.constraints.maxPrice === 500
      && plan.constraints.productForms.some((form) => form.includes("香氛蜡烛"))
      && !plan.allowDeterministicCatalog,
  },
  {
    name: "current explicit product form replaces inherited form",
    query: "只看护手霜。",
    history: [{ role: "user", content: "有哪些香氛蜡烛？" }],
    check: (plan) => plan.constraints.productForms.length === 1 && plan.constraints.productForms[0] === "护手霜",
  },
  {
    name: "excluding perfume must not force personal fragrance family",
    query: "我喜欢杜桑，除了香水还有哪些同系列产品？",
    check: (plan) =>
      plan.relationIntent === "series_membership"
      && !plan.constraints.coreFamilies.includes("个人香氛"),
  },
  {
    name: "broad scent experience keeps personal and home fragrance only",
    query: "有没有闻起来像雨后花园、森林或者海边的香味？",
    check: (plan) =>
      plan.intent === "recommendation"
      && plan.constraints.coreFamilies.includes("个人香氛")
      && plan.constraints.coreFamilies.includes("家居香氛")
      && plan.constraints.excludeRefills,
  },
  {
    name: "liked collection before contrast is a preference seed",
    query: "我喜欢杜桑，但想找一款没那么甜、更加清冷的香水。",
    check: (plan) =>
      plan.intent === "recommendation"
      && plan.constraints.collections.length === 0
      && plan.softPreferences.includes("杜桑"),
  },
  {
    name: "numeric follow-up inherits recommendation preference",
    query: "只看1000元以内的。",
    history: [{ role: "user", content: "推荐几款木质香水。" }],
    check: (plan) =>
      plan.intent === "recommendation"
      && plan.constraints.maxPrice === 1000
      && plan.softPreferences.includes("木质"),
  },
  {
    name: "negative refill wording must not become a positive variant filter",
    query: "预算1500元，帮我搭配一套不含补充装的礼物。",
    check: (plan) => plan.constraints.excludeRefills && plan.constraints.variantTags.length === 0,
  },
  {
    name: "accessory relation keeps the accessory as the fallback source",
    query: "烛盖适配哪些蜡烛",
    check: (plan) =>
      plan.intent === "relation"
      && plan.relationIntent === "accessory"
      && plan.constraints.coreFamilies.length === 0
      && plan.constraints.productForms.length === 1
      && plan.constraints.productForms[0] === "烛盖和灭烛罩"
      && !plan.allowDeterministicCatalog,
  },
  {
    name: "contextual alternatives retain sensory preferences",
    query: "\u8fd8\u6709\u5417\uff1f\u5c31\u53ea\u6709\u8fd9\u4e00\u6b3e\u63a8\u8350\uff1f",
    history: [
      { role: "user", content: "\u6709\u6ca1\u6709\u50cf\u521a\u5265\u5f00\u7684\u67d1\u6a58\u76ae\u4e00\u6837\u6e05\u723d\uff0c\u53c8\u4e0d\u663e\u5f97\u592a\u6d3b\u6cfc\u7684\u9009\u62e9" },
      { role: "assistant", content: "1. \u4e1c\u4eac\u6de1\u9999\u6c34" },
    ],
    check: (plan) =>
      plan.intent === "recommendation"
      && plan.conversationState.isFollowUp
      && plan.conversationState.contextualQuery.includes("\u67d1\u6a58\u76ae")
      && plan.conversationState.previouslyPresentedProductIds.length === 1
      && plan.softPreferences.includes("\u6e05\u65b0")
      && plan.softPreferences.includes("\u67d1\u6a58")
      && plan.softPreferences.includes("\u514b\u5236")
      && plan.conversationState.hardConstraintKeys.length === 0,
  },
  {
    name: "complete new recommendation clears unrelated previous budget",
    query: "我喜欢奶香和木质感，但不想要像甜点一样的味道，有什么推荐",
    history: [{ role: "user", content: "预算1500元以内，帮我准备生日礼物。" }],
    check: (plan) =>
      plan.intent === "recommendation"
      && plan.constraints.maxPrice == null
      && plan.softPreferences.includes("奶香")
      && plan.softPreferences.includes("木质")
      && plan.softPreferences.includes("不甜")
      && !plan.conversationState.isFollowUp,
  },  {
    name: "automatic refill exclusion is not an explicit hard constraint",
    query: "\u60f3\u627e\u4e00\u6b3e\u6e05\u723d\u81ea\u7136\u7684\u9999\u5473\u3002",
    check: (plan) =>
      plan.intent === "recommendation"
      && plan.constraints.excludeRefills
      && !plan.conversationState.hardConstraintKeys.includes("excludeRefills"),
  },
  {
    name: "explicit budget remains a hard constraint",
    query: "\u9884\u7b971000\u5143\u4ee5\u5185\uff0c\u63a8\u8350\u51e0\u6b3e\u9999\u6c34\u3002",
    check: (plan) =>
      plan.constraints.maxPrice === 1000
      && plan.conversationState.hardConstraintKeys.includes("maxPrice"),
  },
];

const failures = cases.flatMap((testCase) => {
  const plan = buildDiptyqueQueryPlan(testCase.query, testCase.history ?? []);
  return testCase.check(plan) ? [] : [{ name: testCase.name, plan }];
});

console.log(`Query plan cases: ${cases.length}`);
console.log(`Audit failures: ${failures.length}`);
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exitCode = 1;
}
