from __future__ import annotations

import csv
import hashlib
import re
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CLEANED_CSV = ROOT / "diptyque_products_cleaned.csv"
SEMANTIC_CANDIDATES_CSV = ROOT / "diptyque_semantic_relation_candidates.csv"
RULE_CANDIDATES_CSV = ROOT / "diptyque_recommendation_rule_candidates.csv"
APPROVED_RULES_CSV = ROOT / "diptyque_recommendation_rules.csv"

FIELDS = [
    "rule_id",
    "source_product_key",
    "source_product_name",
    "relation_type",
    "target_collection",
    "target_core_family",
    "target_product_forms",
    "target_candidate_count",
    "evidence_type",
    "evidence_field",
    "evidence_text",
    "evidence_url",
    "confidence",
    "review_status",
    "reviewer",
    "reviewed_at",
    "decision_reason",
    "notes",
]

RITUAL_SIGNAL = re.compile(
    r"余韵|留下持久|添香气|芬芳滋润|沐浴时|包裹肌肤|香气融入|香气化作|香氛泡沫|层层铺展"
)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def rule_id(source_key: str, relation_type: str, collection: str) -> str:
    payload = f"{source_key}|{relation_type}|{collection}".encode("utf-8")
    return "RULE-" + hashlib.sha1(payload).hexdigest()[:12].upper()


def main() -> None:
    cleaned_rows = read_csv(CLEANED_CSV)
    semantic_rows = read_csv(SEMANTIC_CANDIDATES_CSV)
    product_form_by_key: dict[str, str] = {}
    for row in cleaned_rows:
        key = (row.get("product_key") or "").strip()
        if key and key not in product_form_by_key:
            product_form_by_key[key] = (row.get("product_form") or "").strip()

    grouped: dict[tuple[str, str, str], list[dict[str, str]]] = defaultdict(list)
    for row in semantic_rows:
        relation_type = (row.get("relation_type") or "").strip()
        if relation_type not in {"SCENT_RITUAL_WITH", "EXTENDS_TO_HOME"}:
            continue
        collection = re.sub(
            r"^exact verified collection:", "", (row.get("candidate_basis") or "").strip()
        )
        grouped[
            (
                (row.get("source_product_key") or "").strip(),
                relation_type,
                collection,
            )
        ].append(row)

    rules: list[dict[str, str]] = []
    for (source_key, relation_type, collection), rows in grouped.items():
        first = rows[0]
        target_forms = sorted(
            {
                product_form_by_key.get((row.get("target_product_key") or "").strip(), "")
                for row in rows
            }
            - {""}
        )
        evidence_text = (first.get("evidence_text") or "").strip()
        evidence_field = (first.get("evidence_field") or "").strip()

        if relation_type == "EXTENDS_TO_HOME":
            confidence = "0.72"
            review_status = "rejected_redundant"
            reviewer = "codex_ontology_review"
            reviewed_at = "2026-07-22"
            decision_reason = "共享系列事实已由系列节点表达，不能据此推断具体跨空间搭配。"
            notes = "保留为查询规则审计记录，不生成商品到商品的推荐边。"
            evidence_type = "verified_collection"
            target_core_family = "家居香氛"
        elif evidence_field != "collection_or_scent" and RITUAL_SIGNAL.search(evidence_text):
            confidence = "0.78"
            review_status = "approved"
            reviewer = "codex_curatorial_rule_review"
            reviewed_at = "2026-07-22"
            decision_reason = "商品文案明确描述留香或护理步骤，且目标限定为同一已核验系列。"
            notes = "这是策展推荐规则，不代表品牌点名了某个具体搭配；前端必须按用户目标品型关键词展开。"
            evidence_type = "official_product_copy+verified_collection+curatorial_rule"
            target_core_family = "个人香氛"
        else:
            confidence = "0.68"
            review_status = "hold"
            reviewer = "codex_ontology_review"
            reviewed_at = "2026-07-22"
            decision_reason = "只有同系列或一般香气描述，缺少可解释的护理延续信号。"
            notes = "等待更明确的官方使用说明，不发布商品到商品关系。"
            evidence_type = (first.get("evidence_type") or "verified_collection").strip()
            target_core_family = "个人香氛"

        rules.append(
            {
                "rule_id": rule_id(source_key, relation_type, collection),
                "source_product_key": source_key,
                "source_product_name": (first.get("source_product_name") or "").strip(),
                "relation_type": relation_type,
                "target_collection": collection,
                "target_core_family": target_core_family,
                "target_product_forms": "|".join(target_forms),
                "target_candidate_count": str(len(rows)),
                "evidence_type": evidence_type,
                "evidence_field": evidence_field,
                "evidence_text": evidence_text,
                "evidence_url": (first.get("evidence_url") or "").strip(),
                "confidence": confidence,
                "review_status": review_status,
                "reviewer": reviewer,
                "reviewed_at": reviewed_at,
                "decision_reason": decision_reason,
                "notes": notes,
            }
        )

    rules.sort(key=lambda row: (row["review_status"], row["relation_type"], row["source_product_name"]))
    approved = [row for row in rules if row["review_status"] == "approved"]
    for path, rows in ((RULE_CANDIDATES_CSV, rules), (APPROVED_RULES_CSV, approved)):
        with path.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(rows)

    status_counts: dict[str, int] = defaultdict(int)
    for row in rules:
        status_counts[row["review_status"]] += 1
    print(f"Wrote {RULE_CANDIDATES_CSV}")
    print(f"Rule candidates: {len(rules)}")
    for status, count in sorted(status_counts.items()):
        print(f"  {status}: {count}")
    print(f"Wrote {APPROVED_RULES_CSV}")
    print(f"Approved rules: {len(approved)}")


if __name__ == "__main__":
    main()
