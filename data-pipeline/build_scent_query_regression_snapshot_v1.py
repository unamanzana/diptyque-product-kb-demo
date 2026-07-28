from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

import finalize_legacy_scent_replacement_map_v1 as finalized


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
DATASET_PATH = ROOT / "diptyque_isolated_scent_identity_dataset_v1.json"
EDGE_MAP_PATH = ROOT / "diptyque_legacy_scent_edge_replacement_v1.csv"
REVIEW_PATH = ROOT / "diptyque_scent_identity_name_review_v1.csv"
COMPARISON_CSV = ROOT / "diptyque_scent_query_identity_comparison_v1.csv"
SNAPSHOT_PATH = ROOT / "diptyque_scent_query_regression_snapshot_v1.json"
REPORT_PATH = REPO / "docs" / "ontology" / "scent-query-regression-gate-v1.md"


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    finalized.main()
    dataset = json.loads(DATASET_PATH.read_text(encoding="utf-8"))
    edge_map = read_csv(EDGE_MAP_PATH)
    review_rows = read_csv(REVIEW_PATH)
    entities = {entity["id"]: entity for entity in dataset["entities"]}
    product_names = {
        entity["id"]: entity["name"]
        for entity in dataset["entities"] if entity["entityType"] == "ProductConcept"
    }
    scents = [entity for entity in dataset["entities"] if entity["entityType"] == "ScentIdentity"]
    scent_index = {
        (entity["properties"]["scentIdentityType"], entity["name"]): entity["id"]
        for entity in scents
    }
    for entity in scents:
        for alias in entity["properties"].get("aliases", []):
            scent_index[(entity["properties"]["scentIdentityType"], alias)] = entity["id"]

    new_products: dict[str, set[str]] = defaultdict(set)
    for assertion in dataset["assertions"]:
        new_products[assertion["objectId"]].add(assertion["subjectId"])

    legacy_approved: dict[str, set[str]] = defaultdict(set)
    for row in edge_map:
        if row["action"] == "replace_and_reverse":
            legacy_approved[row["new_target"]].add(row["new_source"])

    pending_products: dict[str, set[str]] = defaultdict(set)
    pending_names: dict[str, dict[str, str]] = {}
    for row in review_rows:
        if row["decision"] == "approved":
            continue
        target_id = scent_index.get((row["scent_identity_type"], row["canonical_scent_name"]))
        if not target_id:
            raise ValueError(f"Pending identity cannot resolve to final ScentIdentity: {row['product_name']}")
        synthetic_product_id = f"pending:{row['product_concept_key']}"
        pending_products[target_id].add(synthetic_product_id)
        pending_names[synthetic_product_id] = {
            "productConceptKey": row["product_concept_key"],
            "productName": row["product_name"],
        }

    comparison_rows = []
    unexpected = []
    for scent in sorted(scents, key=lambda entity: (entity["properties"]["scentIdentityType"], entity["name"])):
        scent_id = scent["id"]
        new_set = new_products[scent_id]
        approved_set = legacy_approved[scent_id]
        pending_set = pending_products[scent_id]
        unexpected_added = sorted(new_set - approved_set)
        unexpected_removed = sorted(approved_set - new_set)
        if unexpected_added or unexpected_removed:
            unexpected.append({
                "scentIdentityId": scent_id,
                "unexpectedAdded": unexpected_added,
                "unexpectedRemoved": unexpected_removed,
            })
        pending_labels = sorted(pending_names[item]["productName"] for item in pending_set)
        comparison_rows.append({
            "scent_identity_id": scent_id,
            "scent_identity_type": scent["properties"]["scentIdentityType"],
            "canonical_name": scent["name"],
            "aliases": "|".join(scent["properties"].get("aliases", [])),
            "legacy_approved_count": str(len(approved_set)),
            "new_count": str(len(new_set)),
            "expected_pending_count": str(len(pending_set)),
            "expected_pending_products": "|".join(pending_labels),
            "unexpected_added_count": str(len(unexpected_added)),
            "unexpected_removed_count": str(len(unexpected_removed)),
            "comparison_status": "exact" if not pending_set else "exact_with_expected_pending_exclusion",
        })

    query_terms: dict[str, list[dict[str, object]]] = defaultdict(list)
    for scent in scents:
        terms = {scent["name"], *scent["properties"].get("aliases", [])}
        product_list = sorted(
            ({"productId": product_id, "productName": product_names[product_id]} for product_id in new_products[scent["id"]]),
            key=lambda item: item["productName"],
        )
        for term in terms:
            query_terms[term].append({
                "scentIdentityId": scent["id"],
                "scentIdentityType": scent["properties"]["scentIdentityType"],
                "canonicalName": scent["name"],
                "matchKind": "canonical" if term == scent["name"] else "typed_alias",
                "productCount": len(product_list),
                "products": product_list,
            })

    query_snapshot = []
    for term, groups in sorted(query_terms.items()):
        groups.sort(key=lambda item: (item["scentIdentityType"], item["canonicalName"]))
        query_snapshot.append({
            "queryTerm": term,
            "resolution": "typed_groups" if len(groups) > 1 else "single_identity",
            "groupCount": len(groups),
            "totalDistinctProducts": len({
                product["productId"] for group in groups for product in group["products"]
            }),
            "groups": groups,
        })

    umbrella_exclusions = dataset["excludedCollectionUmbrellas"]
    snapshot = {
        "schemaVersion": "1.0.0",
        "snapshotId": "scent-query-regression-v1",
        "status": "PASS" if not unexpected else "FAIL",
        "identityComparisons": comparison_rows,
        "queryTerms": query_snapshot,
        "expectedDifferences": {
            "pendingProducts": [
                value for _, value in sorted(pending_names.items(), key=lambda item: item[1]["productName"])
            ],
            "collectionUmbrellaProducts": umbrella_exclusions,
        },
        "gate": {
            "identityCount": len(scents),
            "queryTermCount": len(query_snapshot),
            "ambiguousTypedQueryCount": sum(item["resolution"] == "typed_groups" for item in query_snapshot),
            "newProductFactCount": sum(len(products) for products in new_products.values()),
            "legacyApprovedFactCount": sum(len(products) for products in legacy_approved.values()),
            "expectedPendingExclusionCount": sum(len(products) for products in pending_products.values()),
            "collectionUmbrellaExclusionCount": len(umbrella_exclusions),
            "unexpectedIdentityRegressionCount": len(unexpected),
            "unexpectedIdentityRegressions": unexpected,
        },
        "publicationEffect": {"legacyGraphChanged": 0, "frontendRecordsChanged": 0},
    }
    write_csv(COMPARISON_CSV, comparison_rows)
    SNAPSHOT_PATH.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_report(snapshot)
    print(f"Identity comparisons: {len(comparison_rows)}")
    print(f"Query terms: {len(query_snapshot)}, typed ambiguities: {snapshot['gate']['ambiguousTypedQueryCount']}")
    print(f"Unexpected regressions: {len(unexpected)}")
    if unexpected:
        raise SystemExit(1)


def write_report(snapshot: dict[str, object]) -> None:
    gate = snapshot["gate"]
    pending_rows = [row for row in snapshot["identityComparisons"] if int(row["expected_pending_count"])]
    ambiguous = [row for row in snapshot["queryTerms"] if row["resolution"] == "typed_groups"]
    lines = [
        "# Schema v1 香气查询新旧回归门禁",
        "",
        "## 结果",
        "",
        f"结果：**{snapshot['status']}**。已比较 {gate['identityCount']} 个 ScentIdentity 和 {gate['queryTermCount']} 个用户查询词；新数据的 {gate['newProductFactCount']} 条商品香气事实与旧图谱中已批准替换的 {gate['legacyApprovedFactCount']} 条完全一致，非预期回归为 {gate['unexpectedIdentityRegressionCount']}。",
        "",
        f"预期差异只有 {gate['expectedPendingExclusionCount']} 个 pending 商品和 {gate['collectionUmbrellaExclusionCount']} 个大千之蕴集合商品。它们不会被误报为数据丢失。",
        "",
        "## 待确认商品",
        "",
        "| ScentIdentity | Type | New count | Pending excluded | Product |",
        "| --- | --- | ---: | ---: | --- |",
    ]
    for row in pending_rows:
        lines.append(f"| {row['canonical_name']} | {row['scent_identity_type']} | {row['new_count']} | {row['expected_pending_count']} | {row['expected_pending_products']} |")
    lines += ["", "## 需要分组展示的查询词", ""]
    for query in ambiguous:
        group_text = "；".join(
            f"{group['scentIdentityType']} {group['canonicalName']}={group['productCount']}款"
            for group in query["groups"]
        )
        lines.append(f"- `{query['queryTerm']}`：{group_text}；总计 {query['totalDistinctProducts']} 款。")
    lines += [
        "",
        "`玫瑰`必须按 HomeScent 与 SignatureFragrance/玫瑰香调分组展示；不能重新合并成一个节点。`圣日尔曼大道34号`也采用相同的类型分组规则。`希腊无花果`只解析为 Philosykos 的 SignatureFragrance；Figuier 家居商品统一通过 `无花果`查询。",
        "",
        "## 切换门禁",
        "",
        f"- 所有 {gate['identityCount']} 个身份的 approved 商品集合必须与替换表完全一致。",
        f"- {gate['expectedPendingExclusionCount']} 个 pending 和 {gate['collectionUmbrellaExclusionCount']} 个集合商品必须继续出现在预期差异清单中。",
        "- 不允许出现非预期新增或删除商品。",
        "- 前端对 typed_groups 查询必须展示分组，不得只返回其中一个身份。",
        "- 商品卡片和图谱应使用同一组 ProductConcept ID，避免左右结果不一致。",
        "",
        "通过本门禁后，下一阶段才可以生成 Schema v1 前端候选快照；仍不能直接覆盖当前生产快照。",
    ]
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
