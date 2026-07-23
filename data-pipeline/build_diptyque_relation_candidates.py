from __future__ import annotations

import csv
import hashlib
import re
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RAW_CSV = ROOT / "diptyque_products.csv"
CLEANED_CSV = ROOT / "diptyque_products_cleaned.csv"
OUTPUT_CSV = ROOT / "diptyque_product_relation_candidates.csv"

CANDIDATE_FIELDS = [
    "relation_id",
    "source_product_key",
    "source_product_name",
    "relation_type",
    "target_product_key",
    "target_product_name",
    "relation_label",
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
    "usage_tips_text",
    "pdp_short_description",
    "pdp_long_description",
    "detailed_description",
    "description_text",
    "story_text",
    "sizes",
]

DEVICE_NAMES = ["车载扩香器", "便携式电子扩香器", "电子扩香器"]


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def compact(value: str) -> str:
    return re.sub(r"[\s\-—_·（）()]+", "", value or "")


def refill_stem(value: str) -> str:
    result = compact(value)
    result = re.sub(r"(?:补充装|补充瓶|补充芯|替换装)$", "", result)
    result = result.replace("固体香膏", "香膏")
    return result


def gram_values(value: str) -> set[int]:
    return {int(match) for match in re.findall(r"(?<!\d)(\d{2,4})\s*(?:g|G|克)", value or "")}


def compatibility_gram_values(value: str) -> set[int]:
    values: set[int] = set()
    for clause in re.findall(r"搭配[^。；;\n]{0,80}?蜡烛", value or "", flags=re.IGNORECASE):
        values.update(gram_values(clause))
    return values


def relation_id(source_key: str, relation_type: str, target_key: str) -> str:
    payload = f"{source_key}|{relation_type}|{target_key}".encode("utf-8")
    return "REL-" + hashlib.sha1(payload).hexdigest()[:12].upper()


def main() -> None:
    raw_rows = read_csv(RAW_CSV)
    cleaned_rows = read_csv(CLEANED_CSV)
    raw_by_sku = {(row.get("sku") or "").strip(): row for row in raw_rows}

    groups: dict[str, dict[str, object]] = {}
    for row in cleaned_rows:
        key = (row.get("product_key") or "").strip()
        group = groups.setdefault(
            key,
            {
                "key": key,
                "name": (row.get("product_name") or "").strip(),
                "form": (row.get("product_form") or "").strip(),
                "rows": [],
                "grams": set(),
            },
        )
        group["rows"].append(row)
        group["grams"].update(gram_values(row.get("size") or ""))

    candidates: dict[tuple[str, str, str], dict[str, str]] = {}

    def add_candidate(
        source: dict[str, object],
        relation_type: str,
        target: dict[str, object],
        *,
        relation_label: str,
        scenario: str,
        evidence_type: str,
        evidence_field: str,
        evidence_text: str,
        evidence_url: str,
        confidence: str,
        notes: str,
    ) -> None:
        source_key = str(source["key"])
        target_key = str(target["key"])
        if not source_key or not target_key or source_key == target_key:
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
            "evidence_type": evidence_type,
            "evidence_field": evidence_field,
            "evidence_text": re.sub(r"\s+", " ", evidence_text).strip(),
            "evidence_url": evidence_url,
            "confidence": confidence,
            "review_status": "candidate",
            "reviewer": "",
            "reviewed_at": "",
            "notes": notes,
        }

    candle_targets = [
        group
        for group in groups.values()
        if "蜡烛" in str(group["name"]) and "补充" not in str(group["name"]) and group["grams"]
    ]

    for source in groups.values():
        source_rows = source["rows"]
        for cleaned in source_rows:
            raw = raw_by_sku.get((cleaned.get("sku") or "").strip(), {})
            url = (raw.get("url") or cleaned.get("url") or "").strip()
            for field in EVIDENCE_FIELDS:
                evidence = (raw.get(field) or "").strip()
                if not evidence:
                    continue

                if "搭配" in evidence and "蜡烛" in evidence:
                    compatible_grams = compatibility_gram_values(evidence)
                    for target in candle_targets:
                        matched = compatible_grams.intersection(target["grams"])
                        if matched:
                            add_candidate(
                                source,
                                "ACCESSORY_FOR",
                                target,
                                relation_label="适配",
                                scenario="蜡烛陈设与使用",
                                evidence_type="official_product_copy",
                                evidence_field=field,
                                evidence_text=evidence,
                                evidence_url=url,
                                confidence="0.90",
                                notes="按官方文案中的蜡烛克重匹配；需确认目标商品当前规格。",
                            )

                if "适用于" in evidence:
                    for device_name in DEVICE_NAMES:
                        if device_name not in evidence:
                            continue
                        for target in groups.values():
                            if compact(str(target["name"])) != compact(device_name):
                                continue
                            add_candidate(
                                source,
                                "ACCESSORY_FOR",
                                target,
                                relation_label="适配",
                                scenario="电子扩香",
                                evidence_type="official_product_copy",
                                evidence_field=field,
                                evidence_text=evidence,
                                evidence_url=url,
                                confidence="0.95",
                                notes="官方文案明确写明适用设备；需人工确认商品仍为同一代设备。",
                            )

    non_refills_by_stem: dict[tuple[str, str], list[dict[str, object]]] = defaultdict(list)
    for group in groups.values():
        name = str(group["name"])
        if "补充" not in name and "替换" not in name:
            non_refills_by_stem[(refill_stem(name), str(group["form"]))].append(group)

    for source in groups.values():
        source_name = str(source["name"])
        if "补充" not in source_name and "替换" not in source_name:
            continue
        matches = non_refills_by_stem.get((refill_stem(source_name), str(source["form"])), [])
        if len(matches) != 1:
            continue
        target = matches[0]
        first_row = source["rows"][0]
        raw = raw_by_sku.get((first_row.get("sku") or "").strip(), {})
        evidence_field = "name"
        evidence_text = source_name
        for field in EVIDENCE_FIELDS:
            value = (raw.get(field) or "").strip()
            if "补充" in value or "替换" in value:
                evidence_field = field
                evidence_text = value
                break
        add_candidate(
            source,
            "REFILL_FOR",
            target,
            relation_label="补充适用于",
            scenario="补充与续用",
            evidence_type="official_product_copy",
            evidence_field=evidence_field,
            evidence_text=evidence_text,
            evidence_url=(raw.get("url") or first_row.get("url") or "").strip(),
            confidence="0.92",
            notes="名称去除补充装/补充瓶后与唯一同品型商品严格匹配；需人工确认容器代际和容量。",
        )

    rows = sorted(
        candidates.values(),
        key=lambda item: (item["relation_type"], item["source_product_name"], item["target_product_name"]),
    )
    with OUTPUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CANDIDATE_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    counts: dict[str, int] = defaultdict(int)
    for row in rows:
        counts[row["relation_type"]] += 1
    print(f"Wrote {OUTPUT_CSV}")
    print(f"Candidates: {len(rows)}")
    for relation_type, count in sorted(counts.items()):
        print(f"  {relation_type}: {count}")


if __name__ == "__main__":
    main()
