from __future__ import annotations

import csv
import hashlib
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RAW_CSV = ROOT / "diptyque_products.csv"
CLEANED_CSV = ROOT / "diptyque_products_cleaned.csv"
OUTPUT_CSV = ROOT / "diptyque_compatibility_spec_candidates.csv"

FIELDS = [
    "compatibility_id",
    "source_product_key",
    "source_product_name",
    "relation_type",
    "spec_type",
    "spec_value",
    "spec_label",
    "scenario",
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

EVIDENCE_FIELDS = [
    "caracteristics_text",
    "sizes",
    "detailed_description",
    "pdp_short_description",
    "pdp_long_description",
]


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def gram_values(value: str) -> set[int]:
    return {int(match) for match in re.findall(r"(?<!\d)(\d{2,4})\s*(?:g|G|克)", value or "")}


def compatibility_gram_values(value: str) -> set[int]:
    values: set[int] = set()
    for match in re.finditer(r"搭配\s*[:：]?\s*([^。；;\n]{0,100})", value or "", flags=re.IGNORECASE):
        clause = re.split(r"(?:材质|重量|尺寸|规格|产地)\s*[:：]", match.group(1), maxsplit=1)[0]
        if "蜡烛" in clause:
            values.update(gram_values(clause))
    return values


def compatibility_id(source_key: str, spec_type: str, spec_value: str) -> str:
    payload = f"{source_key}|ACCESSORY_FOR_SPEC|{spec_type}|{spec_value}".encode("utf-8")
    return "SPEC-" + hashlib.sha1(payload).hexdigest()[:12].upper()


def main() -> None:
    raw_rows = read_csv(RAW_CSV)
    cleaned_rows = read_csv(CLEANED_CSV)
    raw_by_sku = {(row.get("sku") or "").strip(): row for row in raw_rows}

    groups: dict[str, dict[str, object]] = {}
    for row in cleaned_rows:
        product_key = (row.get("product_key") or "").strip()
        group = groups.setdefault(
            product_key,
            {
                "key": product_key,
                "name": (row.get("product_name") or "").strip(),
                "rows": [],
            },
        )
        group["rows"].append(row)

    candidates: dict[tuple[str, str, str], dict[str, str]] = {}
    for group in groups.values():
        for cleaned in group["rows"]:
            raw = raw_by_sku.get((cleaned.get("sku") or "").strip(), {})
            for field in EVIDENCE_FIELDS:
                evidence = (raw.get(field) or "").strip()
                if "搭配" not in evidence or "蜡烛" not in evidence:
                    continue
                for grams in compatibility_gram_values(evidence):
                    spec_value = f"{grams}g"
                    key = (str(group["key"]), "candle_weight", spec_value)
                    candidates[key] = {
                        "compatibility_id": compatibility_id(str(group["key"]), "candle_weight", spec_value),
                        "source_product_key": str(group["key"]),
                        "source_product_name": str(group["name"]),
                        "relation_type": "ACCESSORY_FOR_SPEC",
                        "spec_type": "candle_weight",
                        "spec_value": spec_value,
                        "spec_label": f"{spec_value}蜡烛",
                        "scenario": "蜡烛陈设与使用",
                        "evidence_type": "official_product_copy",
                        "evidence_field": field,
                        "evidence_text": re.sub(r"\s+", " ", evidence).strip(),
                        "evidence_url": (raw.get("url") or cleaned.get("url") or "").strip(),
                        "confidence": "0.95",
                        "review_status": "candidate",
                        "reviewer": "",
                        "reviewed_at": "",
                        "notes": "官方商品文案明确给出兼容蜡烛克重；审核时确认规格数字未来自配件自身重量。",
                    }

    explicit_specs = [
        {
            "source_name": "椭圆香皂托盘",
            "evidence_pattern": "香氛皂的理想伴侣",
            "specs": [
                (
                    "product_form",
                    "香氛皂",
                    "香氛皂",
                    "香氛皂陈设与使用",
                    "0.95",
                    "官方文案明确说明该托盘适用于香氛皂；原始数据中存在对应品型商品。",
                )
            ],
        },
        {
            "source_name": "水墨画陶瓷托盘",
            "evidence_pattern": "可搭配室内扩香摆件100ML、200ML",
            "specs": [
                (
                    "product_class",
                    "fragrance_candle",
                    "室内香氛蜡烛",
                    "香氛蜡烛与扩香陈设",
                    "0.95",
                    "官方文案明确允许搭配不同规格室内香氛蜡烛；原始数据中存在对应商品。",
                ),
                (
                    "diffuser_volume",
                    "100ml",
                    "100ML室内扩香摆件",
                    "香氛蜡烛与扩香陈设",
                    "0.95",
                    "官方文案明确给出容量，但当前原始数据中缺少非补充装的100ML室内扩香摆件，暂不发布。",
                ),
                (
                    "diffuser_volume",
                    "200ml",
                    "200ML室内扩香摆件",
                    "香氛蜡烛与扩香陈设",
                    "0.95",
                    "官方文案明确给出容量，但当前原始数据中缺少非补充装的200ML室内扩香摆件，暂不发布。",
                ),
            ],
        },
    ]
    groups_by_name = {str(group["name"]): group for group in groups.values()}
    for definition in explicit_specs:
        source = groups_by_name.get(definition["source_name"])
        if not source:
            continue
        evidence_field = ""
        evidence_text = ""
        evidence_url = ""
        for cleaned in source["rows"]:
            raw = raw_by_sku.get((cleaned.get("sku") or "").strip(), {})
            for field in EVIDENCE_FIELDS:
                value = (raw.get(field) or "").strip()
                if definition["evidence_pattern"] in value:
                    evidence_field = field
                    evidence_text = re.sub(r"\s+", " ", value).strip()
                    evidence_url = (raw.get("url") or cleaned.get("url") or "").strip()
                    break
            if evidence_text:
                break
        if not evidence_text:
            continue
        for spec_type, spec_value, spec_label, scenario, confidence, notes in definition["specs"]:
            key = (str(source["key"]), spec_type, spec_value)
            candidates[key] = {
                "compatibility_id": compatibility_id(str(source["key"]), spec_type, spec_value),
                "source_product_key": str(source["key"]),
                "source_product_name": str(source["name"]),
                "relation_type": "ACCESSORY_FOR_SPEC",
                "spec_type": spec_type,
                "spec_value": spec_value,
                "spec_label": spec_label,
                "scenario": scenario,
                "evidence_type": "official_product_copy",
                "evidence_field": evidence_field,
                "evidence_text": evidence_text,
                "evidence_url": evidence_url,
                "confidence": confidence,
                "review_status": "candidate",
                "reviewer": "",
                "reviewed_at": "",
                "notes": notes,
            }

    rows = sorted(
        candidates.values(),
        key=lambda item: (item["source_product_name"], item["spec_type"], item["spec_value"]),
    )
    with OUTPUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {OUTPUT_CSV}")
    print(f"Compatibility spec candidates: {len(rows)}")
    print(f"Products: {len({row['source_product_key'] for row in rows})}")
    print(f"Specs: {', '.join(sorted({row['spec_value'] for row in rows}))}")


if __name__ == "__main__":
    main()
