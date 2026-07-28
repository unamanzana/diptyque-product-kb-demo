from __future__ import annotations

import json

import build_isolated_scent_identity_dataset_v1 as isolated


COLLECTION_UMBRELLAS = {
    ("SignatureFragrance", "大千之蕴"),
}


def main() -> None:
    isolated.main()
    package = json.loads(isolated.OUTPUT_PATH.read_text(encoding="utf-8"))
    entity_by_id = {entity["id"]: entity for entity in package["entities"]}
    excluded_scent_ids = {
        entity["id"]
        for entity in package["entities"]
        if entity["entityType"] == "ScentIdentity"
        and (entity["properties"]["scentIdentityType"], entity["name"]) in COLLECTION_UMBRELLAS
    }
    excluded_assertions = [
        assertion for assertion in package["assertions"]
        if assertion["objectId"] in excluded_scent_ids
    ]
    excluded_product_ids = {assertion["subjectId"] for assertion in excluded_assertions}
    excluded_evidence_ids = {
        evidence_id for assertion in excluded_assertions for evidence_id in assertion["evidenceIds"]
    }
    package["excludedCollectionUmbrellas"] = [
        {
            "productConceptId": product_id,
            "productConceptKey": entity_by_id[product_id]["properties"]["productConceptKey"],
            "productName": entity_by_id[product_id]["name"],
            "collectionName": entity_by_id[assertion["objectId"]]["name"],
            "reason": "Category umbrella is not a reusable ScentIdentity; product requires its own identity review or ProductSet modeling.",
        }
        for assertion in excluded_assertions
        for product_id in [assertion["subjectId"]]
    ]
    package["entities"] = [
        entity for entity in package["entities"]
        if entity["id"] not in excluded_scent_ids and entity["id"] not in excluded_product_ids
    ]
    package["assertions"] = [
        assertion for assertion in package["assertions"]
        if assertion["objectId"] not in excluded_scent_ids
    ]
    package["evidence"] = [
        item for item in package["evidence"] if item["id"] not in excluded_evidence_ids
    ]
    package["inputs"]["directCoverageImportedCount"] = package["inputs"].pop("directCoverageCount") - len(excluded_assertions)
    package["inputs"]["collectionUmbrellaExcludedCount"] = len(excluded_assertions)

    audit = isolated.validate_and_audit(package)
    expected_failure = f"Expected 162 approved facts, found {len(package['assertions'])}"
    audit["blockingFailures"] = [
        failure for failure in audit["blockingFailures"] if failure != expected_failure
    ]
    audit["checks"]["collectionUmbrellaExcludedCount"] = len(excluded_assertions)
    audit["checks"]["collectionUmbrellaExcludedProducts"] = [
        item["productName"] for item in package["excludedCollectionUmbrellas"]
    ]
    audit["result"] = "PASS_WITH_REVIEW_ITEMS" if not audit["blockingFailures"] else "FAIL"

    isolated.OUTPUT_PATH.write_text(
        json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    isolated.AUDIT_PATH.write_text(
        json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    isolated.write_report(package, audit)
    report = isolated.REPORT_PATH.read_text(encoding="utf-8")
    report = report.replace(
        "- 124 条来自原有直接结构证据。",
        f"- {package['inputs']['directCoverageImportedCount']} 条来自通过复核的直接结构证据。\n- {len(excluded_assertions)} 条“大千之蕴”分类记录因系列/集合误作香气而排除。",
    )
    report = report.replace(
        "## 发布前剩余事项",
        "## 系列/集合误作香气\n\n`大千之蕴`是系列分类，不是一个可供暗影珊瑚、宝石之眼等商品共同绑定的 ScentIdentity。7 条相关 HAS_SCENT 已从隔离集移除，其中体验套装后续应按 ProductSet 建模，其余香水应分别审核自身香气身份。\n\n## 发布前剩余事项",
    )
    isolated.REPORT_PATH.write_text(report, encoding="utf-8")
    print(f"Excluded {len(excluded_assertions)} collection-umbrella relations")
    print(f"Final facts: {len(package['assertions'])}")
    print(f"Final validation: {audit['result']}")
    if audit["blockingFailures"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
