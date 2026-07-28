from __future__ import annotations

import json

import build_scent_identity_migration_v1 as migration


PILOT_SCENT_IDS = {
    ("SignatureFragrance", "杜桑"): "scent:do_son",
    ("SignatureFragrance", "奥费恩"): "scent:orpheon",
    ("HomeScent", "浆果香"): "scent:baies",
}


def main() -> None:
    migration.main()
    package = json.loads(migration.OUTPUT_PATH.read_text(encoding="utf-8"))
    id_map = {}
    for entity in package["entities"]:
        if entity["entityType"] != "ScentIdentity":
            continue
        key = (entity["properties"]["scentIdentityType"], entity["name"])
        canonical_id = PILOT_SCENT_IDS.get(key)
        if canonical_id and canonical_id != entity["id"]:
            id_map[entity["id"]] = canonical_id
            entity["id"] = canonical_id

    evidence_by_id = {item["id"]: item for item in package["evidence"]}
    new_evidence = []
    for assertion in package["assertions"]:
        assertion["objectId"] = id_map.get(assertion["objectId"], assertion["objectId"])
        relation_seed = f"{assertion['subjectId']}|HAS_SCENT|{assertion['objectId']}"
        old_evidence = evidence_by_id[assertion["evidenceIds"][0]]
        assertion["id"] = f"assertion:has_scent:{migration.short_hash(relation_seed, 16)}"
        evidence_id = f"evidence:has_scent:{migration.short_hash(relation_seed + '|' + old_evidence['sourceField'], 16)}"
        old_evidence["id"] = evidence_id
        assertion["evidenceIds"] = [evidence_id]
        new_evidence.append(old_evidence)

    package["entities"] = sorted(package["entities"], key=lambda entity: entity["id"])
    package["assertions"] = sorted(package["assertions"], key=lambda assertion: assertion["id"])
    package["evidence"] = sorted(new_evidence, key=lambda item: item["id"])
    package["identityReuse"] = {
        "pilotScentIds": {
            f"{identity_type}|{name}": scent_id
            for (identity_type, name), scent_id in PILOT_SCENT_IDS.items()
        }
    }

    validation = migration.validate(package)
    validation["checks"]["pilot_scent_id_reuse"] = {
        f"{identity_type}|{name}": scent_id
        for (identity_type, name), scent_id in PILOT_SCENT_IDS.items()
    }
    if validation["failures"]:
        raise SystemExit("; ".join(validation["failures"]))
    migration.OUTPUT_PATH.write_text(
        json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    migration.VALIDATION_PATH.write_text(
        json.dumps(validation, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    migration.write_report(package, validation)
    with migration.REPORT_PATH.open("a", encoding="utf-8") as handle:
        handle.write("\n## Pilot 身份复用\n\n")
        handle.write("- `杜桑`复用 `scent:do_son`。\n")
        handle.write("- `奥费恩`复用 `scent:orpheon`。\n")
        handle.write("- HomeScent `浆果香`复用 `scent:baies`。\n")
        handle.write("- 其余新身份保留类型化哈希 ID。\n")
    print(f"Finalized migration with {len(id_map)} Pilot ScentIdentity ID reuses")
    print(f"Validation: {validation['result']}")


if __name__ == "__main__":
    main()
