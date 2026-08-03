import { parseFinalResponse } from "../src/lib/diptyque-answer-parser.ts";

const cases = [
  {
    name: "plain structured response",
    input: JSON.stringify({ answer: "\u63a8\u8350\u675c\u6851", product_ids: ["p1"], answer_mode: "product_search" }),
    check: (result) => result.answer === "\u63a8\u8350\u675c\u6851" && result.productIds[0] === "p1",
  },
  {
    name: "nested structured response",
    input: JSON.stringify({
      answer: JSON.stringify({ answer: "\u7eaf\u6b63\u6587", product_ids: ["inner"], answer_mode: "gift_recommendation" }),
      product_ids: ["outer"],
      answer_mode: "product_search",
    }),
    check: (result) => result.answer === "\u7eaf\u6b63\u6587" && result.productIds[0] === "inner" && result.answerMode === "gift_recommendation",
  },
  {
    name: "json string response",
    input: JSON.stringify(JSON.stringify({ answer: "\u89c4\u683c\u9002\u914d", product_ids: ["p2"], answer_mode: "relation_search" })),
    check: (result) => result.answer === "\u89c4\u683c\u9002\u914d" && result.productIds[0] === "p2",
  },
  {
    name: "fenced response",
    input: "\x60\x60\x60json\n" + JSON.stringify({ answer: "\u56f4\u680f\u5185\u5bb9", product_ids: [], answer_mode: "product_search" }) + "\n\x60\x60\x60",
    check: (result) => result.answer === "\u56f4\u680f\u5185\u5bb9",
  },
  {
    name: "plain text response",
    input: "\u76f4\u63a5\u56de\u7b54",
    check: (result) => result.answer === "\u76f4\u63a5\u56de\u7b54" && result.productIds.length === 0,
  },
  {
    name: "protocol field tail is removed",
    input: "\u6b63\u5e38\u56de\u7b54\nproduct_ids: [\"p1\"]\nanswer_m",
    check: (result) => result.answer === "\u6b63\u5e38\u56de\u7b54",
  },
];

const failures = cases.flatMap((testCase) => {
  const result = parseFinalResponse(testCase.input);
  return testCase.check(result) ? [] : [{ name: testCase.name, result }];
});
console.log("Answer parser cases: " + cases.length);
console.log("Audit failures: " + failures.length);
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exitCode = 1;
}
