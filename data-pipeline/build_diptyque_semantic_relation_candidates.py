from __future__ import annotations

import csv
import hashlib
import re
from collections import defaultdict
from itertools import combinations
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RAW_CSV = ROOT / "diptyque_products.csv"
CLEANED_CSV = ROOT / "diptyque_products_cleaned.csv"
CANDIDATES_CSV = ROOT / "diptyque_semantic_relation_candidates.csv"
EVIDENCE_AUDIT_CSV = ROOT / "diptyque_relation_evidence_audit.csv"

TEXT_FIELDS = [
    "pdp_short_description",
    "pdp_long_description",
    "description_text",
    "usage_tips_text",
    "story_text",
    "savoir_faire_text",
    "caracteristics_text",
]

RELATION_EVIDENCE_FIELDS = [field for field in TEXT_FIELDS if field != "savoir_faire_text"]

CANDIDATE_FIELDS = [
    "relation_id",
    "source_product_key",
    "source_product_name",
    "relation_type",
    "target_product_key",
    "target_product_name",
    "relation_label",
    "scenario",
    "candidate_basis",
    "evidence_type",
    "evidence_field",
    "evidence_text",
    "evidence_url",
    "confidence",
    "review_status",
    "reviewer",
    "reviewed_at",
    "notes",
]

AUDIT_FIELDS = [
    "product_key",
    "product_name",
    "sku",
    "field",
    "trigger",
    "classification",
    "is_relation_evidence",
    "target_resolution",
    "evidence_text",
    "url",
]

TRIGGERS = [
    "层叠搭配",
    "可与",
    "可搭配",
    "搭配使用",
    "配套使用",
    "搭配",
    "适用于",
    "专为",
    "理想伴侣",
    "叠加",
    "层叠",
    "组合",
    "相得益彰",
    "延伸",
    "延续",
]


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def split_multi(value: str) -> list[str]:
    return [part.strip() for part in (value or "").split("|") if part.strip()]


def sentences(value: str) -> list[str]:
    return [
        part.strip()
        for part in re.split(r"(?<=[。！？；;])|\n+", value or "")
        if part.strip()
    ]


def relation_id(source_key: str, relation_type: str, target_key: str) -> str:
    payload = f"{source_key}|{relation_type}|{target_key}".encode("utf-8")
    return "SEM-" + hashlib.sha1(payload).hexdigest()[:12].upper()


def classify_evidence(text: str) -> tuple[str, str, str]:
    if "层叠搭配" in text:
        return "layering_signal", "yes", "same verified collection"
    if "专为樱花香氛蜡烛而设" in text:
        return "explicit_named_product_compatibility", "yes", "unique named candle product"
    if "不同高度的象棋烛台搭配使用" in text:
        return "explicit_product_set_pairing", "yes", "other products in named size set"
    if re.search(r"搭配\s*[:：]?\s*[^。；;]{0,40}\d{2,4}\s*(?:g|G|克)[^。；;]{0,20}蜡烛", text):
        return "specification_compatibility_already_modeled", "yes", "compatibility spec"
    if "室内扩香摆件100ML、200ML" in text and "香氛蜡烛" in text:
        return "explicit_multi_class_compatibility", "yes", "compatibility specs"
    if "椭圆贴纸标签" in text:
        return "explicit_product_class_compatibility_with_gap", "partial", "notebook refill resolves; sticker target absent"
    if "补充册" in text or "笔记本补充页" in text:
        return "explicit_product_class_compatibility", "yes", "unique notebook refill product"
    if "可与白色花瓶搭配摆放" in text:
        return "explicit_named_product_pair", "yes", "unique same-size white vase"
    if "同款大号" in text or "同款小号" in text:
        return "same_product_variant", "no", "same Product concept SKU variant"
    if "理想伴侣" in text and "蜡烛" in text:
        return "generic_product_class_pairing", "partial", "target class only"
    if "理想伴侣" in text and "香氛皂" in text:
        return "explicit_product_class_compatibility", "yes", "product form compatibility spec"
    if "适用于" in text:
        return "usage_scope_or_product_class", "partial", "resolve named product or usage scope"
    if "专为" in text:
        return "purpose_or_product_class", "partial", "resolve named product or purpose"
    if "三层叠加结构" in text or "层叠结构" in text:
        return "craft_structure", "no", "none"
    if "随心组合" in text:
        return "generic_decorative_copy", "no", "none"
    if "相得益彰" in text:
        return "within_product_sensory_or_visual_copy", "no", "none"
    if "搭配" in text:
        return "within_product_composition_or_unresolved", "no", "none"
    return "context_only", "no", "none"


def main() -> None:
    raw_rows = read_csv(RAW_CSV)
    cleaned_rows = read_csv(CLEANED_CSV)
    raw_by_sku = {(row.get("sku") or "").strip(): row for row in raw_rows}

    products: dict[str, dict[str, object]] = {}
    for row in cleaned_rows:
        key = (row.get("product_key") or "").strip()
        product = products.setdefault(
            key,
            {
                "key": key,
                "name": (row.get("product_name") or "").strip(),
                "family": (row.get("core_family") or "").strip(),
                "form": (row.get("product_form") or "").strip(),
                "collections": set(),
                "raw_rows": [],
                "url": (row.get("url") or "").strip(),
            },
        )
        product["collections"].update(split_multi(row.get("collection_or_scent") or ""))
        raw = raw_by_sku.get((row.get("sku") or "").strip())
        if raw:
            product["raw_rows"].append(raw)
            if not product["url"]:
                product["url"] = (raw.get("url") or "").strip()

    audit_rows: dict[tuple[str, str, str], dict[str, str]] = {}
    for product in products.values():
        for raw in product["raw_rows"]:
            for field in TEXT_FIELDS:
                for sentence in sentences(raw.get(field) or ""):
                    trigger = next((item for item in TRIGGERS if item in sentence), "")
                    if not trigger:
                        continue
                    classification, is_evidence, target_resolution = classify_evidence(sentence)
                    key = (str(product["key"]), field, sentence)
                    audit_rows[key] = {
                        "product_key": str(product["key"]),
                        "product_name": str(product["name"]),
                        "sku": (raw.get("sku") or "").strip(),
                        "field": field,
                        "trigger": trigger,
                        "classification": classification,
                        "is_relation_evidence": is_evidence,
                        "target_resolution": target_resolution,
                        "evidence_text": sentence,
                        "url": (raw.get("url") or "").strip(),
                    }

    def find_evidence(product: dict[str, object], pattern: str) -> tuple[str, str]:
        regex = re.compile(pattern)
        for raw in product["raw_rows"]:
            for field in RELATION_EVIDENCE_FIELDS:
                for sentence in sentences(raw.get(field) or ""):
                    if regex.search(sentence):
                        return field, sentence
        return "collection_or_scent", ""

    candidates: dict[tuple[str, str, str], dict[str, str]] = {}

    def add_candidate(
        source: dict[str, object],
        relation_type: str,
        target: dict[str, object],
        *,
        relation_label: str,
        scenario: str,
        candidate_basis: str,
        evidence_type: str,
        evidence_field: str,
        evidence_text: str,
        confidence: str,
        notes: str,
        evidence_url: str = "",
    ) -> None:
        source_key = str(source["key"])
        target_key = str(target["key"])
        if source_key == target_key:
            return
        key = (source_key, relation_type, target_key)
        candidates[key] = {
            "relation_id": relation_id(*key),
            "source_product_key": source_key,
            "source_product_name": str(source["name"]),
            "relation_type": relation_type,
            "target_product_key": target_key,
            "target_product_name": str(target["name"]),
            "relation_label": relation_label,
            "scenario": scenario,
            "candidate_basis": candidate_basis,
            "evidence_type": evidence_type,
            "evidence_field": evidence_field,
            "evidence_text": evidence_text,
            "evidence_url": evidence_url or str(source["url"]),
            "confidence": confidence,
            "review_status": "candidate",
            "reviewer": "",
            "reviewed_at": "",
            "notes": notes,
        }

    by_collection: dict[str, list[dict[str, object]]] = defaultdict(list)
    for product in products.values():
        for collection in product["collections"]:
            by_collection[str(collection)].append(product)

    for collection, collection_products in by_collection.items():
        personal = [
            product
            for product in collection_products
            if product["family"] == "个人香氛" and "补充" not in str(product["name"])
        ]
        body = [product for product in collection_products if product["family"] == "身体护理"]
        home = [
            product
            for product in collection_products
            if product["family"] == "家居香氛" and "补充" not in str(product["name"])
        ]

        for source in body:
            field, layering_text = find_evidence(source, r"层叠搭配")
            for target in personal:
                if layering_text:
                    add_candidate(
                        source,
                        "LAYER_WITH",
                        target,
                        relation_label="层叠搭配",
                        scenario="身体护理后的香气叠加",
                        candidate_basis=f"official layering signal + exact collection:{collection}",
                        evidence_type="official_product_copy+verified_collection",
                        evidence_field=field,
                        evidence_text=layering_text,
                        confidence="0.82",
                        notes="文案明确允许层叠，但未点名目标；目标由已核验同系列个人香氛限定，仍需人工审核。",
                    )
                else:
                    field, rationale = find_evidence(source, r"延续|余韵|香气|芬芳")
                    if not rationale:
                        field = "collection_or_scent"
                        rationale = f"同一已核验系列：{collection}"
                    add_candidate(
                        source,
                        "SCENT_RITUAL_WITH",
                        target,
                        relation_label="香气延续",
                        scenario="同系列身体护理与个人香氛",
                        candidate_basis=f"exact verified collection:{collection}",
                        evidence_type="verified_collection+official_product_copy",
                        evidence_field=field,
                        evidence_text=rationale,
                        confidence="0.68",
                        notes="同系列只支持候选关系，不代表品牌明确推荐该具体组合。",
                    )

        for source in personal:
            for target in home:
                field, rationale = find_evidence(source, r"香气|香调|气息|灵感")
                if not rationale:
                    field = "collection_or_scent"
                    rationale = f"同一已核验系列：{collection}"
                add_candidate(
                    source,
                    "EXTENDS_TO_HOME",
                    target,
                    relation_label="同香延伸至家居",
                    scenario="从个人香氛延伸到空间香气",
                    candidate_basis=f"exact verified collection:{collection}",
                    evidence_type="verified_collection+official_product_copy",
                    evidence_field=field,
                    evidence_text=rationale,
                    confidence="0.72",
                    notes="同一已核验系列的跨场景候选；并非官方明确点名的商品搭配，需人工审核。",
                )

    refill_target = next((product for product in products.values() if product["name"] == "笔记本补充册"), None)
    if refill_target:
        for source in products.values():
            if source["name"] == "笔记本补充册":
                continue
            field, evidence = find_evidence(source, r"补充册|笔记本补充页")
            if evidence:
                add_candidate(
                    refill_target,
                    "REFILL_FOR",
                    source,
                    relation_label="补充适用于",
                    scenario="文创续用",
                    candidate_basis="explicit notebook refill mention",
                    evidence_type="official_product_copy",
                    evidence_field=field,
                    evidence_text=evidence,
                    confidence="0.95",
                    notes="官方文案明确说明该笔记本可搭配补充页；补充册作为来源商品指向具体适用笔记本。",
                    evidence_url=str(source["url"]),
                )

    black_vase = next((product for product in products.values() if product["name"] == "黑色蜡质花瓶 L"), None)
    white_vase = next((product for product in products.values() if product["name"] == "白色蜡质花瓶 L"), None)
    if black_vase and white_vase:
        field, evidence = find_evidence(black_vase, r"可与白色花瓶搭配摆放")
        if evidence:
            add_candidate(
                black_vase,
                "PAIRS_WITH",
                white_vase,
                relation_label="搭配摆放",
                scenario="家居陈设",
                candidate_basis="explicit named product pairing",
                evidence_type="official_product_copy",
                evidence_field=field,
                evidence_text=evidence,
                confidence="0.95",
                notes="官方文案明确点名白色花瓶；按同为L号解析目标，需人工复核。",
            )

    cherry_lid = next((product for product in products.values() if product["name"] == "樱花陶瓷烛盖"), None)
    cherry_candle = next((product for product in products.values() if product["name"] == "香氛蜡烛-樱花"), None)
    if cherry_lid and cherry_candle:
        field, evidence = find_evidence(cherry_lid, r"专为樱花香氛蜡烛而设")
        if evidence:
            add_candidate(
                cherry_lid,
                "ACCESSORY_FOR",
                cherry_candle,
                relation_label="专用适配",
                scenario="香氛蜡烛陈设与防尘",
                candidate_basis="explicit named candle compatibility",
                evidence_type="official_product_copy",
                evidence_field=field,
                evidence_text=evidence,
                confidence="0.98",
                notes="官方文案明确点名樱花香氛蜡烛，且原始数据中只有一个对应商品。",
            )

    chess_holders = [
        product
        for product in products.values()
        if re.fullmatch(r"象棋造型烛台 [LMS]", str(product["name"]))
    ]
    for source, target in combinations(sorted(chess_holders, key=lambda item: str(item["name"])), 2):
        field, evidence = find_evidence(source, r"不同高度的象棋烛台搭配使用")
        if evidence:
            add_candidate(
                source,
                "PAIRS_WITH",
                target,
                relation_label="组合陈设",
                scenario="不同高度烛台组合",
                candidate_basis="explicit named product set pairing",
                evidence_type="official_product_copy+verified_product_set",
                evidence_field=field,
                evidence_text=evidence,
                confidence="0.96",
                notes="官方文案明确建议不同高度的象棋烛台搭配；目标限定为原始数据中的L、M、S三款。",
            )

    candidate_rows = sorted(
        candidates.values(),
        key=lambda item: (item["relation_type"], item["source_product_name"], item["target_product_name"]),
    )
    with CANDIDATES_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CANDIDATE_FIELDS)
        writer.writeheader()
        writer.writerows(candidate_rows)

    audit_values = sorted(
        audit_rows.values(),
        key=lambda item: (item["classification"], item["product_name"], item["field"], item["evidence_text"]),
    )
    with EVIDENCE_AUDIT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=AUDIT_FIELDS)
        writer.writeheader()
        writer.writerows(audit_values)

    relation_counts: dict[str, int] = defaultdict(int)
    for row in candidate_rows:
        relation_counts[row["relation_type"]] += 1
    classification_counts: dict[str, int] = defaultdict(int)
    for row in audit_values:
        classification_counts[row["classification"]] += 1

    print(f"Wrote {CANDIDATES_CSV}")
    print(f"Semantic candidates: {len(candidate_rows)}")
    for relation_type, count in sorted(relation_counts.items()):
        print(f"  {relation_type}: {count}")
    print(f"Wrote {EVIDENCE_AUDIT_CSV}")
    print(f"Evidence audit rows: {len(audit_values)}")
    for classification, count in sorted(classification_counts.items()):
        print(f"  {classification}: {count}")


if __name__ == "__main__":
    main()
