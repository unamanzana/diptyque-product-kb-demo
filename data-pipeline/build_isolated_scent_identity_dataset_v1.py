from __future__ import annotations

import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

import build_scent_identity_migration_v1 as migration


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
COVERAGE_PATH = ROOT / "diptyque_ontology_schema_v1_coverage.csv"
MIGRATION_PATH = ROOT / "diptyque_scent_identity_migration_v1.json"
LEGACY_NODES_PATH = ROOT / "diptyque_graph_nodes.csv"
LEGACY_EDGES_PATH = ROOT / "diptyque_graph_edges.csv"
OUTPUT_PATH = ROOT / "diptyque_isolated_scent_identity_dataset_v1.json"
AUDIT_PATH = ROOT / "diptyque_global_scent_identity_conflict_audit_v1.json"
REPORT_PATH = REPO / "docs" / "ontology" / "global-scent-identity-conflict-audit-v1.md"
PROHIBITED_TYPED_IDENTITIES = {
    ("HomeScent", "希腊无花果"),
}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def short_hash(value: str, length: int = 16) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:length]


def merge_raw(rows: list[dict[str, str]]) -> dict[str, list[str]]:
    merged = {}
    for field in rows[0]:
        merged[field] = list(dict.fromkeys(
            value for row in rows if (value := (row.get(field) or "").strip())
        ))
    return merged


def scent_type(family: str) -> str:
    if family in {"个人香氛", "身体护理"}:
        return "SignatureFragrance"
    if family == "家居香氛":
        return "HomeScent"
    raise ValueError(f"Unsupported ScentIdentity family: {family}")


def scent_id(identity_type: str, name: str, existing: dict[tuple[str, str], str]) -> str:
    known = existing.get((identity_type, name))
    if known:
        return known
    prefix = "signature" if identity_type == "SignatureFragrance" else "home"
    return f"scent:{prefix}:{short_hash(identity_type + '|' + name, 12)}"


def raw_evidence(raw: dict[str, list[str]], name: str) -> tuple[str, str]:
    preferred = ("fragrance", "category_names", "pdp_short_description", "pdp_long_description", "description_text", "story_text")
    hits = []
    for field in preferred:
        matching = [value for value in raw.get(field, []) if name in value]
        if matching:
            hits.append((field, matching[0]))
    if not hits:
        raise ValueError(f"Direct scent identity lacks retained raw evidence: {name}")
    fields = "|".join(field for field, _ in hits[:3])
    excerpt = "；".join(value.replace("\n", " ").strip() for _, value in hits[:3])
    return fields, excerpt[:900]


def main() -> None:
    coverage = read_csv(COVERAGE_PATH)
    clean_rows = read_csv(migration.CLEAN_PATH)
    raw_rows = read_csv(migration.RAW_PATH)
    reviewed_package = json.loads(MIGRATION_PATH.read_text(encoding="utf-8"))
    raw_hash = migration.file_sha256(migration.RAW_PATH)

    clean_by_key: dict[str, list[dict[str, str]]] = defaultdict(list)
    concepts_by_spu: dict[str, set[str]] = defaultdict(set)
    raw_by_sku = {row["sku"]: row for row in raw_rows}
    for row in clean_rows:
        clean_by_key[row["product_concept_key"]].append(row)
        if row["spu"]:
            concepts_by_spu[row["spu"]].add(row["product_concept_key"])

    entities = {entity["id"]: entity for entity in reviewed_package["entities"]}
    assertions = {assertion["id"]: assertion for assertion in reviewed_package["assertions"]}
    evidence = {item["id"]: item for item in reviewed_package["evidence"]}
    existing_scents = {
        (entity["properties"]["scentIdentityType"], entity["name"]): entity["id"]
        for entity in entities.values() if entity["entityType"] == "ScentIdentity"
    }

    direct_rows = [row for row in coverage if row["scent_identity_status"] == "direct"]
    for row in sorted(direct_rows, key=lambda item: item["product_concept_key"]):
        key = row["product_concept_key"]
        variants = clean_by_key[key]
        if not variants:
            raise ValueError(f"Coverage ProductConcept is absent from cleaned data: {key}")
        names = [name for name in row["scent_identity_values"].split("|") if name]
        if len(names) != 1:
            raise ValueError(f"Standard ProductConcept must have one direct scent identity: {key} -> {names}")
        name = names[0]
        first = variants[0]
        identity_type = scent_type(row["core_family"])
        target_id = scent_id(identity_type, name, existing_scents)
        existing_scents.setdefault((identity_type, name), target_id)
        product_id = migration.product_entity_id(key, first["spu"], concepts_by_spu)
        entities.setdefault(product_id, {
            "id": product_id,
            "entityType": "ProductConcept",
            "name": row["product_name"],
            "properties": {
                "productConceptKey": key,
                "spu": first["spu"] or None,
                "coreFamily": row["core_family"],
                "productForm": row["product_form"],
                "skuCodes": sorted({variant["sku"] for variant in variants if variant["sku"]}),
            },
        })
        entities.setdefault(target_id, {
            "id": target_id,
            "entityType": "ScentIdentity",
            "name": name,
            "properties": {
                "officialName": name,
                "localizedName": name,
                "aliases": [],
                "scentIdentityType": identity_type,
                "vocabularyStatus": "approved",
            },
        })
        raw = merge_raw([raw_by_sku[variant["sku"]] for variant in variants])
        try:
            source_field, excerpt = raw_evidence(raw, name)
        except ValueError as error:
            raise ValueError(f"{error} (product_concept_key={key})") from error
        relation_seed = f"{product_id}|HAS_SCENT|{target_id}"
        assertion_id = f"assertion:has_scent:{short_hash(relation_seed)}"
        evidence_id = f"evidence:has_scent:{short_hash(relation_seed + '|' + source_field)}"
        assertions[assertion_id] = {
            "id": assertion_id,
            "subjectId": product_id,
            "predicate": "HAS_SCENT",
            "objectId": target_id,
            "objectValue": None,
            "qualifiers": {
                "scentIdentityType": identity_type,
                "evidenceStrength": "structured_identity_mapping",
            },
            "relationLayer": "fact",
            "evidenceIds": [evidence_id],
            "supportingAssertionIds": [],
            "generationMethod": "source_mapping",
            "confidence": 1.0,
            "reviewStatus": "approved",
            "reviewer": "source_audit",
            "decisionReason": "Official structured identity field or category explicitly supports the scent identity.",
        }
        evidence[evidence_id] = {
            "id": evidence_id,
            "sourceType": "official_product_page",
            "pageName": row["product_name"],
            "url": row["source_url"],
            "sourceField": source_field,
            "excerpt": excerpt,
            "sourceHash": raw_hash,
            "retrievedAt": None,
            "validFrom": None,
            "validTo": None,
        }

    package = {
        "schemaVersion": "1.0.0",
        "datasetId": "isolated-scent-identity-v1",
        "datasetStatus": "isolated_validated_not_published",
        "sourceSnapshot": reviewed_package["sourceSnapshot"],
        "inputs": {
            "directCoverageCount": len(direct_rows),
            "reviewedMigrationCount": reviewed_package["reviewInput"]["approvedCount"],
            "pendingExcludedCount": len(reviewed_package["excludedPending"]),
        },
        "entities": sorted(entities.values(), key=lambda item: item["id"]),
        "assertions": sorted(assertions.values(), key=lambda item: item["id"]),
        "evidence": sorted(evidence.values(), key=lambda item: item["id"]),
        "excludedPending": reviewed_package["excludedPending"],
        "publicationEffect": {"graphEdgesAdded": 0, "frontendRecordsChanged": 0},
    }
    audit = validate_and_audit(package)
    OUTPUT_PATH.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    AUDIT_PATH.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_report(package, audit)
    print(f"Isolated dataset: {OUTPUT_PATH}")
    print(f"Facts: {len(package['assertions'])}, ScentIdentity: {sum(e['entityType']=='ScentIdentity' for e in package['entities'])}")
    print(f"Blocking failures: {len(audit['blockingFailures'])}")
    if audit["blockingFailures"]:
        raise SystemExit(1)


def validate_and_audit(package: dict[str, object]) -> dict[str, object]:
    entities = package["entities"]
    assertions = package["assertions"]
    evidence = package["evidence"]
    entity_by_id = {item["id"]: item for item in entities}
    evidence_by_id = {item["id"]: item for item in evidence}
    failures = []
    product_targets: dict[str, set[str]] = defaultdict(set)
    for assertion in assertions:
        if assertion["predicate"] != "HAS_SCENT":
            failures.append(f"Unexpected predicate: {assertion['id']}")
        if assertion["subjectId"] not in entity_by_id or assertion["objectId"] not in entity_by_id:
            failures.append(f"Unresolved entity reference: {assertion['id']}")
        if assertion["objectValue"] is not None:
            failures.append(f"HAS_SCENT must not use objectValue: {assertion['id']}")
        if assertion["reviewStatus"] != "approved" or assertion["relationLayer"] != "fact":
            failures.append(f"Non-approved or non-fact assertion: {assertion['id']}")
        if not assertion["evidenceIds"] or any(item not in evidence_by_id for item in assertion["evidenceIds"]):
            failures.append(f"Missing evidence: {assertion['id']}")
        product_targets[assertion["subjectId"]].add(assertion["objectId"])
    for product_id, targets in product_targets.items():
        if len(targets) > 1:
            failures.append(f"ProductConcept has multiple ScentIdentity targets: {product_id}")
    if len(assertions) != 162:
        failures.append(f"Expected 162 approved facts, found {len(assertions)}")
    if len(evidence) != len(assertions):
        failures.append("Every fact must retain one dedicated evidence record")

    scent_entities = [item for item in entities if item["entityType"] == "ScentIdentity"]
    prohibited_typed_identities = sorted(
        f"{entity['properties']['scentIdentityType']}|{entity['name']}"
        for entity in scent_entities
        if (entity["properties"]["scentIdentityType"], entity["name"]) in PROHIBITED_TYPED_IDENTITIES
    )
    if prohibited_typed_identities:
        failures.append(f"Prohibited typed ScentIdentity exists: {prohibited_typed_identities}")
    typed_names: dict[tuple[str, str], set[str]] = defaultdict(set)
    labels: dict[str, dict[str, str]] = defaultdict(dict)
    for entity in scent_entities:
        identity_type = entity["properties"]["scentIdentityType"]
        typed_names[(identity_type, entity["name"])].add(entity["id"])
        labels[entity["name"]][identity_type] = entity["id"]
    duplicate_typed_names = {
        f"{kind}|{name}": sorted(ids) for (kind, name), ids in typed_names.items() if len(ids) > 1
    }
    if duplicate_typed_names:
        failures.append("Same typed identity name maps to multiple IDs")

    same_label_cross_type = {
        name: ids for name, ids in labels.items() if len(ids) > 1
    }
    names_by_type: dict[str, set[str]] = defaultdict(set)
    for entity in scent_entities:
        names_by_type[entity["properties"]["scentIdentityType"]].add(entity["name"])
    suffix_alias_candidates = []
    for identity_type, names in names_by_type.items():
        for name in sorted(names):
            if name.endswith("香调") and name[:-2] in names:
                suffix_alias_candidates.append({
                    "scentIdentityType": identity_type,
                    "shortName": name[:-2],
                    "profileName": name,
                    "decision": "manual_alias_review_required",
                })
    protected_compounds = []
    for identity_type, names in names_by_type.items():
        for short_name, compound_name in (("无花果", "希腊无花果"), ("玫瑰", "玫瑰天竺葵")):
            if short_name in names and compound_name in names:
                protected_compounds.append({
                    "scentIdentityType": identity_type,
                    "shortName": short_name,
                    "compoundName": compound_name,
                    "decision": "keep_distinct",
                })

    legacy_nodes = read_csv(LEGACY_NODES_PATH)
    legacy_edges = read_csv(LEGACY_EDGES_PATH)
    legacy_concepts = {row["name"] for row in legacy_nodes if row["node_type"] == "ScentConcept"}
    legacy_collections = {row["name"] for row in legacy_nodes if row["node_type"] == "CollectionOrScent"}
    legacy_notes = {row["name"] for row in legacy_nodes if row["node_type"] == "NoteIngredient"}
    v1_names = set(labels)
    legacy_audit = {
        "scentConceptNodeCount": len(legacy_concepts),
        "collectionOrScentNodeCount": len(legacy_collections),
        "scentConceptAlsoNoteIngredientCount": len(legacy_concepts & legacy_notes),
        "scentConceptMatchingV1IdentityCount": len(legacy_concepts & v1_names),
        "scentConceptNeitherNoteNorV1IdentityCount": len(legacy_concepts - legacy_notes - v1_names),
        "collectionLabelsMappingToMultipleV1Types": {
            name: labels[name] for name in sorted(legacy_collections & set(same_label_cross_type))
        },
        "hasProductFromScentConcept": sum(
            row["edge_type"] == "HAS_PRODUCT" and row["source_type"] == "ScentConcept" for row in legacy_edges
        ),
        "hasProductFromCollectionOrScent": sum(
            row["edge_type"] == "HAS_PRODUCT" and row["source_type"] == "CollectionOrScent" for row in legacy_edges
        ),
    }
    pending_keys = {item["productConceptKey"] for item in package["excludedPending"]}
    imported_keys = {
        item["properties"].get("productConceptKey")
        for item in entities if item["entityType"] == "ProductConcept"
    }
    leaked_pending = sorted(pending_keys & imported_keys)
    if leaked_pending:
        failures.append(f"Pending ProductConcepts leaked into isolated dataset: {leaked_pending}")

    checks = {
        "productConceptCount": sum(item["entityType"] == "ProductConcept" for item in entities),
        "scentIdentityCount": len(scent_entities),
        "hasScentAssertionCount": len(assertions),
        "evidenceCount": len(evidence),
        "maxScentTargetsPerProduct": max((len(targets) for targets in product_targets.values()), default=0),
        "pendingExcludedCount": len(package["excludedPending"]),
        "sameLabelCrossType": same_label_cross_type,
        "duplicateTypedNames": duplicate_typed_names,
        "prohibitedTypedIdentities": prohibited_typed_identities,
        "suffixAliasCandidates": suffix_alias_candidates,
        "protectedCompoundNames": protected_compounds,
        "retrievedAtMissingCount": sum(item["retrievedAt"] is None for item in evidence),
    }
    return {
        "result": "PASS_WITH_REVIEW_ITEMS" if not failures else "FAIL",
        "blockingFailures": failures,
        "checks": checks,
        "legacyComparison": legacy_audit,
        "publicationEffect": package["publicationEffect"],
    }


def write_report(package: dict[str, object], audit: dict[str, object]) -> None:
    checks = audit["checks"]
    legacy = audit["legacyComparison"]
    lines = [
        "# Schema v1 全量香气身份隔离导入与冲突审计",
        "",
        "## 结果",
        "",
        f"结果：**{audit['result']}**。隔离数据集包含 {checks['productConceptCount']} 个 ProductConcept、{checks['scentIdentityCount']} 个类型化 ScentIdentity、{checks['hasScentAssertionCount']} 条 HAS_SCENT 和 {checks['evidenceCount']} 条 Evidence。没有写入旧图谱或前端。",
        "",
        "- 124 条来自原有直接结构证据。",
        "- 38 条来自已审核名称候选迁移包。",
        f"- {checks['pendingExcludedCount']} 条 pending_review 继续排除。",
        f"- 每个标准 ProductConcept 最多绑定 {checks['maxScentTargetsPerProduct']} 个 ScentIdentity。",
        "",
        "## 全局身份检查",
        "",
        f"- 类型内同名多 ID：{len(checks['duplicateTypedNames'])}。",
        f"- 同名跨 Signature/Home 类型：{len(checks['sameLabelCrossType'])} 组；保留不同 ID。",
        f"- 需要人工裁决的同类型 `香调` 后缀别名：{len(checks['suffixAliasCandidates'])} 组。",
        f"- 明确保留为不同身份的复合名称：{len(checks['protectedCompoundNames'])} 组。",
        "",
        "### 同名跨类型",
        "",
    ]
    for name, typed_ids in checks["sameLabelCrossType"].items():
        lines.append(f"- `{name}`: " + "; ".join(f"{kind}={entity_id}" for kind, entity_id in typed_ids.items()))
    lines += ["", "### 待裁决别名", ""]
    for item in checks["suffixAliasCandidates"]:
        lines.append(f"- {item['scentIdentityType']}: `{item['shortName']}` 与 `{item['profileName']}`，暂不合并。")
    if not checks["suffixAliasCandidates"]:
        lines.append("- 无。")
    lines += ["", "### 受保护复合名称", ""]
    for item in checks["protectedCompoundNames"]:
        lines.append(f"- {item['scentIdentityType']}: `{item['shortName']}` 与 `{item['compoundName']}` 保持不同实体。")

    lines += [
        "",
        "## 与旧图谱的结构差异",
        "",
        f"- 旧图谱有 {legacy['scentConceptNodeCount']} 个 ScentConcept 和 {legacy['collectionOrScentNodeCount']} 个 CollectionOrScent；Schema v1 隔离集只有 {checks['scentIdentityCount']} 个 ScentIdentity。",
        f"- 旧 ScentConcept 中有 {legacy['scentConceptAlsoNoteIngredientCount']} 个名称同时也是 NoteIngredient，说明旧层把香气身份和香材概念混在同一枢纽。",
        f"- 旧图谱从 ScentConcept 发出 {legacy['hasProductFromScentConcept']} 条 HAS_PRODUCT，从 CollectionOrScent 发出 {legacy['hasProductFromCollectionOrScent']} 条 HAS_PRODUCT。Schema v1 改为 ProductConcept -> ScentIdentity 的单向事实边。",
        "- 因此不能把隔离集直接叠加到旧图谱；应先替换身份层，再让 NoteIngredient 只连接 ScentIdentity。",
        "",
        "## 发布前剩余事项",
        "",
        "1. 人工裁决同类型 `玫瑰` 与 `玫瑰香调` 是否为同一 SignatureFragrance；在正式别名字典批准前保持分离。",
        "2. `希腊无花果`仅保留为 Philosykos 的 SignatureFragrance；Figuier 家居商品统一绑定 HomeScent `无花果`，并继续保持 `玫瑰/玫瑰天竺葵`等不同身份。",
        "3. 设计旧 CollectionOrScent、ScentConcept、NoteIngredient 到新实体的替换映射，禁止通过名称直接全量合并。",
        "4. 在前端切换前，生成对比快照并检查所有商品香气查询数量。",
        "",
        f"Provenance 限制：原始快照没有抓取时间，因此 {checks['retrievedAtMissingCount']} 条 Evidence 的 `retrievedAt` 为空，但均保留官方 URL、字段、原文和 CSV 快照哈希。",
    ]
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
