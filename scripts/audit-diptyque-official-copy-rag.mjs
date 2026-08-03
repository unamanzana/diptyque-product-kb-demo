import catalog from "../data-pipeline/diptyque_frontend_schema_v1_candidate.json" with { type: "json" };
import {
  retrieveOfficialCopy,
  verifyAnswerClaims,
} from "../src/lib/diptyque-official-copy-rag.ts";
import { buildDiptyqueQueryPlan } from "../src/lib/diptyque-query-plan.ts";

const cases = [
  "我喜欢木质香，但不想太沉，有什么香水推荐？",
  "想找一款干净、自然、不甜的香水。",
  "我平时喜欢白花香，Diptyque哪几款比较适合？",
  "有没有闻起来像雨后花园、森林或者海边的香味？",
  "不喜欢太浓、太有攻击性的香水，想要柔和一点的。",
  "想要比较清冷、小众、不容易撞香的选择，不要只给热门款。",
  "杜桑和影中之水有什么区别？请按香调和香材比较。",
  "谭道和纸上闻起来像吗？",
  "朋友乔迁，推荐几款适合家里的礼物。",
  "我想让家里闻起来像高级酒店，选什么香薰？",
  "有没有适合睡前或者放松时使用的香味？",
  "夏天用哪款比较清爽？",
];

const failures = [];
for (const query of cases) {
  const plan = buildDiptyqueQueryPlan(query, []);
  const hits = retrieveOfficialCopy(query, plan, [], 10);
  if (hits.length < 2) failures.push(`${query}: expected at least 2 evidence hits, found ${hits.length}`);
  for (const hit of hits) {
    if (!hit.excerpt || !hit.sourceUrl || !hit.productId || !hit.sourceField) {
      failures.push(`${query}: incomplete provenance in ${hit.chunkId}`);
    }
    const product = catalog.products.find((candidate) => candidate.id === hit.productId);
    if (!product) failures.push(`${query}: unknown product ${hit.productId}`);
    if (product && !String(product[hit.sourceField] || "").includes(hit.excerpt)) {
      failures.push(`${query}: excerpt is not verbatim source text for ${hit.productName}`);
    }
  }
}

const gatedProductIds = catalog.products
  .filter((product) => product.coreFamily === "个人香氛")
  .slice(0, 8)
  .map((product) => product.id);
const gatedPlan = buildDiptyqueQueryPlan("推荐清新的香水", []);
const gatedHits = retrieveOfficialCopy("推荐清新的香水", gatedPlan, gatedProductIds, 10);
if (gatedHits.some((hit) => !gatedProductIds.includes(hit.productId))) {
  failures.push("candidate gate leaked a product outside structured retrieval");
}

const emptyGatedHits = retrieveOfficialCopy("推荐木质香", gatedPlan, [], 10, true);
if (emptyGatedHits.length) {
  failures.push("strict candidate gate returned evidence after structured retrieval found no products");
}

const followUpPlan = buildDiptyqueQueryPlan("\u8fd8\u6709\u5176\u4ed6\u6e05\u65b0\u7684\u9009\u62e9\u5417\uff1f", []);
const initialFollowUpHits = retrieveOfficialCopy("\u63a8\u8350\u6e05\u65b0\u7684\u9999\u6c34", followUpPlan, [], 10);
const excludedProductId = initialFollowUpHits[0]?.productId;
const alternativeHits = excludedProductId
  ? retrieveOfficialCopy("\u63a8\u8350\u6e05\u65b0\u7684\u9999\u6c34", followUpPlan, [], 10, false, [excludedProductId])
  : [];
if (excludedProductId && alternativeHits.some((hit) => hit.productId === excludedProductId)) {
  failures.push("follow-up retrieval repeated an explicitly excluded product");
}

const noRefillPlan = buildDiptyqueQueryPlan("\u63a8\u8350\u6e05\u65b0\u7684\u9999\u6c34", []);
const noRefillHits = retrieveOfficialCopy("\u63a8\u8350\u6e05\u65b0\u7684\u9999\u6c34", noRefillPlan, [], 20);
if (noRefillHits.some((hit) => catalog.products.find((product) => product.id === hit.productId)?.variantTags.includes("\u8865\u5145\u88c5"))) {
  failures.push("recommendation retrieval included a refill despite the default exclusion");
}
const unsupported = verifyAnswerClaims("这是最热门而且保证留香的选择。", "普通商品描述");
if (unsupported.passed || unsupported.unsupported.length !== 2) {
  failures.push("claim verifier failed to block unsupported popularity and absolute-effect claims");
}
const supported = verifyAnswerClaims("官网写明这是最热门的选择。", "官网写明这是最热门的选择。");
if (!supported.passed) failures.push("claim verifier blocked an explicitly supported claim");

console.log(`Official-copy RAG audit cases: ${cases.length}`);
console.log(`Traceable evidence chunks: ${cases.reduce((sum, query) => sum + retrieveOfficialCopy(query, buildDiptyqueQueryPlan(query, []), [], 10).length, 0)}`);
console.log(`Audit failures: ${failures.length}`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Official-copy RAG audit: PASS");
}
