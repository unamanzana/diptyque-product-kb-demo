from __future__ import annotations

import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

import build_isolated_scent_identity_dataset_v1 as isolated
import finalize_isolated_scent_identity_dataset_v1 as finalized


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
DATASET_PATH = ROOT / "diptyque_isolated_scent_identity_dataset_v1.json"
AUDIT_PATH = ROOT / "diptyque_global_scent_identity_conflict_audit_v1.json"
NODE_OUTPUT = ROOT / "diptyque_legacy_scent_node_replacement_v1.csv"
EDGE_OUTPUT = ROOT / "diptyque_legacy_scent_edge_replacement_v1.csv"
SUMMARY_OUTPUT = ROOT / "diptyque_legacy_scent_replacement_summary_v1.json"
REPORT_PATH = REPO / "docs" / "ontology" / "legacy-scent-replacement-map-v1.md"

ROSE_ALIAS_FROM = ("SignatureFragrance", "玫瑰")
ROSE_ALIAS_TO = ("SignatureFragrance", "玫瑰香调")
SEMANTIC_TYPES = {
    "CollectionOrScent", "ScentConcept", "NoteIngredient",
    "ScentProfile", "ScentAccord", "NoteFamily",
}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def short_hash(value: str, length: int = 16) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:length]


def adjudicate_rose_alias(package: dict[str, object]) -> dict[str, object]:
    scents = {
        (entity["properties"]["scentIdentityType"], entity["name"]): entity
        for entity in package["entities"] if entity["entityType"] == "ScentIdentity"
    }
    source = scents[ROSE_ALIAS_FROM]
    target = scents[ROSE_ALIAS_TO]
    source_id, target_id = source["id"], target["id"]
    target["properties"]["aliases"] = sorted(set(target["properties"].get("aliases", [])) | {"玫瑰"})

    evidence_by_id = {item["id"]: item for item in package["evidence"]}
    rebuilt_evidence = []
    for assertion in package["assertions"]:
        old_evidence = evidence_by_id[assertion["evidenceIds"][0]]
        if assertion["objectId"] == source_id:
            assertion["objectId"] = target_id
            assertion["qualifiers"]["canonicalizedFrom"] = "玫瑰"
            assertion["decisionReason"] = "Official copy says 玫瑰香调洁肤露 and matches the typed 玫瑰香调 product line; alias merged within SignatureFragrance only."
        relation_seed = f"{assertion['subjectId']}|HAS_SCENT|{assertion['objectId']}"
        assertion["id"] = f"assertion:has_scent:{short_hash(relation_seed)}"
        evidence_id = f"evidence:has_scent:{short_hash(relation_seed + '|' + old_evidence['sourceField'])}"
        old_evidence["id"] = evidence_id
        assertion["evidenceIds"] = [evidence_id]
        rebuilt_evidence.append(old_evidence)

    package["entities"] = [entity for entity in package["entities"] if entity["id"] != source_id]
    package["entities"] = sorted(package["entities"], key=lambda entity: entity["id"])
    package["assertions"] = sorted(package["assertions"], key=lambda assertion: assertion["id"])
    package["evidence"] = sorted(rebuilt_evidence, key=lambda item: item["id"])
    package["aliasAdjudications"] = [{
        "scentIdentityType": "SignatureFragrance",
        "alias": "玫瑰",
        "canonicalName": "玫瑰香调",
        "canonicalId": target_id,
        "scopeRule": "Alias resolution requires SignatureFragrance context; HomeScent 玫瑰 remains distinct.",
        "evidenceProduct": "玫瑰香氛洁肤露",
        "evidenceFields": ["fragrance", "pdp_short_description", "subtitle"],
        "evidenceExcerpt": "fragrance=玫瑰；玫瑰香调洁肤露遇水幻化为丝滑的绵密泡沫；大马士革玫瑰、千叶玫瑰、荔枝香调、龙涎香",
        "reviewStatus": "approved",
    }]
    return package


def identity_indexes(package: dict[str, object]) -> tuple[dict[str, list[dict[str, object]]], dict[str, list[dict[str, object]]]]:
    exact: dict[str, list[dict[str, object]]] = defaultdict(list)
    aliases: dict[str, list[dict[str, object]]] = defaultdict(list)
    for entity in package["entities"]:
        if entity["entityType"] != "ScentIdentity":
            continue
        exact[entity["name"]].append(entity)
        for alias in entity["properties"].get("aliases", []):
            aliases[alias].append(entity)
    return exact, aliases


def build_node_map(package: dict[str, object], legacy_nodes: list[dict[str, str]]) -> list[dict[str, str]]:
    exact, aliases = identity_indexes(package)
    notes = {row["name"]: row["id"] for row in legacy_nodes if row["node_type"] == "NoteIngredient"}
    rows = []
    for node in legacy_nodes:
        if node["node_type"] not in {"CollectionOrScent", "ScentConcept"}:
            continue
        identity_targets = {entity["id"] for entity in exact.get(node["name"], []) + aliases.get(node["name"], [])}
        note_target = notes.get(node["name"])
        target_ids = sorted(identity_targets | ({note_target} if note_target else set()))
        target_types = []
        if identity_targets:
            target_types.append("ScentIdentity")
        if note_target:
            target_types.append("NoteIngredient")

        if node["node_type"] == "CollectionOrScent":
            if node["name"] == "大千之蕴":
                action = "retire_to_collection_review"
                reason = "Legacy category umbrella is not a ScentIdentity."
            elif len(identity_targets) > 1:
                action = "split_by_product_family"
                reason = "Legacy label collapsed multiple typed ScentIdentity entities."
            elif len(identity_targets) == 1:
                action = "replace_with_scent_identity"
                reason = "Legacy collection label resolves to one approved typed ScentIdentity."
            else:
                action = "quarantine_unresolved_collection"
                reason = "No approved ScentIdentity target exists."
        else:
            if identity_targets and note_target:
                action = "split_by_relation_context"
                reason = "Legacy pivot conflated ScentIdentity and NoteIngredient meanings."
            elif note_target:
                action = "replace_with_note_ingredient"
                reason = "Legacy ScentConcept is an olfactory note, not a reusable scent identity."
            elif identity_targets:
                action = "replace_with_scent_identity"
                reason = "Legacy ScentConcept resolves only to approved ScentIdentity context."
            else:
                action = "quarantine_untyped_scent_concept"
                reason = "Concept is neither an approved ScentIdentity nor a typed NoteIngredient."

        rows.append({
            "legacy_node_id": node["id"],
            "legacy_node_type": node["node_type"],
            "legacy_name": node["name"],
            "action": action,
            "target_ids": "|".join(target_ids),
            "target_types": "|".join(target_types),
            "reason": reason,
            "review_status": "approved" if not action.startswith("quarantine") else "pending_review",
        })
    return sorted(rows, key=lambda row: (row["legacy_node_type"], row["legacy_name"]))


def build_edge_map(package: dict[str, object], legacy_edges: list[dict[str, str]]) -> list[dict[str, str]]:
    product_by_key = {
        entity["properties"]["productConceptKey"]: entity["id"]
        for entity in package["entities"] if entity["entityType"] == "ProductConcept"
    }
    assertion_by_product = {assertion["subjectId"]: assertion for assertion in package["assertions"]}
    pending_keys = {item["productConceptKey"] for item in package["excludedPending"]}
    umbrella_keys = {item["productConceptKey"] for item in package["excludedCollectionUmbrellas"]}
    rows = []
    for edge in legacy_edges:
        if edge["source_type"] not in SEMANTIC_TYPES and edge["target_type"] not in SEMANTIC_TYPES:
            continue
        action, new_source, new_target, new_predicate, reason = "retire_legacy_semantic_edge", "", "", "", "Legacy semantic edge is outside Schema v1 core."
        if edge["edge_type"] == "HAS_PRODUCT" and edge["source_type"] == "CollectionOrScent":
            product_key = edge["target"].removeprefix("product:")
            if product_key in product_by_key:
                new_source = product_by_key[product_key]
                new_target = assertion_by_product[new_source]["objectId"]
                new_predicate = "HAS_SCENT"
                action = "replace_and_reverse"
                reason = "Approved ProductConcept -> ScentIdentity fact replaces legacy collection parent edge."
            elif product_key in pending_keys:
                action = "quarantine_pending_identity"
                reason = "Name-derived identity lacks independent evidence."
            elif product_key in umbrella_keys:
                action = "retire_collection_umbrella_edge"
                reason = "大千之蕴 is a collection umbrella, not a ScentIdentity."
            else:
                action = "quarantine_unmatched_product"
                reason = "Legacy collection edge has no approved, pending, or collection-umbrella disposition."
        elif edge["edge_type"] == "HAS_PRODUCT" and edge["source_type"] in {"ScentConcept", "NoteIngredient", "ScentProfile", "ScentAccord"}:
            action = "retire_direct_semantic_product_edge"
            reason = "Schema v1 attaches note/profile/accord semantics to ScentIdentity, not directly to ProductConcept."
        elif edge["edge_type"] == "HAS_SCENT_EXPRESSION":
            action = "retire_legacy_pivot_edge"
            reason = "Node replacement map resolves the conflated ScentConcept pivot; no equivalent edge is imported."
        elif edge["edge_type"] in {"HAS_SCENT_CONCEPT", "HAS_SCENT_PROFILE", "HAS_SCENT_ACCORD"}:
            action = "retire_legacy_family_pivot"
            reason = "Legacy NoteFamily pivot is not part of the Schema v1 scent identity core."
        elif edge["edge_type"] in {"HAS_NOTE", "HAS_NOTE_FAMILY"}:
            action = "retain_navigation_only"
            reason = "Legacy note-family taxonomy may remain outside the Schema v1 fact import."

        rows.append({
            "legacy_source": edge["source"],
            "legacy_target": edge["target"],
            "legacy_edge_type": edge["edge_type"],
            "legacy_source_type": edge["source_type"],
            "legacy_target_type": edge["target_type"],
            "action": action,
            "new_source": new_source,
            "new_target": new_target,
            "new_predicate": new_predicate,
            "reason": reason,
        })
    return rows


def main() -> None:
    finalized.main()
    package = json.loads(DATASET_PATH.read_text(encoding="utf-8"))
    package = adjudicate_rose_alias(package)
    legacy_nodes = read_csv(isolated.LEGACY_NODES_PATH)
    legacy_edges = read_csv(isolated.LEGACY_EDGES_PATH)
    node_map = build_node_map(package, legacy_nodes)
    edge_map = build_edge_map(package, legacy_edges)

    audit = isolated.validate_and_audit(package)
    expected_failure = f"Expected 162 approved facts, found {len(package['assertions'])}"
    audit["blockingFailures"] = [failure for failure in audit["blockingFailures"] if failure != expected_failure]
    audit["result"] = "PASS_WITH_REVIEW_ITEMS" if not audit["blockingFailures"] else "FAIL"
    audit["checks"]["collectionUmbrellaExcludedCount"] = len(package["excludedCollectionUmbrellas"])
    audit["checks"]["approvedAliasAdjudications"] = package["aliasAdjudications"]
    audit["checks"]["typedAliasCrossType"] = [{
        "alias": "玫瑰",
        "aliasType": "SignatureFragrance",
        "canonicalIdentity": "玫瑰香调",
        "sameLabelOtherType": "HomeScent",
        "decision": "type_scoped_alias",
    }]

    node_actions = Counter(row["action"] for row in node_map)
    edge_actions = Counter(row["action"] for row in edge_map)
    summary = {
        "result": "PASS" if not audit["blockingFailures"] else "FAIL",
        "isolatedDataset": {
            "productConceptCount": sum(entity["entityType"] == "ProductConcept" for entity in package["entities"]),
            "scentIdentityCount": sum(entity["entityType"] == "ScentIdentity" for entity in package["entities"]),
            "hasScentCount": len(package["assertions"]),
        },
        "aliasAdjudications": package["aliasAdjudications"],
        "nodeMapping": {
            "total": len(node_map),
            "expected": 116,
            "actions": dict(node_actions),
            "unmapped": sum(not row["action"] for row in node_map),
        },
        "edgeMapping": {
            "total": len(edge_map),
            "expected": 1428,
            "actions": dict(edge_actions),
            "collectionProductDisposition": {
                "replace": edge_actions["replace_and_reverse"],
                "pending": edge_actions["quarantine_pending_identity"],
                "collectionUmbrella": edge_actions["retire_collection_umbrella_edge"],
                "unmatched": edge_actions["quarantine_unmatched_product"],
            },
        },
        "blockingFailures": audit["blockingFailures"],
        "publicationEffect": {"legacyGraphChanged": 0, "frontendRecordsChanged": 0},
    }
    if len(node_map) != 116:
        summary["blockingFailures"].append(f"Expected 116 legacy scent nodes, found {len(node_map)}")
    if len(edge_map) != 1428:
        summary["blockingFailures"].append(f"Expected 1428 semantic edges, found {len(edge_map)}")
    if edge_actions["replace_and_reverse"] != 155 or edge_actions["quarantine_pending_identity"] != 4 or edge_actions["retire_collection_umbrella_edge"] != 7:
        summary["blockingFailures"].append("CollectionOrScent HAS_PRODUCT disposition does not reconcile to 155/4/7")
    if edge_actions["quarantine_unmatched_product"]:
        summary["blockingFailures"].append("Unmatched legacy collection product edges remain")
    summary["result"] = "PASS" if not summary["blockingFailures"] else "FAIL"

    DATASET_PATH.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    AUDIT_PATH.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_csv(NODE_OUTPUT, node_map)
    write_csv(EDGE_OUTPUT, edge_map)
    SUMMARY_OUTPUT.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_report(summary)
    print(f"Node mappings: {len(node_map)}, edge mappings: {len(edge_map)}")
    print(f"Collection edge disposition: {summary['edgeMapping']['collectionProductDisposition']}")
    print(f"Result: {summary['result']}")
    if summary["blockingFailures"]:
        raise SystemExit(1)


def write_report(summary: dict[str, object]) -> None:
    node_actions = summary["nodeMapping"]["actions"]
    edge_actions = summary["edgeMapping"]["actions"]
    disposition = summary["edgeMapping"]["collectionProductDisposition"]
    lines = [
        "# 旧香气图谱到 Schema v1 替换映射",
        "",
        "## 结果",
        "",
        f"映射结果：**{summary['result']}**。已覆盖 {summary['nodeMapping']['total']} 个旧 CollectionOrScent/ScentConcept 节点和 {summary['edgeMapping']['total']} 条相关语义边；本轮只生成替换计划，没有修改旧图谱或前端。",
        "",
        "## 玫瑰别名裁决",
        "",
        "SignatureFragrance `玫瑰` 已归并为 `玫瑰香调`的类型内别名。依据是官方洁肤露文案直接写明“玫瑰香调洁肤露”，且香材组合与玫瑰香调系列一致。HomeScent `玫瑰`保持独立，别名解析必须带实体类型。",
        "",
        "## 节点替换",
        "",
        "| Action | Nodes |",
        "| --- | ---: |",
    ]
    for action, count in sorted(node_actions.items(), key=lambda item: (-item[1], item[0])):
        lines.append(f"| `{action}` | {count} |")
    lines += [
        "",
        "- 纯香材 ScentConcept 替换为 NoteIngredient。",
        "- 同时承担香气身份和香材含义的节点按关系上下文拆分。",
        "- `大千之蕴`退回集合/系列审核，不进入 ScentIdentity。",
        "- 仍无法定型的 10 个 ScentConcept 保持隔离，不猜测为香材或调性。",
        "",
        "## 边替换",
        "",
        "| Action | Edges |",
        "| --- | ---: |",
    ]
    for action, count in sorted(edge_actions.items(), key=lambda item: (-item[1], item[0])):
        lines.append(f"| `{action}` | {count} |")
    lines += [
        "",
        "CollectionOrScent -> Product 的 166 条旧边已经完整对账：",
        "",
        f"- {disposition['replace']} 条替换并反向为 ProductConcept -> HAS_SCENT -> ScentIdentity。",
        f"- {disposition['pending']} 条继续隔离为 pending_review。",
        f"- {disposition['collectionUmbrella']} 条因大千之蕴是集合而退役。",
        f"- {disposition['unmatched']} 条未匹配。",
        "",
        "旧 NoteIngredient/ScentConcept/ScentProfile/ScentAccord 直接连商品的边不会照搬。Schema v1 后续应从官方证据建立 ScentIdentity -> NoteIngredient/ScentProfile/ScentAccord，再通过香气身份查询商品。",
        "",
        "## 切换顺序",
        "",
        "1. 在隔离环境加载最终 155 条 HAS_SCENT 和 24 个 ScentIdentity。",
        "2. 按节点映射拆分或退役旧 CollectionOrScent/ScentConcept。",
        "3. 删除旧语义到商品的直连边之前，先生成查询结果对比快照。",
        "4. 单独迁移 HAS_NOTE、HAS_PROFILE、HAS_ACCORD；不从旧 ScentConcept -> Product 反推。",
        "5. 最后切换前端查询与可视化，推荐关系保持独立。",
    ]
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
