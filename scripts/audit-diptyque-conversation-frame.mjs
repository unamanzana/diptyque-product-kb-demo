import {
  applyConversationFrameUpdate,
} from "../src/lib/diptyque-conversation-frame.ts";

function update(overrides = {}) {
  return {
    action: "ADD",
    clearFields: [],
    reason: "test",
    intent: "recommendation",
    subject: { entityType: "unknown", text: "" },
    object: { entityType: "unknown", text: "" },
    predicate: "none",
    coreFamilies: [],
    productForms: [],
    collections: [],
    excludedTerms: [],
    sizes: [],
    softPreferences: [],
    ...overrides,
  };
}

function apply(previous, frameUpdate, question) {
  return applyConversationFrameUpdate(previous, frameUpdate, {
    matchedProductIds: [],
    selectedProductIds: [],
    question,
  });
}

const failures = [];
function check(name, condition, detail) {
  if (!condition) failures.push({ name, detail });
}

let frame = apply(null, update({
  action: "NEW_TOPIC",
  intent: "catalog",
  subject: { entityType: "core_family", text: "\u5bb6\u5c45\u9999\u6c1b" },
  coreFamilies: ["\u5bb6\u5c45\u9999\u6c1b"],
}), "\u5bb6\u5c45\u4ea7\u54c1\u6709\u54ea\u4e9b\uff1f");
check("new topic establishes home scope", frame.coreFamilies.includes("\u5bb6\u5c45\u9999\u6c1b"), frame);

frame = apply(frame, update({
  action: "ADD",
  intent: "gifting",
  softPreferences: ["\u9001\u957f\u8f88"],
}), "\u9001\u957f\u8f88\u9002\u5408\u9001\u4ec0\u4e48\uff1f");
check("referential gifting retains home scope", frame.coreFamilies.includes("\u5bb6\u5c45\u9999\u6c1b"), frame);
check("referential gifting adds preference", frame.softPreferences.includes("\u9001\u957f\u8f88"), frame);

frame = apply(frame, update({ action: "ADD", maxPrice: 500 }), "\u53ea\u770b500\u5143\u4ee5\u5185\u7684");
check("numeric follow-up adds budget", frame.maxPrice === 500 && frame.coreFamilies.includes("\u5bb6\u5c45\u9999\u6c1b"), frame);

frame = apply(frame, update({
  action: "NEW_TOPIC",
  intent: "comparison",
  collections: ["\u675c\u6851", "\u5f71\u4e2d\u4e4b\u6c34"],
}), "\u675c\u6851\u548c\u5f71\u4e2d\u4e4b\u6c34\u6709\u4ec0\u4e48\u533a\u522b\uff1f");
check("new named comparison clears stale category", frame.coreFamilies.length === 0, frame);
check("new named comparison clears stale budget", frame.maxPrice === undefined, frame);
check("comparison keeps both explicit collections", frame.collections.length === 2, frame);

frame = apply(frame, update({
  action: "ADD",
  excludedTerms: ["\u73ab\u7470"],
}), "\u4e0d\u8981\u73ab\u7470\u5473");
check("negative follow-up is represented as exclusion", frame.excludedTerms.includes("\u73ab\u7470"), frame);

console.log("Conversation frame cases: 8");
console.log("Audit failures: " + failures.length);
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exitCode = 1;
}
