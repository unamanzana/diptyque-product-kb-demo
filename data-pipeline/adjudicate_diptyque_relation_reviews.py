from __future__ import annotations

import argparse
import csv
import hashlib
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CANDIDATES_CSV = ROOT / "diptyque_relation_candidates.csv"
MODEL_REVIEWS_CSV = ROOT / "diptyque_relation_model_reviews.csv"
PUBLISHED_EDGES_CSV = ROOT / "diptyque_relation_published_edges.csv"
QUEUE_CSV = ROOT / "diptyque_relation_review_queue.csv"
APPROVED_CSV = ROOT / "diptyque_reviewed_recommendation_relations.csv"

QUEUE_FIELDS = (
    "candidate_id",
    "source_product_key",
    "source_product_name",
    "source_core_family",
    "source_product_form",
    "relation_type",
    "target_product_key",
    "target_product_name",
    "target_core_family",
    "target_product_form",
    "candidate_evidence_type",
    "evidence_field",
    "evidence_text",
    "model_decision",
    "model_confidence",
    "model_rationale",
    "gate_decision",
    "gate_reason",
    "publish_confidence",
)
RELATION_FIELDS = (
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
)
RELATION_LABELS = {
    "PAIRS_WITH": "搭配",
    "SCENT_RITUAL_WITH": "香气延续",
    "EXTENDS_TO_HOME": "延伸至家居",
}
RELATION_SCENARIOS = {
    "PAIRS_WITH": "同系列香气或同设计搭配",
    "SCENT_RITUAL_WITH": "身体护理与个人香氛仪式",
    "EXTENDS_TO_HOME": "个人香氛延伸至空间香气",
}


PAIRING_TYPES = {
    "PAIRS_WITH",
    "LAYER_WITH",
    "SCENT_RITUAL_WITH",
    "EXTENDS_TO_HOME",
    "GIFT_WITH",
    "DISPLAY_WITH",
}

def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, fields: tuple[str, ...], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def has_same_collection(candidate: dict[str, str]) -> bool:
    return "同一已清洗系列:" in candidate["deterministic_signals"]


def gate_candidate(candidate: dict[str, str], review: dict[str, str]) -> tuple[str, str, str]:
    if review["decision"] == "reject":
        return "reject", "模型拒绝，规则门禁不再提升。", ""
    if review["decision"] != "approve" or review.get("error"):
        return "manual_review", "模型未明确通过或审核响应存在结构错误。", ""
    source_family = candidate["source_core_family"]
    target_family = candidate["target_core_family"]
    relation_type = candidate["relation_type"]
    if relation_type == "SCENT_RITUAL_WITH":
        valid = (
            source_family == "身体护理"
            and target_family == "个人香氛"
            and has_same_collection(candidate)
        )
        return (
            ("publish", "同系列身体护理与个人香氛，模型与结构规则一致。", "0.78")
            if valid
            else ("manual_review", "香气延续缺少正确家族方向或同系列证据。", "")
        )
    if relation_type == "EXTENDS_TO_HOME":
        valid = (
            source_family == "个人香氛"
            and target_family == "家居香氛"
            and has_same_collection(candidate)
        )
        return (
            ("publish", "同系列个人香氛向空间香气延展，模型与结构规则一致。", "0.80")
            if valid
            else ("manual_review", "家居延展缺少正确家族方向或同系列证据。", "")
        )
    if relation_type != "PAIRS_WITH":
        return "manual_review", "关系类型不在本轮发布白名单。", ""
    if source_family == target_family == "家居香氛" and has_same_collection(candidate):
        return "publish", "同系列且不同香气载体，作为策展搭配发布。", "0.80"
    if source_family == target_family == "身体护理" and has_same_collection(candidate):
        return "publish", "同系列不同身体护理步骤，作为香气仪式搭配发布。", "0.80"
    if source_family == target_family == "艺术家居":
        if candidate["evidence_type"] == "source_copy_context":
            return "publish", "官方商品文案点明目标品型，且设计身份规则已对齐。", "0.86"
        return "manual_review", "艺术家居关系缺少目标明确的商品文案。", ""
    return "manual_review", "跨家族搭配仍缺少足够具体的发布证据。", ""


def relation_id(candidate: dict[str, str]) -> str:
    payload = "|".join(
        (
            candidate["source_product_key"],
            candidate["relation_type"],
            candidate["target_product_key"],
        )
    )
    return "REL-" + hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12].upper()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    candidates = read_csv(CANDIDATES_CSV)
    reviews = {row["candidate_id"]: row for row in read_csv(MODEL_REVIEWS_CSV)}
    missing_reviews = [
        candidate["candidate_id"]
        for candidate in candidates
        if candidate["candidate_id"] not in reviews
    ]
    if missing_reviews:
        raise ValueError("Missing model reviews: " + ",".join(missing_reviews))
    gate_results = {
        candidate["candidate_id"]: gate_candidate(candidate, reviews[candidate["candidate_id"]])
        for candidate in candidates
    }
    covered_products: set[str] = set()
    if PUBLISHED_EDGES_CSV.exists():
        for edge in read_csv(PUBLISHED_EDGES_CSV):
            if edge["relation_type"] in PAIRING_TYPES:
                covered_products.update((edge["source_product_key"], edge["target_product_key"]))
    publishable = sorted(
        (
            candidate
            for candidate in candidates
            if gate_results[candidate["candidate_id"]][0] == "publish"
        ),
        key=lambda candidate: (
            -sum(
                key not in covered_products
                for key in (candidate["source_product_key"], candidate["target_product_key"])
            ),
            -float(reviews[candidate["candidate_id"]]["confidence"]),
            -float(candidate["pre_score"]),
            candidate["candidate_id"],
        ),
    )
    for candidate in publishable:
        source_key = candidate["source_product_key"]
        target_key = candidate["target_product_key"]
        if source_key in covered_products and target_key in covered_products:
            gate_results[candidate["candidate_id"]] = (
                "defer",
                "两个商品均已有搭配覆盖，暂缓冗余关系。",
                "",
            )
            continue
        covered_products.update((source_key, target_key))
    queue_rows: list[dict[str, str]] = []
    approved_rows: list[dict[str, str]] = []
    for candidate in candidates:
        review = reviews.get(candidate["candidate_id"])
        if not review:
            raise ValueError(f"Missing model review for {candidate['candidate_id']}")
        gate_decision, gate_reason, publish_confidence = gate_results[candidate["candidate_id"]]
        queue_rows.append(
            {
                "candidate_id": candidate["candidate_id"],
                "source_product_key": candidate["source_product_key"],
                "source_product_name": candidate["source_product_name"],
                "source_core_family": candidate["source_core_family"],
                "source_product_form": candidate["source_product_form"],
                "relation_type": candidate["relation_type"],
                "target_product_key": candidate["target_product_key"],
                "target_product_name": candidate["target_product_name"],
                "target_core_family": candidate["target_core_family"],
                "target_product_form": candidate["target_product_form"],
                "candidate_evidence_type": candidate["evidence_type"],
                "evidence_field": candidate["evidence_field"],
                "evidence_text": candidate["evidence_text"],
                "model_decision": review["decision"],
                "model_confidence": review["confidence"],
                "model_rationale": review["rationale_cn"],
                "gate_decision": gate_decision,
                "gate_reason": gate_reason,
                "publish_confidence": publish_confidence,
            }
        )
        if gate_decision != "publish":
            continue
        relation_type = candidate["relation_type"]
        structured_evidence = candidate["evidence_type"] == "structured_dimensions"
        evidence_type = (
            "normalized_collection+curatorial_rule+model_review+codex_rule_gate"
            if structured_evidence
            else "official_product_copy+design_identity+model_review+codex_rule_gate"
        )
        approved_rows.append(
            {
                "relation_id": relation_id(candidate),
                "source_product_key": candidate["source_product_key"],
                "source_product_name": candidate["source_product_name"],
                "relation_type": relation_type,
                "target_product_key": candidate["target_product_key"],
                "target_product_name": candidate["target_product_name"],
                "relation_label": RELATION_LABELS[relation_type],
                "scenario": RELATION_SCENARIOS[relation_type],
                "evidence_type": evidence_type,
                "evidence_field": candidate["evidence_field"],
                "evidence_text": candidate["evidence_text"],
                "evidence_url": candidate["source_url"] or candidate["target_url"],
                "confidence": publish_confidence,
                "review_status": "approved",
                "reviewer": "codex_model_assisted_review",
                "reviewed_at": date.today().isoformat(),
                "notes": (
                    "策展推荐，不代表品牌点名该具体组合。模型初审理由："
                    + review["rationale_cn"]
                    + " 规则复核："
                    + gate_reason
                ),
            }
        )
    write_csv(QUEUE_CSV, QUEUE_FIELDS, queue_rows)
    if args.publish:
        existing_rows = read_csv(APPROVED_CSV) if APPROVED_CSV.exists() else []
        approved_by_id = {row["relation_id"]: row for row in existing_rows}
        for row in approved_rows:
            approved_by_id[row["relation_id"]] = row
        approved_rows = sorted(approved_by_id.values(), key=lambda row: row["relation_id"])
        write_csv(APPROVED_CSV, RELATION_FIELDS, approved_rows)
    counts: dict[str, int] = {}
    for row in queue_rows:
        counts[row["gate_decision"]] = counts.get(row["gate_decision"], 0) + 1
    print(f"Candidates: {len(queue_rows)}")
    for decision, count in sorted(counts.items()):
        print(f"  {decision}: {count}")
    print(f"Wrote {QUEUE_CSV}")
    if args.publish:
        print(f"Published reviewed recommendations total: {len(approved_rows)}")
        print(f"Wrote {APPROVED_CSV}")


if __name__ == "__main__":
    main()
