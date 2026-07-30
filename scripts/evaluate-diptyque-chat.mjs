import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CASES_PATH = path.join(ROOT, "evals", "diptyque-chat-eval-v1.json");
const CATALOG_PATH = path.join(ROOT, "data-pipeline", "diptyque_frontend_schema_v1_candidate.json");
const DEFAULT_BASE_URL = "http://localhost:3000/api/chat";
const ABSTENTION_MARKERS = [
  "无法确认",
  "无法从数据库中确认",
  "没有官方依据",
  "未标注任何",
  "证据不足",
  "暂无依据",
  "不能判断",
  "无法保证",
];
const CHECK_LAYERS = {
  non_empty_answer: "generation",
  provider_status: "provider",
  resolved_product_names: "frontend_sync",
  answer_behavior: "safety",
  answer_mode: "intent",
  minimum_matches: "retrieval",
  minimum_recommendations: "ranking",
  maximum_recommendations: "ranking",
  expected_matches_all: "retrieval",
  expected_matches_any: "retrieval",
  forbidden_products: "constraint",
  core_family_constraint: "constraint",
  product_form_constraint: "constraint",
  price_ceiling: "constraint",
  exclude_refills: "constraint",
  answer_terms_any: "grounding",
  answer_terms_all: "grounding",
  forbidden_answer_terms: "grounding",
};

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.CHAT_EVAL_BASE_URL || DEFAULT_BASE_URL,
    category: "",
    limit: Number.POSITIVE_INFINITY,
    strict: false,
    validateOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--validate-only") options.validateOnly = true;
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--base-url") options.baseUrl = argv[++index] || options.baseUrl;
    else if (arg === "--category") options.category = argv[++index] || "";
    else if (arg === "--limit") options.limit = Math.max(1, Number(argv[++index]) || 1);
  }
  return options;
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

function errorMessage(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return error.message + cause;
}

function validateDataset(dataset, products) {
  const failures = [];
  const ids = new Set();
  const categories = new Map();
  const productNames = new Set(products.map((product) => product.name));

  assert(dataset.schemaVersion === "1.0.0", "schemaVersion must be 1.0.0", failures);
  assert(dataset.cases.length === 48, `expected 48 cases, found ${dataset.cases.length}`, failures);
  for (const testCase of dataset.cases) {
    assert(Boolean(testCase.id), "case without id", failures);
    assert(!ids.has(testCase.id), `duplicate case id: ${testCase.id}`, failures);
    ids.add(testCase.id);
    categories.set(testCase.category, (categories.get(testCase.category) || 0) + 1);
    assert(Array.isArray(testCase.turns) && testCase.turns.length > 0, `${testCase.id}: no turns`, failures);
    assert(Boolean(testCase.expectations?.behavior), `${testCase.id}: missing behavior`, failures);
    const namedProducts = [
      ...(testCase.expectations?.expectedMatchedAll || []),
      ...(testCase.expectations?.expectedMatchedAny || []),
      ...(testCase.expectations?.forbiddenSelectedNames || []),
    ];
    for (const name of namedProducts) {
      assert(productNames.has(name), `${testCase.id}: unknown product ${name}`, failures);
    }
  }
  for (const [category, count] of categories) {
    assert(count === 6, `category ${category} should contain 6 cases, found ${count}`, failures);
  }
  assert(categories.size === 8, `expected 8 categories, found ${categories.size}`, failures);
  return { categories: Object.fromEntries(categories), failures };
}

function evaluateResponse(testCase, response, productByName) {
  const checks = [];
  const expectations = testCase.expectations || {};
  const answer = String(response.answer || "");
  const matchedNames = Array.from(new Set(response.matchedProductNames || []));
  const recommendedNames = Array.from(new Set(response.recommendedProductNames || []));
  const selectedNames = recommendedNames.length ? recommendedNames : matchedNames;
  const selectedProducts = selectedNames.map((name) => productByName.get(name)).filter(Boolean);
  const add = (name, passed, detail = "") => checks.push({ name, passed, detail });
  const includesAny = (terms) => !terms?.length || terms.some((term) => answer.includes(term));
  const includesAll = (terms) => !terms?.length || terms.every((term) => answer.includes(term));
  const abstained = ABSTENTION_MARKERS.some((marker) => answer.includes(marker));

  add("non_empty_answer", answer.trim().length > 0);
  if (response.reason) {
    add("provider_status", !["deepseek_exception", "deepseek_timeout"].includes(response.reason), response.reason);
  }
  add("resolved_product_names", selectedNames.every((name) => productByName.has(name)), selectedNames.join("、"));
  if (expectations.behavior === "answer") add("answer_behavior", !abstained);
  if (expectations.behavior === "abstain") add("answer_behavior", abstained);
  if (expectations.answerModeAnyOf?.length) {
    add("answer_mode", expectations.answerModeAnyOf.includes(response.answerMode), String(response.answerMode || ""));
  }
  if (Number.isFinite(expectations.minMatchedProducts)) {
    add("minimum_matches", matchedNames.length >= expectations.minMatchedProducts, String(matchedNames.length));
  }
  if (Number.isFinite(expectations.minRecommendedProducts)) {
    add("minimum_recommendations", recommendedNames.length >= expectations.minRecommendedProducts, String(recommendedNames.length));
  }
  if (Number.isFinite(expectations.maxRecommendedProducts)) {
    add("maximum_recommendations", recommendedNames.length <= expectations.maxRecommendedProducts, String(recommendedNames.length));
  }
  if (expectations.expectedMatchedAll?.length) {
    add("expected_matches_all", expectations.expectedMatchedAll.every((name) => matchedNames.includes(name)));
  }
  if (expectations.expectedMatchedAny?.length) {
    add("expected_matches_any", expectations.expectedMatchedAny.some((name) => matchedNames.includes(name)));
  }
  if (expectations.forbiddenSelectedNames?.length) {
    add("forbidden_products", expectations.forbiddenSelectedNames.every((name) => !selectedNames.includes(name)));
  }
  if (expectations.allowedCoreFamilies?.length && selectedProducts.length) {
    add("core_family_constraint", selectedProducts.every((product) => expectations.allowedCoreFamilies.includes(product.coreFamily)));
  }
  if (expectations.allowedProductForms?.length && selectedProducts.length) {
    add("product_form_constraint", selectedProducts.every((product) => expectations.allowedProductForms.includes(product.productForm)));
  }
  if (Number.isFinite(expectations.maxPrice) && selectedProducts.length) {
    add("price_ceiling", selectedProducts.every((product) => Number(product.priceMin) <= expectations.maxPrice));
  }
  if (expectations.excludeRefills && selectedProducts.length) {
    add("exclude_refills", selectedProducts.every((product) => !product.name.includes("补充") && !product.productForm.includes("补充")));
  }
  if (expectations.answerMustIncludeAny?.length) add("answer_terms_any", includesAny(expectations.answerMustIncludeAny));
  if (expectations.answerMustIncludeAll?.length) add("answer_terms_all", includesAll(expectations.answerMustIncludeAll));
  if (expectations.answerMustNotInclude?.length) {
    add("forbidden_answer_terms", expectations.answerMustNotInclude.every((term) => !answer.includes(term)));
  }

  const passed = checks.filter((check) => check.passed).length;
  return {
    automatedScore: checks.length ? Math.round((passed / checks.length) * 100) : 0,
    checks,
    manualReview: testCase.manualReview || [],
    matchedNames,
    recommendedNames,
  };
}

async function callCase(testCase, baseUrl) {
  const history = [];
  let response = {};
  for (const message of testCase.turns) {
    const httpResponse = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history, message }),
    });
    if (!httpResponse.ok) throw new Error(`HTTP ${httpResponse.status}: ${await httpResponse.text()}`);
    response = await httpResponse.json();
    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: String(response.answer || "") });
  }
  return response;
}

function markdownReport(run) {
  const lines = [
    "# Diptyque 问答评测结果",
    "",
    `- 时间：${run.generatedAt}`,
    `- 接口：${run.baseUrl}`,
    `- 用例：${run.summary.caseCount}`,
    `- 自动评分：${run.summary.averageScore}%`,
    `- 满分用例：${run.summary.perfectCases}`,
    `- 请求失败：${run.summary.requestFailures}`,
    "",
    "## 分类结果",
    "",
    "| 分类 | 用例 | 平均分 |",
    "| --- | ---: | ---: |",
    ...Object.entries(run.summary.categories).map(([name, value]) => `| ${name} | ${value.count} | ${value.averageScore}% |`),
    "",
    "## 失败层分布",
    "",
    "| 层级 | 失败项 |",
    "| --- | ---: |",
    ...Object.entries(run.summary.failureLayers).map(([name, count]) => `| ${name} | ${count} |`),
    "",
    "## 非满分用例",
    "",
    ...run.results.filter((item) => item.automatedScore < 100).flatMap((item) => [
      `### ${item.id} · ${item.automatedScore}%`,
      "",
      `问题：${item.turns.join(" → ")}`,
      "",
      `失败项：${item.checks.filter((check) => !check.passed).map((check) => check.name).join("、") || "请求失败"}`,
      "",
    ]),
  ];
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dataset = JSON.parse(await readFile(CASES_PATH, "utf8"));
  const catalog = JSON.parse(await readFile(CATALOG_PATH, "utf8"));
  const products = catalog.products || [];
  const validation = validateDataset(dataset, products);
  if (validation.failures.length) {
    console.error(validation.failures.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(`Chat eval cases: ${dataset.cases.length}`);
  console.log(`Categories: ${JSON.stringify(validation.categories)}`);
  console.log("Dataset validation: PASS");
  if (options.validateOnly) return;

  const productByName = new Map(products.map((product) => [product.name, product]));
  const selectedCases = dataset.cases
    .filter((testCase) => !options.category || testCase.category === options.category)
    .slice(0, options.limit);
  const results = [];
  for (const testCase of selectedCases) {
    try {
      const response = await callCase(testCase, options.baseUrl);
      const evaluation = evaluateResponse(testCase, response, productByName);
      results.push({ ...testCase, ...evaluation, response });
      console.log(`${testCase.id}: ${evaluation.automatedScore}%`);
    } catch (error) {
      results.push({ ...testCase, automatedScore: 0, checks: [], error: errorMessage(error) });
      console.log(`${testCase.id}: REQUEST_FAILED`);
    }
  }

  const categoryBuckets = new Map();
  const failureLayers = {};
  for (const result of results) {
    const bucket = categoryBuckets.get(result.category) || [];
    bucket.push(result.automatedScore);
    categoryBuckets.set(result.category, bucket);
    for (const check of result.checks || []) {
      if (check.passed) continue;
      const layer = CHECK_LAYERS[check.name] || "other";
      failureLayers[layer] = (failureLayers[layer] || 0) + 1;
    }
    if (result.error) failureLayers.provider = (failureLayers.provider || 0) + 1;
  }
  const categories = Object.fromEntries(Array.from(categoryBuckets, ([name, scores]) => [name, {
    count: scores.length,
    averageScore: Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
  }]));
  const run = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    summary: {
      caseCount: results.length,
      averageScore: results.length ? Math.round(results.reduce((sum, item) => sum + item.automatedScore, 0) / results.length) : 0,
      perfectCases: results.filter((item) => item.automatedScore === 100).length,
      requestFailures: results.filter((item) => item.error).length,
      categories,
      failureLayers,
    },
    results,
  };
  const outputDir = path.join(ROOT, "temp", "chat-evals");
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "latest.json"), JSON.stringify(run, null, 2) + "\n", "utf8");
  await writeFile(path.join(outputDir, "latest.md"), markdownReport(run) + "\n", "utf8");
  console.log(`Average score: ${run.summary.averageScore}%`);
  console.log(`Report: ${path.join(outputDir, "latest.md")}`);
  if (options.strict && (run.summary.averageScore < 90 || run.summary.requestFailures > 0)) process.exitCode = 1;
}

await main();
