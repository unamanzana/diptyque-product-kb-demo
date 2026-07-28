from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict

import audit_ontology_schema_v1_coverage as audit
import run_ontology_schema_v1_coverage_audit as strict_audit


PHYSICAL_CRAFT_PATTERN = re.compile(r"压制玻璃|吹制玻璃|陶瓷|瓷器|手工制作|工匠|铸造|金工")


def refresh_summary(rows: list[dict[str, str]]) -> dict[str, object]:
    summary = json.loads(audit.OUTPUT_JSON.read_text(encoding="utf-8"))
    coverage = {}
    for dimension in strict_audit.DIMENSIONS:
        counts = Counter(row[f"{dimension}_status"] for row in rows)
        coverage[dimension] = {
            "direct": counts["direct"], "candidate": counts["candidate"],
            "none": counts["none"], "direct_rate": audit.pct(counts["direct"], len(rows)),
        }
    families = {}
    for family in sorted({row["core_family"] for row in rows}):
        family_rows = [row for row in rows if row["core_family"] == family]
        families[family] = {
            "products": len(family_rows),
            "sku_count": sum(int(row["sku_count"]) for row in family_rows),
            "direct_coverage": {
                dimension: sum(row[f"{dimension}_status"] == "direct" for row in family_rows)
                for dimension in strict_audit.DIMENSIONS
            },
        }
    summary["coverage"] = coverage
    summary["families"] = families
    summary["manual_review_flags"] = dict(Counter(
        flag for row in rows for flag in row["manual_review_flags"].split("|") if flag
    ).most_common())
    return summary


def main() -> None:
    strict_audit.main()
    rows = strict_audit.read_rows()
    raw_rows, clean_rows = audit.read_csv(audit.RAW_PATH), audit.read_csv(audit.CLEAN_PATH)
    clean_by_sku = {row["sku"]: row for row in clean_rows}
    craft_text_by_key: dict[str, list[str]] = defaultdict(list)
    for raw in raw_rows:
        text = (raw.get("savoir_faire_text") or "").strip()
        if text:
            key = clean_by_sku[raw["sku"]]["product_concept_key"]
            if text not in craft_text_by_key[key]:
                craft_text_by_key[key].append(text)

    for row in rows:
        flags = {flag for flag in row["manual_review_flags"].split("|") if flag}
        function_values = [value for value in row["function_values"].split("|") if value]
        if "香氛蜡烛" in row["product_form"] and "蜡烛养护" in function_values:
            function_values.remove("蜡烛养护")
            flags.add("care_instruction_not_product_function")
            if function_values:
                row["function_status"] = "direct"
            else:
                candidates = sorted({
                    value for token, value in audit.FORM_FUNCTION_CANDIDATES.items()
                    if token in row["product_form"]
                })
                function_values = candidates
                row["function_status"] = "candidate" if candidates else "none"
                row["function_evidence_fields"] = ""
            row["function_values"] = "|".join(function_values)

        craft_text = "\n".join(craft_text_by_key.get(row["product_concept_key"], []))
        if row["craft_status"] == "candidate" and PHYSICAL_CRAFT_PATTERN.search(craft_text):
            if row["core_family"] == "家居香氛" and "香氛蜡烛" in row["product_form"]:
                row["craft_status"] = "direct"
                flags.discard("craft_copy_outside_physical_family")
            elif row["core_family"] != "家居香氛":
                flags.add("cross_family_duplicate_craft_copy")

        row["manual_review_flags"] = "|".join(sorted(flags))
        row["direct_semantic_dimension_count"] = str(sum(
            row[f"{dimension}_status"] == "direct" for dimension in strict_audit.DIMENSIONS
        ))

    strict_audit.write_rows(rows)
    summary = refresh_summary(rows)
    audit.OUTPUT_JSON.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    audit.write_report(summary)
    print("Removed care-only statements from Function and reviewed physical craft context")


if __name__ == "__main__":
    main()
