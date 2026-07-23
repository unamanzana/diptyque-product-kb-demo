from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CLEANED_CSV = ROOT / "diptyque_products_cleaned.csv"
NODES_CSV = ROOT / "diptyque_graph_nodes.csv"
EDGES_CSV = ROOT / "diptyque_graph_edges.csv"
OUTPUT_CSV = ROOT / "diptyque_scent_concept_audit.csv"


def split_multi(value: str) -> list[str]:
    return [part.strip() for part in (value or "").split("|") if part.strip()]


def main() -> None:
    with CLEANED_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        cleaned_rows = list(csv.DictReader(handle))
    with NODES_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        node_rows = list(csv.DictReader(handle))
    with EDGES_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        edge_rows = list(csv.DictReader(handle))

    product_names = {
        (row.get("product_key") or "").strip(): (row.get("product_name") or "").strip()
        for row in cleaned_rows
    }
    expected: dict[str, set[str]] = defaultdict(set)
    families: dict[str, set[str]] = defaultdict(set)
    forms: dict[str, set[str]] = defaultdict(set)
    for row in cleaned_rows:
        product_key = (row.get("product_key") or "").strip()
        for concept in split_multi(row.get("scent_concepts") or ""):
            expected[concept].add(product_key)
            if row.get("core_family"):
                families[concept].add(row["core_family"])
            if row.get("product_form"):
                forms[concept].add(row["product_form"])

    concept_nodes = {
        row["name"]: row["id"]
        for row in node_rows
        if row.get("node_type") == "ScentConcept"
    }
    actual: dict[str, set[str]] = defaultdict(set)
    evidence: dict[str, set[str]] = defaultdict(set)
    invalid_name_only_edges: list[str] = []
    for row in edge_rows:
        if row.get("source_type") != "ScentConcept" or row.get("target_type") != "Product":
            continue
        concept = row.get("source_name") or ""
        product_id = row.get("target") or ""
        product_key = product_id.removeprefix("product:")
        actual[concept].add(product_key)
        evidence[concept].add(row.get("evidence_text") or "")
        if "product_name" in (row.get("via_field") or ""):
            invalid_name_only_edges.append(f"{concept}->{product_key}")

    audit_rows: list[dict[str, str | int]] = []
    errors: list[str] = []
    for concept in sorted(set(expected) | set(actual)):
        missing = expected[concept] - actual[concept]
        extra = actual[concept] - expected[concept]
        status = "PASS" if not missing and not extra and concept in concept_nodes else "FAIL"
        if status == "FAIL":
            errors.append(concept)
        audit_rows.append(
            {
                "scent_concept": concept,
                "status": status,
                "expected_product_count": len(expected[concept]),
                "actual_edge_count": len(actual[concept]),
                "missing_products": "|".join(product_names[key] for key in sorted(missing)),
                "extra_products": "|".join(product_names.get(key, key) for key in sorted(extra)),
                "core_families": "|".join(sorted(families[concept])),
                "product_forms": "|".join(sorted(forms[concept])),
                "evidence_examples": " || ".join(sorted(evidence[concept])[:5]),
            }
        )

    with OUTPUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(audit_rows[0]))
        writer.writeheader()
        writer.writerows(audit_rows)

    if invalid_name_only_edges:
        errors.extend(invalid_name_only_edges)
    print(f"Scent concepts: {len(audit_rows)}")
    print(f"Concept-to-product edges: {sum(len(values) for values in actual.values())}")
    print(f"Audit failures: {len(errors)}")
    print(f"Wrote {OUTPUT_CSV}")
    if errors:
        raise SystemExit("Scent concept audit failed: " + ", ".join(errors[:20]))


if __name__ == "__main__":
    main()
