from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RAW_CSV = ROOT / "diptyque_products.csv"
CLEANED_CSV = ROOT / "diptyque_products_cleaned.csv"
RELATIONS_CSV = ROOT / "diptyque_product_relations.csv"
RULES_CSV = ROOT / "diptyque_recommendation_rules.csv"

AUDIT_CSV = ROOT / "diptyque_relationship_coverage_audit.csv"
EDGE_CSV = ROOT / "diptyque_relationship_coverage_edges.csv"
MODEL_INPUT_JSON = ROOT / "diptyque_pairing_model_batch.json"
SUMMARY_JSON = ROOT / "diptyque_relationship_coverage_summary.json"

PAIRING_TYPES = {
    "PAIRS_WITH",
    "LAYER_WITH",
    "SCENT_RITUAL_WITH",
    "EXTENDS_TO_HOME",
    "GIFT_WITH",
    "DISPLAY_WITH",
}
FACT_TYPES = {"REFILL_FOR", "ACCESSORY_FOR", "CONTAINS", "PART_OF_SET"}
SCENT_FAMILIES = {"个人香氛", "身体护理", "家居香氛"}
DECOR_FAMILIES = {"艺术家居", "文创"}

TEXT_FIELDS = [
    "story_text",
    "pdp_short_description",
    "pdp_long_description",
    "detailed_description",
    "description_text",
    "savoir_faire_text",
    "usage_tips_text",
]

AUDIT_FIELDS = [
    "product_key",
    "product_name",
    "core_family",
    "product_form",
    "collections",
    "notes",
    "scent_profiles",
    "scent_accords",
    "materials",
    "variant_tags",
    "sku_count",
    "has_story_text",
    "has_description_text",
    "has_usage_tips",
    "evidence_field_count",
    "is_refill_like_product",
    "is_set_like_product",
    "refill_fact_gap",
    "combination_fact_gap",
    "direct_relation_count",
    "rule_relation_count",
    "total_relation_count",
    "fact_relation_count",
    "recommendation_relation_count",
    "pairing_relation_count",
    "refill_relation_count",
    "accessory_relation_count",
    "relation_types",
    "related_products",
    "has_any_product_relation",
    "has_pairing_relation",
    "needs_pairing_candidate",
    "model_candidate_count",
    "top_model_candidates",
    "audit_status",
    "audit_note",
    "source_url",
]

EDGE_FIELDS = [
    "source_product_key",
    "source_product_name",
    "relation_type",
    "target_product_key",
    "target_product_name",
    "relation_layer",
    "provenance",
    "confidence",
    "review_status",
    "evidence_field",
    "evidence_text",
    "evidence_url",
]


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def split_multi(value: str) -> list[str]:
    return [part.strip() for part in (value or "").split("|") if part.strip()]


def uniq(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def compact_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def is_refill(product: dict[str, object]) -> bool:
    name = str(product["name"])
    tags = set(product["variant_tags"])
    return "补充" in name or "替换" in name or "补充装" in tags


def is_set_like(product: dict[str, object]) -> bool:
    name = str(product["name"])
    form = str(product["product_form"])
    tags = set(product["variant_tags"])
    return any(token in name or token in form for token in ("套装", "礼盒")) or "套装" in tags


def is_candle_form(form: str) -> bool:
    return "蜡烛" in form and "配饰" not in form


def is_candle_accessory_form(form: str) -> bool:
    return any(token in form for token in ("烛台", "烛罩", "烛盖", "灭烛", "托盘", "蜡烛配饰"))


def product_groups(cleaned_rows: list[dict[str, str]], raw_rows: list[dict[str, str]]) -> dict[str, dict[str, object]]:
    raw_by_sku = {
        (row.get("sku") or "").strip(): row
        for row in raw_rows
        if (row.get("sku") or "").strip()
    }
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in cleaned_rows:
        key = (row.get("product_key") or "").strip()
        if key:
            grouped[key].append(row)

    products: dict[str, dict[str, object]] = {}
    for key, rows in grouped.items():
        first = rows[0]
        raw_group = [raw_by_sku.get((row.get("sku") or "").strip(), {}) for row in rows]

        def collect_cleaned(field: str) -> list[str]:
            return uniq([item for row in rows for item in split_multi(row.get(field) or "")])

        field_texts = {
            field: uniq(
                [compact_text(raw.get(field) or "") for raw in raw_group if compact_text(raw.get(field) or "")]
            )
            for field in TEXT_FIELDS
        }
        url = next(
            (
                (raw.get("url") or row.get("url") or "").strip()
                for row, raw in zip(rows, raw_group)
                if (raw.get("url") or row.get("url") or "").strip()
            ),
            "",
        )
        products[key] = {
            "key": key,
            "name": (first.get("product_name") or "").strip(),
            "core_family": (first.get("core_family") or "").strip(),
            "product_form": (first.get("product_form") or "").strip(),
            "collections": collect_cleaned("collection_or_scent"),
            "notes": collect_cleaned("note_tokens"),
            "scent_profiles": collect_cleaned("scent_profiles"),
            "scent_accords": collect_cleaned("scent_accords"),
            "note_families": collect_cleaned("note_families"),
            "materials": collect_cleaned("material_or_craft"),
            "marketing_tags": collect_cleaned("marketing_tags"),
            "variant_tags": collect_cleaned("variant_tags"),
            "category_tokens": collect_cleaned("category_tokens_clean"),
            "sku_count": len(rows),
            "field_texts": field_texts,
            "source_url": url,
        }
    return products


def expand_published_edges(
    products: dict[str, dict[str, object]],
    relation_rows: list[dict[str, str]],
    rule_rows: list[dict[str, str]],
) -> list[dict[str, str]]:
    edges: dict[tuple[str, str, str], dict[str, str]] = {}

    for row in relation_rows:
        if (row.get("review_status") or "").strip() != "approved":
            continue
        source_key = (row.get("source_product_key") or "").strip()
        target_key = (row.get("target_product_key") or "").strip()
        relation_type = (row.get("relation_type") or "").strip()
        if source_key not in products or target_key not in products:
            continue
        edges[(source_key, relation_type, target_key)] = {
            "source_product_key": source_key,
            "source_product_name": str(products[source_key]["name"]),
            "relation_type": relation_type,
            "target_product_key": target_key,
            "target_product_name": str(products[target_key]["name"]),
            "relation_layer": "fact" if relation_type in FACT_TYPES else "recommendation",
            "provenance": "approved_direct_relation",
            "confidence": (row.get("confidence") or "").strip(),
            "review_status": "approved",
            "evidence_field": (row.get("evidence_field") or "").strip(),
            "evidence_text": compact_text(row.get("evidence_text") or ""),
            "evidence_url": (row.get("evidence_url") or "").strip(),
        }

    for rule in rule_rows:
        if (rule.get("review_status") or "").strip() != "approved":
            continue
        source_key = (rule.get("source_product_key") or "").strip()
        if source_key not in products:
            continue
        target_collection = (rule.get("target_collection") or "").strip()
        target_family = (rule.get("target_core_family") or "").strip()
        target_forms = set(split_multi(rule.get("target_product_forms") or ""))
        for target_key, target in products.items():
            if target_key == source_key or is_refill(target):
                continue
            if target_collection and target_collection not in target["collections"]:
                continue
            if target_family and target_family != target["core_family"]:
                continue
            if target_forms and target["product_form"] not in target_forms:
                continue
            relation_type = (rule.get("relation_type") or "").strip()
            edges[(source_key, relation_type, target_key)] = {
                "source_product_key": source_key,
                "source_product_name": str(products[source_key]["name"]),
                "relation_type": relation_type,
                "target_product_key": target_key,
                "target_product_name": str(target["name"]),
                "relation_layer": "recommendation",
                "provenance": "derived_from_approved_rule",
                "confidence": (rule.get("confidence") or "").strip(),
                "review_status": "derived_from_approved_rule",
                "evidence_field": (rule.get("evidence_field") or "").strip(),
                "evidence_text": compact_text(rule.get("evidence_text") or ""),
                "evidence_url": (rule.get("evidence_url") or "").strip(),
            }

    return sorted(
        edges.values(),
        key=lambda edge: (
            edge["source_product_name"],
            edge["relation_type"],
            edge["target_product_name"],
        ),
    )


def candidate_score(source: dict[str, object], target: dict[str, object]) -> tuple[float, list[str]]:
    score = 0.0
    signals: list[str] = []
    source_family = str(source["core_family"])
    target_family = str(target["core_family"])
    source_form = str(source["product_form"])
    target_form = str(target["product_form"])

    shared_collections = sorted(set(source["collections"]).intersection(target["collections"]))
    collection_is_valid = (
        source_family == target_family
        or (source_family in SCENT_FAMILIES and target_family in SCENT_FAMILIES)
    )
    if shared_collections and collection_is_valid:
        score += 8.0
        signals.append("同一已清洗系列:" + "|".join(shared_collections))

    shared_notes = sorted(set(source["notes"]).intersection(target["notes"]))
    if shared_notes and source_family in SCENT_FAMILIES and target_family in SCENT_FAMILIES:
        score += min(6.0, 2.0 * len(shared_notes))
        signals.append("共享香材:" + "|".join(shared_notes[:4]))

    shared_profiles = sorted(set(source["scent_profiles"]).intersection(target["scent_profiles"]))
    if shared_profiles and source_family in SCENT_FAMILIES and target_family in SCENT_FAMILIES:
        score += min(3.0, 1.5 * len(shared_profiles))
        signals.append("共享气味类型:" + "|".join(shared_profiles[:3]))

    shared_accords = sorted(set(source["scent_accords"]).intersection(target["scent_accords"]))
    if shared_accords and source_family in SCENT_FAMILIES and target_family in SCENT_FAMILIES:
        score += min(2.0, len(shared_accords))
        signals.append("共享香调特征:" + "|".join(shared_accords[:3]))

    shared_materials = sorted(set(source["materials"]).intersection(target["materials"]))
    if shared_materials and source_family in DECOR_FAMILIES and target_family in DECOR_FAMILIES:
        score += min(6.0, 3.0 * len(shared_materials))
        signals.append("共享材质工艺:" + "|".join(shared_materials[:3]))

    if {source_family, target_family} == {"个人香氛", "身体护理"}:
        score += 3.0
        signals.append("香水与身体护理互补")

    if is_candle_form(source_form) and target_family == "艺术家居" and is_candle_accessory_form(target_form):
        score += 4.0
        signals.append("蜡烛与家居配饰场景互补")
    if is_candle_form(target_form) and source_family == "艺术家居" and is_candle_accessory_form(source_form):
        score += 4.0
        signals.append("家居配饰与蜡烛场景互补")

    if source_family == target_family and source_form != target_form:
        score += 2.0
        signals.append("同商品家族不同品型")
    elif source_family == target_family:
        score += 0.5
        signals.append("同商品家族")

    if source_family == "文创" and target_family in {"艺术家居", "家居香氛"}:
        score += 1.5
        signals.append("文创与空间使用场景候选")
    if target_family == "文创" and source_family in {"艺术家居", "家居香氛"}:
        score += 1.0
        signals.append("空间产品与文创场景候选")

    return score, signals


def candidate_pool(
    source_key: str,
    products: dict[str, dict[str, object]],
    existing_pairs: set[frozenset[str]],
    limit: int = 12,
) -> list[dict[str, object]]:
    source = products[source_key]
    scored: list[tuple[float, str, list[str]]] = []
    for target_key, target in products.items():
        if target_key == source_key or is_refill(target):
            continue
        if frozenset((source_key, target_key)) in existing_pairs:
            continue
        score, signals = candidate_score(source, target)
        if score <= 0:
            continue
        scored.append((score, target_key, signals))

    scored.sort(key=lambda item: (-item[0], str(products[item[1]]["name"])))
    result: list[dict[str, object]] = []
    for score, target_key, signals in scored[:limit]:
        target = products[target_key]
        result.append(
            {
                "product_key": target_key,
                "product_name": target["name"],
                "core_family": target["core_family"],
                "product_form": target["product_form"],
                "collections": target["collections"],
                "notes": target["notes"],
                "scent_profiles": target["scent_profiles"],
                "scent_accords": target["scent_accords"],
                "materials": target["materials"],
                "pre_score": round(score, 2),
                "deterministic_signals": signals,
                "source_url": target["source_url"],
            }
        )
    return result


def source_payload(product: dict[str, object]) -> dict[str, object]:
    texts = product["field_texts"]
    return {
        "product_key": product["key"],
        "product_name": product["name"],
        "core_family": product["core_family"],
        "product_form": product["product_form"],
        "collections": product["collections"],
        "notes": product["notes"],
        "scent_profiles": product["scent_profiles"],
        "scent_accords": product["scent_accords"],
        "note_families": product["note_families"],
        "materials": product["materials"],
        "marketing_tags": product["marketing_tags"],
        "variant_tags": product["variant_tags"],
        "inspiration_text": texts["story_text"],
        "product_descriptions": uniq(
            texts["pdp_short_description"]
            + texts["pdp_long_description"]
            + texts["detailed_description"]
            + texts["description_text"]
        ),
        "craft_text": texts["savoir_faire_text"],
        "usage_text": texts["usage_tips_text"],
        "source_url": product["source_url"],
    }


def main() -> None:
    products = product_groups(read_csv(CLEANED_CSV), read_csv(RAW_CSV))
    edges = expand_published_edges(products, read_csv(RELATIONS_CSV), read_csv(RULES_CSV))

    edges_by_product: dict[str, list[dict[str, str]]] = defaultdict(list)
    existing_pairs: set[frozenset[str]] = set()
    for edge in edges:
        source_key = edge["source_product_key"]
        target_key = edge["target_product_key"]
        edges_by_product[source_key].append(edge)
        edges_by_product[target_key].append(edge)
        existing_pairs.add(frozenset((source_key, target_key)))

    audit_rows: list[dict[str, object]] = []
    model_tasks: list[dict[str, object]] = []
    status_counts: Counter[str] = Counter()

    for key, product in sorted(products.items(), key=lambda item: str(item[1]["name"])):
        product_edges = edges_by_product.get(key, [])
        direct_edges = [edge for edge in product_edges if edge["provenance"] == "approved_direct_relation"]
        rule_edges = [edge for edge in product_edges if edge["provenance"] == "derived_from_approved_rule"]
        fact_edges = [edge for edge in product_edges if edge["relation_type"] in FACT_TYPES]
        recommendation_edges = [edge for edge in product_edges if edge["relation_type"] not in FACT_TYPES]
        pairing_edges = [edge for edge in product_edges if edge["relation_type"] in PAIRING_TYPES]
        refill_edges = [edge for edge in product_edges if edge["relation_type"] == "REFILL_FOR"]
        accessory_edges = [edge for edge in product_edges if edge["relation_type"] == "ACCESSORY_FOR"]
        candidates = [] if pairing_edges else candidate_pool(key, products, existing_pairs)
        refill_like = is_refill(product)
        set_like = is_set_like(product)
        refill_fact_gap = refill_like and not any(
            edge["relation_type"] in {"REFILL_FOR", "ACCESSORY_FOR"} for edge in product_edges
        )
        combination_fact_gap = set_like and not any(
            edge["relation_type"] in {"CONTAINS", "PART_OF_SET"} for edge in product_edges
        )
        fact_gap_notes: list[str] = []
        if refill_fact_gap:
            fact_gap_notes.append("名称或标签显示为补充类商品，但尚无补充/适配事实关系。")
        if combination_fact_gap:
            fact_gap_notes.append("名称或品型显示为套装/礼盒，但尚无组合内容事实关系。")

        if pairing_edges:
            status = "COVERED_PAIRING"
            note = "已有审核搭配或审核规则推导的商品关系。"
        elif product_edges:
            status = "FACT_ONLY_NEEDS_PAIRING"
            note = "已有补充或适配等事实关系，但尚无搭配推荐。"
        elif candidates:
            status = "NO_RELATION_NEEDS_PAIRING"
            note = "当前没有商品到商品关系，已准备受限候选池供模型评估。"
        else:
            status = "NO_CANDIDATES_MANUAL_REVIEW"
            note = "当前没有商品关系，结构化维度也不足以形成可靠候选池。"
        if fact_gap_notes:
            note += " " + " ".join(fact_gap_notes)

        texts = product["field_texts"]
        related_names = uniq(
            [
                edge["target_product_name"]
                if edge["source_product_key"] == key
                else edge["source_product_name"]
                for edge in product_edges
            ]
        )
        relation_types = sorted({edge["relation_type"] for edge in product_edges})
        evidence_field_count = sum(1 for field in TEXT_FIELDS if texts[field])

        audit_rows.append(
            {
                "product_key": key,
                "product_name": product["name"],
                "core_family": product["core_family"],
                "product_form": product["product_form"],
                "collections": "|".join(product["collections"]),
                "notes": "|".join(product["notes"]),
                "scent_profiles": "|".join(product["scent_profiles"]),
                "scent_accords": "|".join(product["scent_accords"]),
                "materials": "|".join(product["materials"]),
                "variant_tags": "|".join(product["variant_tags"]),
                "sku_count": product["sku_count"],
                "has_story_text": "是" if texts["story_text"] else "否",
                "has_description_text": "是"
                if any(texts[field] for field in ("pdp_short_description", "pdp_long_description", "detailed_description", "description_text"))
                else "否",
                "has_usage_tips": "是" if texts["usage_tips_text"] else "否",
                "evidence_field_count": evidence_field_count,
                "is_refill_like_product": "是" if refill_like else "否",
                "is_set_like_product": "是" if set_like else "否",
                "refill_fact_gap": "是" if refill_fact_gap else "否",
                "combination_fact_gap": "是" if combination_fact_gap else "否",
                "direct_relation_count": len(direct_edges),
                "rule_relation_count": len(rule_edges),
                "total_relation_count": len(product_edges),
                "fact_relation_count": len(fact_edges),
                "recommendation_relation_count": len(recommendation_edges),
                "pairing_relation_count": len(pairing_edges),
                "refill_relation_count": len(refill_edges),
                "accessory_relation_count": len(accessory_edges),
                "relation_types": "|".join(relation_types),
                "related_products": "|".join(related_names),
                "has_any_product_relation": "是" if product_edges else "否",
                "has_pairing_relation": "是" if pairing_edges else "否",
                "needs_pairing_candidate": "否" if pairing_edges else "是",
                "model_candidate_count": len(candidates),
                "top_model_candidates": "|".join(str(candidate["product_name"]) for candidate in candidates[:5]),
                "audit_status": status,
                "audit_note": note,
                "source_url": product["source_url"],
            }
        )
        status_counts[status] += 1

        if not pairing_edges:
            model_tasks.append(
                {
                    "task_id": f"PAIR-{len(model_tasks) + 1:04d}",
                    "source_product": source_payload(product),
                    "existing_product_relations": [
                        {
                            "relation_type": edge["relation_type"],
                            "related_product": edge["target_product_name"]
                            if edge["source_product_key"] == key
                            else edge["source_product_name"],
                            "provenance": edge["provenance"],
                        }
                        for edge in product_edges
                    ],
                    "candidate_products": candidates,
                }
            )

    summary = {
        "generated_at": "2026-07-23",
        "product_count": len(products),
        "published_product_edge_count": len(edges),
        "approved_direct_edge_count": sum(1 for edge in edges if edge["provenance"] == "approved_direct_relation"),
        "approved_rule_derived_edge_count": sum(1 for edge in edges if edge["provenance"] == "derived_from_approved_rule"),
        "products_with_any_relation": sum(1 for row in audit_rows if row["has_any_product_relation"] == "是"),
        "products_with_pairing_relation": sum(1 for row in audit_rows if row["has_pairing_relation"] == "是"),
        "products_needing_pairing_candidate": sum(1 for row in audit_rows if row["needs_pairing_candidate"] == "是"),
        "products_with_story_text": sum(1 for row in audit_rows if row["has_story_text"] == "是"),
        "refill_fact_gap_count": sum(1 for row in audit_rows if row["refill_fact_gap"] == "是"),
        "combination_fact_gap_count": sum(1 for row in audit_rows if row["combination_fact_gap"] == "是"),
        "model_task_count": len(model_tasks),
        "status_counts": dict(status_counts),
    }

    model_batch = {
        "metadata": {
            "generated_at": "2026-07-23",
            "source_product_count": len(products),
            "task_count": len(model_tasks),
            "purpose": "Generate reviewable product-pairing candidates without asserting new facts.",
        },
        "policy": {
            "allowed_relation_types": [
                "PAIRS_WITH",
                "LAYER_WITH",
                "SCENT_RITUAL_WITH",
                "DISPLAY_WITH",
                "GIFT_WITH",
            ],
            "forbidden_inferences": ["REFILL_FOR", "ACCESSORY_FOR", "CONTAINS", "PART_OF_SET"],
            "rules": [
                "Choose targets only from candidate_products.",
                "Treat inspiration, scent and material similarity as recommendation evidence, not product facts.",
                "Do not infer compatibility, fit, refill or set contents without explicit official evidence.",
                "Decorative products sharing a scent word are not automatically part of that fragrance series.",
                "Return no recommendation when evidence is too weak.",
            ],
        },
        "output_schema": {
            "source_product_key": "string",
            "target_product_key": "string",
            "relation_type": "allowed_relation_type",
            "reason": "Chinese concise explanation",
            "evidence_fields": "array of source fields and deterministic signals",
            "confidence": "number 0-1",
            "review_status": "pending_review or insufficient_evidence",
        },
        "tasks": model_tasks,
    }

    with AUDIT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=AUDIT_FIELDS)
        writer.writeheader()
        writer.writerows(audit_rows)
    with EDGE_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=EDGE_FIELDS)
        writer.writeheader()
        writer.writerows(edges)
    with MODEL_INPUT_JSON.open("w", encoding="utf-8") as handle:
        json.dump(model_batch, handle, ensure_ascii=False, indent=2)
    with SUMMARY_JSON.open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)

    print(f"Products: {len(products)}")
    print(f"Published product edges: {len(edges)}")
    print(f"Products with pairing: {summary['products_with_pairing_relation']}")
    print(f"Products needing pairing candidates: {summary['products_needing_pairing_candidate']}")
    print(f"Model tasks: {len(model_tasks)}")
    for status, count in sorted(status_counts.items()):
        print(f"  {status}: {count}")
    print(f"Wrote {AUDIT_CSV}")
    print(f"Wrote {EDGE_CSV}")
    print(f"Wrote {MODEL_INPUT_JSON}")
    print(f"Wrote {SUMMARY_JSON}")


if __name__ == "__main__":
    main()
