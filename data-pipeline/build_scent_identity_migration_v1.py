from __future__ import annotations

import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
RAW_PATH = ROOT / "diptyque_products.csv"
CLEAN_PATH = ROOT / "diptyque_products_cleaned.csv"
REVIEW_PATH = ROOT / "diptyque_scent_identity_name_review_v1.csv"
OUTPUT_PATH = ROOT / "diptyque_scent_identity_migration_v1.json"
VALIDATION_PATH = ROOT / "diptyque_scent_identity_migration_v1_validation.json"
REPORT_PATH = REPO / "docs" / "ontology" / "scent-identity-migration-v1.md"

RECOMMENDATION_PREDICATES = {
    "PAIRS_WITH", "SCENT_RITUAL_WITH", "EXTENDS_TO_HOME", "LAYER_WITH",
}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def short_hash(value: str, length: int = 12) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:length]


def product_entity_id(product_key: str, spu: str, concepts_by_spu: dict[str, set[str]]) -> str:
    if spu and len(concepts_by_spu[spu]) == 1:
        return f"product:{spu}"
    if spu:
        return f"product:{spu}:{short_hash(product_key, 10)}"
    return f"product:concept:{short_hash(product_key, 16)}"


def main() -> None:
    raw_hash = file_sha256(RAW_PATH)
    raw_rows = read_csv(RAW_PATH)
    clean_rows = read_csv(CLEAN_PATH)
    review_rows = read_csv(REVIEW_PATH)

    clean_by_key: dict[str, list[dict[str, str]]] = defaultdict(list)
    concepts_by_spu: dict[str, set[str]] = defaultdict(set)
    for row in clean_rows:
        key = row["product_concept_key"]
        clean_by_key[key].append(row)
        if row["spu"]:
            concepts_by_spu[row["spu"]].add(key)

    approved = [row for row in review_rows if row["decision"] == "approved"]
    pending = [row for row in review_rows if row["decision"] != "approved"]
    entities: dict[str, dict[str, object]] = {}
    assertions = []
    evidence = []

    for review in sorted(approved, key=lambda row: row["product_concept_key"]):
        key = review["product_concept_key"]
        variants = clean_by_key[key]
        if not variants:
            raise ValueError(f"Missing ProductConcept in cleaned data: {key}")
        first = variants[0]
        spu = first["spu"]
        product_id = product_entity_id(key, spu, concepts_by_spu)
        scent_id = review["proposed_scent_identity_id"]
        entities[product_id] = {
            "id": product_id,
            "entityType": "ProductConcept",
            "name": review["product_name"],
            "properties": {
                "productConceptKey": key,
                "spu": spu or None,
                "coreFamily": review["core_family"],
                "productForm": review["product_form"],
                "skuCodes": sorted({row["sku"] for row in variants if row["sku"]}),
            },
        }
        entities.setdefault(scent_id, {
            "id": scent_id,
            "entityType": "ScentIdentity",
            "name": review["canonical_scent_name"],
            "properties": {
                "officialName": review["canonical_scent_name"],
                "localizedName": review["canonical_scent_name"],
                "aliases": [],
                "scentIdentityType": review["scent_identity_type"],
                "vocabularyStatus": "approved",
            },
        })

        relation_seed = f"{product_id}|HAS_SCENT|{scent_id}"
        assertion_id = f"assertion:has_scent:{short_hash(relation_seed, 16)}"
        evidence_id = f"evidence:has_scent:{short_hash(relation_seed + '|' + review['evidence_field'], 16)}"
        evidence_strength = "structured_field" if review["evidence_field"] == "fragrance" else "explicit_official_copy"
        assertions.append({
            "id": assertion_id,
            "subjectId": product_id,
            "predicate": "HAS_SCENT",
            "objectId": scent_id,
            "objectValue": None,
            "qualifiers": {
                "scentIdentityType": review["scent_identity_type"],
                "evidenceStrength": evidence_strength,
            },
            "relationLayer": "fact",
            "evidenceIds": [evidence_id],
            "supportingAssertionIds": [],
            "generationMethod": "source_mapping",
            "confidence": 1.0,
            "reviewStatus": "approved",
            "reviewer": review["reviewer"],
            "decisionReason": review["decision_reason"],
        })
        evidence.append({
            "id": evidence_id,
            "sourceType": "official_product_page",
            "pageName": review["product_name"],
            "url": review["evidence_url"],
            "sourceField": review["evidence_field"],
            "excerpt": review["evidence_excerpt"],
            "sourceHash": raw_hash,
            "retrievedAt": None,
            "validFrom": None,
            "validTo": None,
        })

    package = {
        "schemaVersion": "1.0.0",
        "migrationId": "scent-identity-name-review-v1",
        "migrationStatus": "ready_for_import_not_published",
        "sourceSnapshot": {
            "path": str(RAW_PATH),
            "rowCount": len(raw_rows),
            "sha256": raw_hash,
        },
        "reviewInput": {
            "path": str(REVIEW_PATH),
            "approvedCount": len(approved),
            "pendingCount": len(pending),
        },
        "entities": sorted(entities.values(), key=lambda entity: entity["id"]),
        "assertions": sorted(assertions, key=lambda assertion: assertion["id"]),
        "evidence": sorted(evidence, key=lambda item: item["id"]),
        "excludedPending": [
            {
                "productConceptKey": row["product_concept_key"],
                "productName": row["product_name"],
                "candidateScentName": row["candidate_scent_name"],
                "reason": row["decision_reason"],
            }
            for row in sorted(pending, key=lambda row: row["product_concept_key"])
        ],
        "publicationEffect": {
            "graphEdgesAdded": 0,
            "frontendRecordsChanged": 0,
        },
    }
    validation = validate(package)
    OUTPUT_PATH.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    VALIDATION_PATH.write_text(json.dumps(validation, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_report(package, validation)
    print(f"Migration package: {OUTPUT_PATH}")
    print(f"Entities: {len(package['entities'])}, assertions: {len(assertions)}, evidence: {len(evidence)}")
    print(f"Validation failures: {len(validation['failures'])}")
    if validation["failures"]:
        raise SystemExit(1)


def validate(package: dict[str, object]) -> dict[str, object]:
    entities = package["entities"]
    assertions = package["assertions"]
    evidence = package["evidence"]
    entity_by_id = {entity["id"]: entity for entity in entities}
    evidence_by_id = {item["id"]: item for item in evidence}
    failures = []

    if len(assertions) != 38:
        failures.append(f"Expected 38 approved assertions, found {len(assertions)}")
    if len(evidence) != len(assertions):
        failures.append("Every HAS_SCENT assertion must have one dedicated evidence record")
    if len({assertion["id"] for assertion in assertions}) != len(assertions):
        failures.append("Assertion IDs are not unique")
    if len(entity_by_id) != len(entities):
        failures.append("Entity IDs are not unique")
    if len(evidence_by_id) != len(evidence):
        failures.append("Evidence IDs are not unique")

    scent_targets: dict[str, set[str]] = defaultdict(set)
    for assertion in assertions:
        if assertion["predicate"] != "HAS_SCENT":
            failures.append(f"Unexpected predicate in migration: {assertion['predicate']}")
        if assertion["predicate"] in RECOMMENDATION_PREDICATES:
            failures.append(f"Recommendation predicate is prohibited: {assertion['id']}")
        if assertion["subjectId"] not in entity_by_id or assertion["objectId"] not in entity_by_id:
            failures.append(f"Unresolved entity reference: {assertion['id']}")
        if assertion["objectValue"] is not None:
            failures.append(f"HAS_SCENT must use objectId only: {assertion['id']}")
        if assertion["reviewStatus"] != "approved" or assertion["relationLayer"] != "fact":
            failures.append(f"Invalid publication status/layer: {assertion['id']}")
        if not assertion["evidenceIds"]:
            failures.append(f"Approved assertion lacks evidence: {assertion['id']}")
        for evidence_id in assertion["evidenceIds"]:
            if evidence_id not in evidence_by_id:
                failures.append(f"Unresolved evidence reference: {assertion['id']} -> {evidence_id}")
        scent_targets[assertion["subjectId"]].add(assertion["objectId"])
    for product_id, targets in scent_targets.items():
        if len(targets) > 1:
            failures.append(f"Standard ProductConcept has multiple ScentIdentity targets: {product_id}")

    pending_keys = {item["productConceptKey"] for item in package["excludedPending"]}
    migrated_keys = {
        entity["properties"].get("productConceptKey")
        for entity in entities if entity["entityType"] == "ProductConcept"
    }
    overlap = sorted(pending_keys & migrated_keys)
    if overlap:
        failures.append(f"Pending candidates leaked into migration: {overlap}")

    label_types: dict[str, dict[str, str]] = defaultdict(dict)
    for entity in entities:
        if entity["entityType"] == "ScentIdentity":
            label_types[entity["name"]][entity["properties"]["scentIdentityType"]] = entity["id"]
    for label, typed_ids in label_types.items():
        if len(typed_ids) > 1 and len(set(typed_ids.values())) != len(typed_ids):
            failures.append(f"Same-label cross-type ScentIdentity IDs collide: {label}")

    checks = {
        "approved_assertion_count": len(assertions),
        "dedicated_evidence_count": len(evidence),
        "product_concept_count": sum(entity["entityType"] == "ProductConcept" for entity in entities),
        "scent_identity_count": sum(entity["entityType"] == "ScentIdentity" for entity in entities),
        "pending_excluded_count": len(package["excludedPending"]),
        "max_scent_targets_per_product": max((len(targets) for targets in scent_targets.values()), default=0),
        "recommendation_assertion_count": sum(assertion["predicate"] in RECOMMENDATION_PREDICATES for assertion in assertions),
        "same_label_cross_type": {
            label: typed_ids for label, typed_ids in label_types.items() if len(typed_ids) > 1
        },
        "retrieved_at_missing_count": sum(item["retrievedAt"] is None for item in evidence),
    }
    return {
        "result": "PASS" if not failures else "FAIL",
        "checks": checks,
        "failures": failures,
    }


def write_report(package: dict[str, object], validation: dict[str, object]) -> None:
    checks = validation["checks"]
    entity_counts = Counter(entity["entityType"] for entity in package["entities"])
    lines = [
        "# ScentIdentity 名称候选迁移包 v1",
        "",
        "## 结果",
        "",
        f"迁移包校验结果：**{validation['result']}**。本包包含 {checks['approved_assertion_count']} 条已审核 `HAS_SCENT` 事实，4 条 pending_review 被明确排除。当前状态为 `ready_for_import_not_published`，尚未写入现有图谱或前端。",
        "",
        "## 包内容",
        "",
        "| Object | Count |",
        "| --- | ---: |",
        f"| ProductConcept | {entity_counts['ProductConcept']} |",
        f"| ScentIdentity | {entity_counts['ScentIdentity']} |",
        f"| HAS_SCENT assertion | {checks['approved_assertion_count']} |",
        f"| Evidence | {checks['dedicated_evidence_count']} |",
        f"| Excluded pending | {checks['pending_excluded_count']} |",
        "",
        "## 结构约束",
        "",
        f"- 每个 ProductConcept 最多绑定 {checks['max_scent_targets_per_product']} 个 ScentIdentity。",
        f"- 推荐关系数量为 {checks['recommendation_assertion_count']}，本包只迁移事实层。",
        "- 每条 approved assertion 都有独立 Evidence，且 subject、object、evidence 引用均可解析。",
        "- ProductConcept ID 优先使用全表唯一 SPU；复用 SPU 才追加概念键哈希消歧。",
        "- 同名 SignatureFragrance 与 HomeScent 使用不同的类型化 ID，不按显示名合并。",
        "",
        "## 同名跨类型检查",
        "",
    ]
    collisions = checks["same_label_cross_type"]
    if collisions:
        for label, typed_ids in collisions.items():
            lines.append(f"- `{label}`: " + "; ".join(f"{kind}={entity_id}" for kind, entity_id in typed_ids.items()))
    else:
        lines.append("- 本迁移批次没有同名跨类型实体。")
    lines += [
        "",
        "## Provenance 限制",
        "",
        f"原始 CSV 没有抓取时间，因此 {checks['retrieved_at_missing_count']} 条 Evidence 的 `retrievedAt` 仍为空；每条 Evidence 已保存官方 URL、字段、原文片段和原始 CSV 快照 SHA-256。",
        "",
        "## 发布边界",
        "",
        "本文件是迁移输入，不是前端图谱快照。下一阶段应先在隔离的 Schema v1 数据集中导入并运行全局身份冲突审计；通过后再决定是否替换当前 `ScentConcept` 关系。禁止直接把本包叠加到旧的香气边上，否则会产生重复关系。",
    ]
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
