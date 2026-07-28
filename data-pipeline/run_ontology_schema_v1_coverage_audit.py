from __future__ import annotations

import csv
import json
from collections import Counter

import audit_ontology_schema_v1_coverage as audit


DIMENSIONS = (
    "scent_identity", "note", "scent_profile", "function", "scene",
    "user_need", "care", "inspiration", "material", "craft", "compatibility",
)


def read_rows() -> list[dict[str, str]]:
    with audit.OUTPUT_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_rows(rows: list[dict[str, str]]) -> None:
    with audit.OUTPUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    audit.main()
    rows = read_rows()
    for row in rows:
        flags = {flag for flag in row["manual_review_flags"].split("|") if flag}
        if "scent_identity_name_only" in flags:
            row["scent_identity_status"] = "candidate"
        if row["craft_status"] == "direct" and row["core_family"] not in audit.PHYSICAL_FAMILIES:
            row["craft_status"] = "candidate"
            flags.add("craft_copy_outside_physical_family")
        row["manual_review_flags"] = "|".join(sorted(flags))
        row["direct_semantic_dimension_count"] = str(sum(
            row[f"{dimension}_status"] == "direct" for dimension in DIMENSIONS
        ))
    write_rows(rows)

    previous = json.loads(audit.OUTPUT_JSON.read_text(encoding="utf-8"))
    coverage = {}
    for dimension in DIMENSIONS:
        counts = Counter(row[f"{dimension}_status"] for row in rows)
        coverage[dimension] = {
            "direct": counts["direct"],
            "candidate": counts["candidate"],
            "none": counts["none"],
            "direct_rate": audit.pct(counts["direct"], len(rows)),
        }
    families = {}
    for family in sorted({row["core_family"] for row in rows}):
        family_rows = [row for row in rows if row["core_family"] == family]
        families[family] = {
            "products": len(family_rows),
            "sku_count": sum(int(row["sku_count"]) for row in family_rows),
            "direct_coverage": {
                dimension: sum(row[f"{dimension}_status"] == "direct" for row in family_rows)
                for dimension in DIMENSIONS
            },
        }
    flags = Counter(
        flag for row in rows for flag in row["manual_review_flags"].split("|") if flag
    )
    previous["coverage"] = coverage
    previous["families"] = families
    previous["manual_review_flags"] = dict(flags.most_common())
    audit.OUTPUT_JSON.write_text(
        json.dumps(previous, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    audit.write_report(previous)
    print("Applied strict evidence-status corrections for name-only scents and non-physical craft copy")


if __name__ == "__main__":
    main()
