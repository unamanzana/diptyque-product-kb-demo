from __future__ import annotations

import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RAW_CSV = ROOT / "diptyque_products.csv"
CLEANED_CSV = ROOT / "diptyque_products_cleaned.csv"
RELATIONS_CSV = ROOT / "diptyque_product_relations.csv"
REVIEWED_RECOMMENDATION_RELATIONS_CSV = ROOT / "diptyque_reviewed_recommendation_relations.csv"
RULES_CSV = ROOT / "diptyque_recommendation_rules.csv"

AUDIT_CSV = ROOT / "diptyque_relation_coverage_audit.csv"
CANDIDATES_CSV = ROOT / "diptyque_relation_candidates.csv"
EDGE_CSV = ROOT / "diptyque_relation_published_edges.csv"
MODEL_INPUT_JSON = ROOT / "diptyque_pairing_model_batch.json"
SUMMARY_JSON = ROOT / "diptyque_relation_coverage_summary.json"

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

CANDIDATE_FIELDS = [
    "candidate_id",
    "source_product_key",
    "source_product_name",
    "source_core_family",
    "source_product_form",
    "relation_type",
    "relation_label",
    "scenario",
    "target_product_key",
    "target_product_name",
    "target_core_family",
    "target_product_form",
    "pre_score",
    "deterministic_signals",
    "evidence_type",
    "evidence_field",
    "evidence_text",
    "confidence",
    "review_status",
    "risk_flags",
    "source_url",
    "target_url",
    "notes",
]

RELATION_LABELS = {
    "PAIRS_WITH": "搭配",
    "LAYER_WITH": "层叠搭配",
    "SCENT_RITUAL_WITH": "香气延续",
    "EXTENDS_TO_HOME": "延伸至家居",
}

RELATION_SCENARIOS = {
    "PAIRS_WITH": "跨商品搭配",
    "LAYER_WITH": "香气层叠",
    "SCENT_RITUAL_WITH": "身体护理与个人香氛仪式",
    "EXTENDS_TO_HOME": "个人香氛延伸至空间香气",
}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def read_optional_csv(path: Path) -> list[dict[str, str]]:
    return read_csv(path) if path.exists() else []

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


def home_scent_modality(form: str) -> str:
    if "室内香氛蜡" in form:
        return "scented_wax"
    if "蜡烛" in form:
        return "candle"
    if "喷雾" in form:
        return "room_spray"
    if "扩香" in form:
        return "diffuser"
    if "线香" in form:
        return "incense"
    return ""

def numeric_value(value: str) -> float:
    try:
        return float((value or "").strip() or 0)
    except ValueError:
        return 0


def product_row_priority(row: dict[str, str]) -> tuple[bool, bool, float, bool, int]:
    return (
        (row.get("product_name") or "").strip() == (row.get("product_concept_name") or "").strip(),
        numeric_value(row.get("stock") or "") > 0,
        numeric_value(row.get("stock") or ""),
        bool((row.get("fragrance_normalized") or "").strip()),
        len((row.get("category_tokens_clean") or "").strip()),
    )


def sku_variant_key(row: dict[str, str]) -> str:
    size = (row.get("size") or "").strip().upper()
    if size:
        return f"size:{size}"
    return f"source:{(row.get('product_key') or row.get('sku') or '').strip()}"


def product_groups(
    cleaned_rows: list[dict[str, str]], raw_rows: list[dict[str, str]]
) -> tuple[dict[str, dict[str, object]], dict[str, str]]:
    raw_by_sku = {
        (row.get("sku") or "").strip(): row
        for row in raw_rows
        if (row.get("sku") or "").strip()
    }
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    source_to_concept: dict[str, str] = {}
    for row in cleaned_rows:
        source_key = (row.get("product_key") or "").strip()
        key = (row.get("product_concept_key") or "").strip() or source_key
        if source_key and key:
            source_to_concept[source_key] = key
            grouped[key].append(row)

    products: dict[str, dict[str, object]] = {}
    for key, rows in grouped.items():
        first = max(rows, key=product_row_priority)
        ordered_rows = sorted(rows, key=product_row_priority, reverse=True)
        raw_group = [raw_by_sku.get((row.get("sku") or "").strip(), {}) for row in ordered_rows]

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
                for row, raw in zip(ordered_rows, raw_group)
                if (raw.get("url") or row.get("url") or "").strip()
            ),
            "",
        )
        products[key] = {
            "key": key,
            "name": (first.get("product_concept_name") or "").strip() or (first.get("product_name") or "").strip(),
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
            "sku_count": len({sku_variant_key(row) for row in rows}),
            "field_texts": field_texts,
            "source_url": url,
        }
    return products, source_to_concept


def expand_published_edges(
    products: dict[str, dict[str, object]],
    relation_rows: list[dict[str, str]],
    rule_rows: list[dict[str, str]],
    source_to_concept: dict[str, str],
) -> list[dict[str, str]]:
    edges: dict[tuple[str, str, str], dict[str, str]] = {}

    for row in relation_rows:
        if (row.get("review_status") or "").strip() != "approved":
            continue
        raw_source_key = (row.get("source_product_key") or "").strip()
        raw_target_key = (row.get("target_product_key") or "").strip()
        source_key = source_to_concept.get(raw_source_key, raw_source_key)
        target_key = source_to_concept.get(raw_target_key, raw_target_key)
        relation_type = (row.get("relation_type") or "").strip()
        if source_key == target_key or source_key not in products or target_key not in products:
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
        raw_source_key = (rule.get("source_product_key") or "").strip()
        source_key = source_to_concept.get(raw_source_key, raw_source_key)
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


PAIRING_COPY_PATTERN = re.compile(r"搭配|相得益彰|理想伴侣|层叠|叠香|组合使用|配合使用|可摆放|用于摆放")


def target_reference_terms(product: dict[str, object]) -> list[str]:
    form = str(product["product_form"])
    terms: list[str] = []
    canonical_terms = (
        "蜡烛",
        "线香",
        "扩香器",
        "扩香",
        "香皂",
        "护手霜",
        "润肤乳",
        "洁肤露",
        "淡香水",
        "淡香精",
        "香膏",
        "烛罩",
        "烛盖",
        "烛台",
        "灭烛罩",
        "托盘",
        "收纳瓶",
        "花瓶",
        "线香盒",
    )
    for term in canonical_terms:
        if term in form:
            terms.append(term)
    return uniq(terms)


def directed_pairing_copy_evidence(
    describing_product: dict[str, object], target_product: dict[str, object]
) -> tuple[str, str]:
    target_terms = target_reference_terms(target_product)
    if not target_terms:
        return "", ""
    for field in TEXT_FIELDS:
        for text in describing_product["field_texts"][field]:
            if PAIRING_COPY_PATTERN.search(text) and any(term in text for term in target_terms):
                return field, compact_text(text)[:600]
    return "", ""


def pairing_copy_evidence(
    source: dict[str, object], target: dict[str, object]
) -> tuple[str, str]:
    evidence = directed_pairing_copy_evidence(source, target)
    if evidence[0]:
        return evidence
    return directed_pairing_copy_evidence(target, source)

DECOR_IDENTITY_STOP_TERMS = (
    "限量版",
    "陶瓷",
    "玻璃",
    "漆木",
    "金色",
    "白色",
    "香氛",
    "蜡烛",
    "烛盖",
    "烛罩",
    "灭烛罩",
    "烛台",
    "托盘",
    "收纳",
    "花瓶",
    "线香盒",
    "大号",
    "小号",
)


def decor_identity_tokens(product: dict[str, object]) -> set[str]:
    value = str(product["name"])
    for term in DECOR_IDENTITY_STOP_TERMS:
        value = value.replace(term, " ")
    value = re.sub(r"[A-Za-z0-9（）()\-—_/·]+", " ", value)
    return {
        token
        for token in re.findall(r"[\u4e00-\u9fff]{2,}", value)
        if len(token) >= 2
    }


def decor_identity_aligned(source: dict[str, object], target: dict[str, object]) -> bool:
    return bool(decor_identity_tokens(source).intersection(decor_identity_tokens(target)))

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

    shared_collections = set(source["collections"]).intersection(target["collections"])
    shared_materials = set(source["materials"]).intersection(target["materials"])
    explicit_pairing = bool(pairing_copy_evidence(source, target)[0])
    cross_scent_step = source_family != target_family and source_family in SCENT_FAMILIES and target_family in SCENT_FAMILIES
    same_body_ritual = (
        source_family == target_family == "身体护理" and source_form != target_form
    )
    source_home_modality = home_scent_modality(source_form)
    target_home_modality = home_scent_modality(target_form)
    same_home_ritual = (
        source_family == target_family == "家居香氛"
        and bool(source_home_modality)
        and bool(target_home_modality)
        and source_home_modality != target_home_modality
    )
    same_family_ritual = same_body_ritual or same_home_ritual
    same_collection_candidate = bool(shared_collections) and (
        cross_scent_step or same_family_ritual or explicit_pairing
    )
    decor_candidate = (
        source_family in DECOR_FAMILIES
        and target_family in DECOR_FAMILIES
        and explicit_pairing
        and decor_identity_aligned(source, target)
    )
    candle_accessory_candidate = explicit_pairing and (
        (is_candle_form(source_form) and is_candle_accessory_form(target_form))
        or (is_candle_form(target_form) and is_candle_accessory_form(source_form))
    )
    if not (same_collection_candidate or decor_candidate or candle_accessory_candidate):
        return 0.0, []

    return score, signals


def candidate_pool(
    source_key: str,
    products: dict[str, dict[str, object]],
    existing_pairs: set[frozenset[str]],
    limit: int = 8,
) -> list[dict[str, object]]:
    source = products[source_key]
    if is_refill(source) or is_set_like(source):
        return []
    scored: list[tuple[float, str, list[str]]] = []
    for target_key, target in products.items():
        if target_key == source_key or is_refill(target) or is_set_like(target):
            continue
        if frozenset((source_key, target_key)) in existing_pairs:
            continue
        score, signals = candidate_score(source, target)
        if score < 4.0:
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


def contains_layering_signal(product: dict[str, object]) -> bool:
    return any(
        re.search(r"层叠搭配|叠香|层叠", text)
        for values in product["field_texts"].values()
        for text in values
    )


def best_evidence(product: dict[str, object]) -> tuple[str, str]:
    for field in (
        "story_text",
        "pdp_long_description",
        "pdp_short_description",
        "usage_tips_text",
        "description_text",
        "detailed_description",
    ):
        values = product["field_texts"][field]
        if values:
            return field, compact_text(str(values[0]))[:600]
    return "structured_dimensions", ""


def candidate_confidence(score: float) -> str:
    if score >= 14:
        return "0.79"
    if score >= 10:
        return "0.74"
    if score >= 7:
        return "0.68"
    return "0.60"


def candidate_id(source_key: str, relation_type: str, target_key: str) -> str:
    payload = f"{source_key}|{relation_type}|{target_key}".encode("utf-8")
    return "CAND-" + hashlib.sha1(payload).hexdigest()[:12].upper()


def make_candidate_row(
    source: dict[str, object],
    target: dict[str, object],
    score: float,
    signals: list[str],
) -> dict[str, str]:
    source_family = str(source["core_family"])
    target_family = str(target["core_family"])
    shared_collections = set(source["collections"]).intersection(target["collections"])
    scent_pair = source_family in SCENT_FAMILIES and target_family in SCENT_FAMILIES

    relation_type = "PAIRS_WITH"
    if shared_collections and scent_pair and contains_layering_signal(source):
        relation_type = "LAYER_WITH"
    elif shared_collections and {source_family, target_family} == {"个人香氛", "身体护理"}:
        relation_type = "SCENT_RITUAL_WITH"
        if source_family != "身体护理":
            source, target = target, source
    elif shared_collections and {source_family, target_family} == {"个人香氛", "家居香氛"}:
        relation_type = "EXTENDS_TO_HOME"
        if source_family != "个人香氛":
            source, target = target, source
    elif str(source["key"]) > str(target["key"]):
        source, target = target, source

    evidence_field, evidence_text = pairing_copy_evidence(source, target)
    evidence_type = "source_copy_context"
    if not evidence_field and shared_collections:
        evidence_field = "collection_or_scent"
        evidence_text = "同一已清洗系列：" + "|".join(sorted(shared_collections))
        evidence_type = "structured_dimensions"
    elif not evidence_field:
        evidence_field, evidence_text = best_evidence(source)
        evidence_type = "structured_dimensions+source_copy_context"
    risk_flags = ["requires_human_review"]
    if shared_collections:
        risk_flags.append("same_collection_not_official_pair")
    elif set(source["notes"]).intersection(target["notes"]):
        risk_flags.append("shared_scent_evidence_only")
    if set(source["materials"]).intersection(target["materials"]):
        risk_flags.append("shared_material_not_official_pair")
    if (
        is_candle_form(str(source["product_form"])) and is_candle_accessory_form(str(target["product_form"]))
    ) or (
        is_candle_form(str(target["product_form"])) and is_candle_accessory_form(str(source["product_form"]))
    ):
        risk_flags.append("scene_fit_not_compatibility")

    return {
        "candidate_id": candidate_id(str(source["key"]), relation_type, str(target["key"])),
        "source_product_key": str(source["key"]),
        "source_product_name": str(source["name"]),
        "source_core_family": str(source["core_family"]),
        "source_product_form": str(source["product_form"]),
        "relation_type": relation_type,
        "relation_label": RELATION_LABELS[relation_type],
        "scenario": RELATION_SCENARIOS[relation_type],
        "target_product_key": str(target["key"]),
        "target_product_name": str(target["name"]),
        "target_core_family": str(target["core_family"]),
        "target_product_form": str(target["product_form"]),
        "pre_score": f"{score:.2f}",
        "deterministic_signals": "|".join(signals),
        "evidence_type": evidence_type,
        "evidence_field": evidence_field,
        "evidence_text": evidence_text,
        "confidence": candidate_confidence(score),
        "review_status": "pending_review",
        "risk_flags": "|".join(risk_flags),
        "source_url": str(source["source_url"]),
        "target_url": str(target["source_url"]),
        "notes": "候选关系不会自动写入正式图谱；需逐条确认关系类型、方向与推荐理由。",
    }


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
    products, source_to_concept = product_groups(read_csv(CLEANED_CSV), read_csv(RAW_CSV))
    edges = expand_published_edges(
        products,
        [
            *read_csv(RELATIONS_CSV),
            *read_optional_csv(REVIEWED_RECOMMENDATION_RELATIONS_CSV),
        ],
        read_csv(RULES_CSV),
        source_to_concept,
    )

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
    candidate_rows_by_id: dict[str, dict[str, str]] = {}
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
        for candidate in candidates[:3]:
            target = products[str(candidate["product_key"])]
            candidate_row = make_candidate_row(
                product,
                target,
                float(candidate["pre_score"]),
                list(candidate["deterministic_signals"]),
            )
            current = candidate_rows_by_id.get(candidate_row["candidate_id"])
            if current is None or float(candidate_row["pre_score"]) > float(current["pre_score"]):
                candidate_rows_by_id[candidate_row["candidate_id"]] = candidate_row
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

    ranked_candidate_rows = sorted(
        candidate_rows_by_id.values(),
        key=lambda row: (
            -float(row["pre_score"]),
            row["relation_type"],
            row["source_product_name"],
            row["target_product_name"],
        ),
    )
    candidate_degree: Counter[str] = Counter()
    candidate_rows: list[dict[str, str]] = []
    for row in ranked_candidate_rows:
        source_key = row["source_product_key"]
        target_key = row["target_product_key"]
        if candidate_degree[source_key] >= 3 or candidate_degree[target_key] >= 3:
            continue
        candidate_rows.append(row)
        candidate_degree[source_key] += 1
        candidate_degree[target_key] += 1
    candidate_type_counts = Counter(row["relation_type"] for row in candidate_rows)
    candidate_product_keys = {
        key
        for row in candidate_rows
        for key in (row["source_product_key"], row["target_product_key"])
    }
    for row in candidate_rows:
        if row["review_status"] != "pending_review":
            raise ValueError(f"Candidate is not pending review: {row['candidate_id']}")
        if row["relation_type"] in FACT_TYPES:
            raise ValueError(f"Candidate improperly asserts a factual relation: {row['candidate_id']}")
        if row["source_product_key"] not in products or row["target_product_key"] not in products:
            raise ValueError(f"Candidate references a missing product: {row['candidate_id']}")
        if frozenset((row["source_product_key"], row["target_product_key"])) in existing_pairs:
            raise ValueError(f"Candidate duplicates a published relation: {row['candidate_id']}")
        if float(row["confidence"]) >= 0.80:
            raise ValueError(f"Unreviewed candidate confidence is too high: {row['candidate_id']}")

    summary = {
        "generated_at": date.today().isoformat(),
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
        "candidate_relation_count": len(candidate_rows),
        "products_with_review_candidates": len(candidate_product_keys),
        "candidate_relation_type_counts": dict(candidate_type_counts),
        "status_counts": dict(status_counts),
    }

    model_batch = {
        "metadata": {
            "generated_at": date.today().isoformat(),
            "source_product_count": len(products),
            "task_count": len(model_tasks),
            "purpose": "Generate reviewable product-pairing candidates without asserting new facts.",
        },
        "policy": {
            "allowed_relation_types": [
                "PAIRS_WITH",
                "LAYER_WITH",
                "SCENT_RITUAL_WITH",
                "EXTENDS_TO_HOME",
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
    with CANDIDATES_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CANDIDATE_FIELDS)
        writer.writeheader()
        writer.writerows(candidate_rows)
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
    print(f"Review candidates: {len(candidate_rows)}")
    for relation_type, count in sorted(candidate_type_counts.items()):
        print(f"  candidate {relation_type}: {count}")
    print(f"Model tasks: {len(model_tasks)}")
    for status, count in sorted(status_counts.items()):
        print(f"  {status}: {count}")
    print(f"Wrote {AUDIT_CSV}")
    print(f"Wrote {CANDIDATES_CSV}")
    print(f"Wrote {EDGE_CSV}")
    print(f"Wrote {MODEL_INPUT_JSON}")
    print(f"Wrote {SUMMARY_JSON}")


if __name__ == "__main__":
    main()
