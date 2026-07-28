from __future__ import annotations

import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from audit_ontology_schema_v1_coverage import DIRECT_PATTERNS, TEXT_FIELDS, merge_raw, read_csv


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
RAW_PATH = ROOT / "diptyque_products.csv"
CLEAN_PATH = ROOT / "diptyque_products_cleaned.csv"
OUTPUT_PATH = ROOT / "diptyque_semantic_fact_dataset_v1.json"
ASSERTION_CSV_PATH = ROOT / "diptyque_semantic_fact_assertions_v1.csv"
REPORT_PATH = REPO / "docs" / "ontology" / "semantic-fact-migration-v1.md"

PHYSICAL_FAMILIES = {"艺术家居", "文创"}
FUNCTION_VALUES_EXCLUDED_FROM_FACT_MIGRATION = {"蜡烛养护"}
MATERIAL_CANONICAL_NAMES = {
    "硼矽玻璃": "硼硅玻璃",
}
MATERIAL_VALUES_EXCLUDED = {"防水防污内衬"}
DIMENSION_SCHEMA = {
    "function": ("Function", "HAS_FUNCTION", "功能"),
    "scene": ("UseScene", "HAS_SCENE", "场景"),
    "user_need": ("UserNeed", "SERVES_NEED", "需求"),
    "care": ("CareInstruction", "HAS_CARE_INSTRUCTION", "保养"),
}
MATERIAL_FIELDS = ("caracteristics_text", "pdp_long_description", "savoir_faire_text")


def stable_id(prefix: str, *parts: str) -> str:
    digest = hashlib.sha1("\u241f".join(parts).encode("utf-8")).hexdigest()[:16]
    return f"{prefix}:{digest}"


def first_url(raw: dict[str, str]) -> str:
    return (raw.get("url") or "").split("\n", 1)[0].strip()


def compact_excerpt(text: str, patterns: tuple[str, ...], limit: int = 260) -> str:
    normalized = re.sub(r"\s+", " ", text or "").strip()
    if not normalized:
        return ""
    match = next((re.search(pattern, normalized, re.IGNORECASE) for pattern in patterns if re.search(pattern, normalized, re.IGNORECASE)), None)
    if not match:
        return normalized[:limit]
    sentence_start = max(normalized.rfind(mark, 0, match.start()) for mark in "。！？；\n") + 1
    sentence_ends = [normalized.find(mark, match.end()) for mark in "。！？；\n"]
    sentence_end = min((value for value in sentence_ends if value >= 0), default=len(normalized)) + 1
    excerpt = normalized[sentence_start:sentence_end].strip()
    if len(excerpt) <= limit:
        return excerpt
    start = max(0, match.start() - 90)
    end = min(len(normalized), match.end() + 150)
    return normalized[start:end].strip()


def find_pattern_evidence(raw: dict[str, str], patterns: tuple[str, ...]) -> tuple[str, str] | None:
    for field in TEXT_FIELDS:
        text = raw.get(field, "")
        if text and any(re.search(pattern, text, re.IGNORECASE) for pattern in patterns):
            return field, compact_excerpt(text, patterns)
    return None


def normalize_material(value: str) -> str:
    value = re.sub(r"^[\-•·\s]+", "", value).strip()
    value = re.sub(r"(?:底座|镜面|托盘|钟形罩|烛罩|材质)$", "", value).strip()
    return MATERIAL_CANONICAL_NAMES.get(value, value)


def material_facts(raw: dict[str, str]) -> list[tuple[str, str, str]]:
    facts: dict[str, tuple[str, str]] = {}
    for field in MATERIAL_FIELDS:
        text = raw.get(field, "")
        if not text:
            continue
        for match in re.finditer(r"材质\s*[:：]\s*([^\n。；;]+)", text):
            excerpt = match.group(0).strip()
            for part in re.split(r"[，、,/和]", match.group(1)):
                material = normalize_material(part)
                if material and material not in MATERIAL_VALUES_EXCLUDED:
                    facts.setdefault(material, (field, excerpt))
    return [(name, field, excerpt) for name, (field, excerpt) in sorted(facts.items())]


def entity_properties(entity_type: str, name: str) -> dict[str, object]:
    properties: dict[str, object] = {
        "canonicalName": name,
        "aliases": [],
        "vocabularyStatus": "approved",
    }
    if entity_type == "CareInstruction":
        properties.update({"instructionType": name, "text": name})
    return properties


def main() -> None:
    raw_rows = read_csv(RAW_PATH)
    clean_rows = read_csv(CLEAN_PATH)
    raw_by_sku = {row["sku"]: row for row in raw_rows}
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in clean_rows:
        grouped[row["product_concept_key"]].append(row)

    entities: dict[str, dict[str, object]] = {}
    evidence: list[dict[str, object]] = []
    assertions: list[dict[str, object]] = []
    assertion_rows: list[dict[str, object]] = []

    for product_key, variants in sorted(grouped.items()):
        first = variants[0]
        product_id = stable_id("product-concept", product_key)
        product_name = first["product_concept_name"]
        family = first["core_family"]
        raw = merge_raw([raw_by_sku[row["sku"]] for row in variants])
        entities[product_id] = {
            "id": product_id,
            "entityType": "ProductConcept",
            "name": product_name,
            "properties": {
                "productConceptKey": product_key,
                "coreFamily": family,
                "productForm": first["product_form"],
            },
        }

        facts: list[tuple[str, str, str, str, str, str]] = []
        for dimension, (entity_type, predicate, display_label) in DIMENSION_SCHEMA.items():
            for value, patterns in DIRECT_PATTERNS[dimension].items():
                if dimension == "function" and value in FUNCTION_VALUES_EXCLUDED_FROM_FACT_MIGRATION:
                    continue
                matched = find_pattern_evidence(raw, patterns)
                if matched:
                    field, excerpt = matched
                    facts.append((entity_type, predicate, display_label, value, field, excerpt))

        if family in PHYSICAL_FAMILIES:
            facts.extend(
                ("Material", "HAS_MATERIAL", "材质", value, field, excerpt)
                for value, field, excerpt in material_facts(raw)
            )

        for entity_type, predicate, display_label, value, field, excerpt in facts:
            concept_id = stable_id(entity_type.lower(), value)
            entities.setdefault(concept_id, {
                "id": concept_id,
                "entityType": entity_type,
                "name": value,
                "properties": entity_properties(entity_type, value),
            })
            evidence_id = stable_id("evidence", product_id, predicate, concept_id, field, excerpt)
            assertion_id = stable_id("assertion", product_id, predicate, concept_id)
            evidence.append({
                "id": evidence_id,
                "sourceType": "official_product_page",
                "pageName": product_name,
                "url": first_url(raw),
                "sourceField": field,
                "excerpt": excerpt,
                "sourceHash": hashlib.sha256(excerpt.encode("utf-8")).hexdigest().upper(),
                "retrievedAt": "",
                "validFrom": "",
                "validTo": "",
            })
            assertions.append({
                "id": assertion_id,
                "subjectId": product_id,
                "predicate": predicate,
                "objectId": concept_id,
                "objectValue": None,
                "qualifiers": {},
                "relationLayer": "fact",
                "evidenceIds": [evidence_id],
                "supportingAssertionIds": [],
                "generationMethod": "controlled_source_pattern",
                "confidence": 1.0,
                "reviewStatus": "approved",
                "reviewer": "source_audit_v1",
                "decisionReason": "Official product-page text directly matches the approved vocabulary rule",
            })
            assertion_rows.append({
                "product_concept_key": product_key,
                "product_name": product_name,
                "core_family": family,
                "predicate": predicate,
                "object_type": entity_type,
                "object_name": value,
                "source_field": field,
                "evidence_excerpt": excerpt,
                "source_url": first_url(raw),
                "review_status": "approved",
                "display_label": display_label,
            })

    entity_list = sorted(entities.values(), key=lambda item: (str(item["entityType"]), str(item["name"]), str(item["id"])))
    assertions.sort(key=lambda item: (str(item["subjectId"]), str(item["predicate"]), str(item["objectId"])))
    evidence.sort(key=lambda item: str(item["id"]))
    counts = Counter(assertion["predicate"] for assertion in assertions)
    concept_counts = Counter(entity["entityType"] for entity in entity_list if entity["entityType"] != "ProductConcept")
    material_product_ids = {
        assertion["subjectId"] for assertion in assertions if assertion["predicate"] == "HAS_MATERIAL"
    }
    non_physical_material_products = [
        entities[product_id]["name"] for product_id in material_product_ids
        if entities[product_id]["properties"]["coreFamily"] not in PHYSICAL_FAMILIES
    ]
    duplicate_assertions = len(assertions) - len({
        (item["subjectId"], item["predicate"], item["objectId"]) for item in assertions
    })
    failures = []
    if len(grouped) != 350:
        failures.append(f"Expected 350 ProductConcepts, found {len(grouped)}")
    if duplicate_assertions:
        failures.append(f"Duplicate assertions: {duplicate_assertions}")
    if non_physical_material_products:
        failures.append(f"Material leaked outside physical families: {len(non_physical_material_products)}")
    if any(not item["evidenceIds"] for item in assertions):
        failures.append("Assertion without evidence")

    dataset = {
        "schemaVersion": "1.0.0",
        "datasetStatus": "source_audited_candidate",
        "sourceRows": len(raw_rows),
        "productConcepts": len(grouped),
        "entities": entity_list,
        "assertions": assertions,
        "evidence": evidence,
        "summary": {
            "status": "PASS" if not failures else "FAIL",
            "assertionCounts": dict(sorted(counts.items())),
            "conceptCounts": dict(sorted(concept_counts.items())),
            "productsWithSemanticFacts": len({item["subjectId"] for item in assertions}),
            "nonPhysicalMaterialProducts": non_physical_material_products,
            "duplicateAssertions": duplicate_assertions,
            "failures": failures,
        },
    }
    OUTPUT_PATH.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with ASSERTION_CSV_PATH.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(assertion_rows[0]))
        writer.writeheader()
        writer.writerows(assertion_rows)
    write_report(dataset)
    print(f"Semantic fact dataset: {OUTPUT_PATH}")
    print(f"Assertions: {len(assertions)}, products covered: {dataset['summary']['productsWithSemanticFacts']}")
    print(f"Validation: {dataset['summary']['status']}")
    if failures:
        raise SystemExit("; ".join(failures))


def write_report(dataset: dict[str, object]) -> None:
    summary = dataset["summary"]
    lines = [
        "# Schema v1 共享语义事实迁移",
        "",
        "## 边界",
        "",
        "本候选集只发布官网字段可直接支撑、且已经进入受控词表的共享语义事实。产品形态推导功能、未归一工艺长文和模型推荐均不会进入已审核事实层。",
        "",
        "## 结果",
        "",
        f"- ProductConcept：{dataset['productConcepts']}",
        f"- 有共享语义事实的商品：{summary['productsWithSemanticFacts']}",
        f"- 事实断言：{len(dataset['assertions'])}",
        f"- 校验：{summary['status']}",
        "",
        "| Predicate | Assertions |",
        "| --- | ---: |",
    ]
    for predicate, count in summary["assertionCounts"].items():
        lines.append(f"| `{predicate}` | {count} |")
    lines += [
        "",
        "## 发布规则",
        "",
        "- 每条断言包含官网 URL、来源字段和命中原文片段。",
        "- `Material` 仅允许艺术家居与文创商品进入，避免香材词串入物理材质。",
        "- `Function`、`UseScene`、`UserNeed`、`CareInstruction` 使用共享实体，多个商品连接同一节点。",
        "- 未命中不代表商品没有该属性，只表示当前官方资料不足以发布该事实。",
    ]
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
