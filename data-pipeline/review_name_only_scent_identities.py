from __future__ import annotations

import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
RAW_PATH = ROOT / "diptyque_products.csv"
CLEAN_PATH = ROOT / "diptyque_products_cleaned.csv"
COVERAGE_PATH = ROOT / "diptyque_ontology_schema_v1_coverage.csv"
OUTPUT_PATH = ROOT / "diptyque_scent_identity_name_review_v1.csv"
SUMMARY_PATH = ROOT / "diptyque_scent_identity_name_review_v1.json"
REPORT_PATH = REPO / "docs" / "ontology" / "name-only-scent-review-v1.md"

STRONG_FIELDS = (
    "fragrance",
    "description_text",
    "pdp_short_description",
    "pdp_long_description",
    "story_text",
    "usage_tips_text",
)
WEAK_FIELDS = ("subtitle", "meta_description")
SIGNATURE_FAMILIES = {"个人香氛", "身体护理"}
HOME_FAMILIES = {"家居香氛"}
CANONICAL_OVERRIDES = {
    "EDTNERO100V1::橙花香调淡香水": "橙花香调",
    # The Chinese product titles retain "希腊无花果", but these four official
    # URLs belong to the Figuier home-scent line, not the Philosykos signature line.
    "HOMESCO3::希腊无花果室内香氛蜡": "无花果",
    "CAPSULES6::希腊无花果扩香器香氛补充包": "无花果",
    "HOMEHGFOCARB2D::希腊无花果扩香精": "无花果",
    "HOMEHGFOCARB2K::希腊无花果扩香精补充瓶": "无花果",
}
PROHIBITED_TYPED_IDENTITIES = {
    ("HomeScent", "希腊无花果"),
}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def compact(text: str, limit: int = 320) -> str:
    normalized = re.sub(r"\s+", " ", text or "").strip()
    return normalized if len(normalized) <= limit else normalized[:limit].rstrip() + "..."


def merge_rows(rows: list[dict[str, str]]) -> dict[str, list[str]]:
    merged: dict[str, list[str]] = {}
    for field in rows[0]:
        merged[field] = list(dict.fromkeys(
            value for row in rows if (value := (row.get(field) or "").strip())
        ))
    return merged


def contains_identity(values: list[str], identity: str) -> list[str]:
    return [value for value in values if identity in value]


def identity_type(family: str) -> str:
    if family in SIGNATURE_FAMILIES:
        return "SignatureFragrance"
    if family in HOME_FAMILIES:
        return "HomeScent"
    return "unresolved"


def entity_id(identity_type_name: str, canonical_name: str) -> str:
    digest = hashlib.sha1(f"{identity_type_name}|{canonical_name}".encode("utf-8")).hexdigest()[:12]
    prefix = "signature" if identity_type_name == "SignatureFragrance" else "home" if identity_type_name == "HomeScent" else "unresolved"
    return f"scent:{prefix}:{digest}"


def decide(raw: dict[str, list[str]], candidate: str) -> tuple[str, str, str, str]:
    fragrance_hits = contains_identity(raw.get("fragrance", []), candidate)
    if fragrance_hits:
        return "approved", "fragrance", compact(fragrance_hits[0]), "Official fragrance field exactly supports the scent identity."

    for field in STRONG_FIELDS[1:]:
        hits = contains_identity(raw.get(field, []), candidate)
        if hits:
            return "approved", field, compact(hits[0]), "Official product copy explicitly connects the product with this scent identity."

    weak_hits = []
    for field in WEAK_FIELDS:
        for value in contains_identity(raw.get(field, []), candidate):
            weak_hits.append((field, value))
    if weak_hits:
        field, value = weak_hits[0]
        return "pending_review", field, compact(value), "Only weak title, subtitle, or metadata evidence is available; it cannot independently publish HAS_SCENT."

    return "pending_review", "product_name", "", "No independent source field corroborates the name-derived scent identity."


def main() -> None:
    raw_rows = read_csv(RAW_PATH)
    clean_rows = read_csv(CLEAN_PATH)
    coverage_rows = read_csv(COVERAGE_PATH)
    raw_by_sku = {row["sku"]: row for row in raw_rows}
    clean_by_key: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in clean_rows:
        clean_by_key[row["product_concept_key"]].append(row)

    candidates = [
        row for row in coverage_rows
        if "scent_identity_name_only" in row.get("manual_review_flags", "").split("|")
    ]
    output = []
    for candidate_row in candidates:
        key = candidate_row["product_concept_key"]
        variants = clean_by_key[key]
        raw = merge_rows([raw_by_sku[row["sku"]] for row in variants])
        candidate_name = candidate_row["scent_identity_values"]
        scent_type = identity_type(candidate_row["core_family"])
        canonical_name = CANONICAL_OVERRIDES.get(key, candidate_name)
        decision, field, excerpt, reason = decide(raw, candidate_name)
        if scent_type == "unresolved":
            decision = "pending_review"
            reason = "Core family does not support a safe ScentIdentity subtype."

        output.append({
            "product_concept_key": key,
            "product_name": candidate_row["product_name"],
            "core_family": candidate_row["core_family"],
            "product_form": candidate_row["product_form"],
            "candidate_scent_name": candidate_name,
            "canonical_scent_name": canonical_name,
            "scent_identity_type": scent_type,
            "proposed_scent_identity_id": entity_id(scent_type, canonical_name),
            "decision": decision,
            "evidence_field": field,
            "evidence_excerpt": excerpt,
            "evidence_url": candidate_row["source_url"],
            "decision_reason": reason,
            "reviewer": "codex_source_audit",
            "reviewed_at": date.today().isoformat(),
        })

    typed_labels: dict[str, set[str]] = defaultdict(set)
    for row in output:
        typed_labels[row["canonical_scent_name"]].add(row["scent_identity_type"])
    collisions = {
        name: sorted(types) for name, types in typed_labels.items() if len(types) > 1
    }
    for row in output:
        row["same_label_cross_type"] = "yes" if row["canonical_scent_name"] in collisions else "no"

    output.sort(key=lambda row: (
        0 if row["decision"] == "pending_review" else 1,
        row["scent_identity_type"], row["canonical_scent_name"], row["product_name"],
    ))
    prohibited = [
        row for row in output
        if (row["scent_identity_type"], row["canonical_scent_name"]) in PROHIBITED_TYPED_IDENTITIES
    ]
    if prohibited:
        names = ", ".join(row["product_name"] for row in prohibited)
        raise ValueError(f"Prohibited typed scent identity survived canonicalization: {names}")
    write_csv(OUTPUT_PATH, output)

    summary = {
        "source_candidate_count": len(candidates),
        "decision_counts": dict(Counter(row["decision"] for row in output)),
        "evidence_field_counts": dict(Counter(row["evidence_field"] for row in output)),
        "scent_identity_type_counts": dict(Counter(row["scent_identity_type"] for row in output)),
        "same_label_cross_type": collisions,
        "canonical_name_overrides": CANONICAL_OVERRIDES,
        "prohibited_typed_identities": sorted(
            f"{identity_type}|{name}" for identity_type, name in PROHIBITED_TYPED_IDENTITIES
        ),
        "publication_effect": {
            "graph_edges_added": 0,
            "frontend_records_changed": 0,
            "approved_rows_published": 0,
        },
    }
    SUMMARY_PATH.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_report(summary, output)
    print(f"Reviewed {len(output)} name-only scent candidates")
    print(f"Decisions: {summary['decision_counts']}")
    print(f"Review CSV: {OUTPUT_PATH}")
    print(f"Report: {REPORT_PATH}")


def write_report(summary: dict[str, object], rows: list[dict[str, str]]) -> None:
    approved = [row for row in rows if row["decision"] == "approved"]
    pending = [row for row in rows if row["decision"] == "pending_review"]
    lines = [
        "# 名称型 ScentIdentity 候选审核 v1",
        "",
        "## 结论",
        "",
        f"本轮审核 {summary['source_candidate_count']} 个仅由名称清洗产生的香气候选：{len(approved)} 个有独立官方字段佐证，可进入待迁移的 approved 清单；{len(pending)} 个证据不足，继续保留为 pending_review。没有候选被自动写入图谱或前端。",
        "",
        "审核时不把商品名、URL slug、通用 meta 列表重复计算为独立证据。`fragrance`、正文、故事或使用说明必须明确出现候选香气，才允许 approved。",
        "",
        "## 证据分布",
        "",
        "| Evidence field | Products |",
        "| --- | ---: |",
    ]
    for field, count in sorted(summary["evidence_field_counts"].items(), key=lambda item: (-item[1], item[0])):
        lines.append(f"| `{field}` | {count} |")

    lines += ["", "## 仍待确认", "", "| ProductConcept | Candidate | Type | Evidence | Reason |", "| --- | --- | --- | --- | --- |"]
    for row in pending:
        lines.append(
            f"| {row['product_name']} | {row['candidate_scent_name']} | {row['scent_identity_type']} | `{row['evidence_field']}` | {row['decision_reason']} |"
        )

    lines += ["", "## 同名跨类型身份", ""]
    collisions = summary["same_label_cross_type"]
    if collisions:
        lines += ["以下标签同时出现在 SignatureFragrance 与 HomeScent 中。它们必须使用不同的类型化 ID，不能按显示名称合并：", ""]
        for name, types in collisions.items():
            lines.append(f"- `{name}`: {', '.join(types)}")
    else:
        lines.append("本批规范化后没有未处理的同名跨类型冲突。")

    lines += [
        "",
        "## 规范化决定",
        "",
        "- `橙花香调淡香水` 的 SignatureFragrance 规范名保留为 `橙花香调`，避免与 HomeScent `橙花` 合并。",
        "- 4 款商品名保留“希腊无花果”的 `figuier` 家居产品统一规范到 HomeScent `无花果`；`希腊无花果`只作为 `philosykos` 的 SignatureFragrance 身份。",
        "- 同名 SignatureFragrance 与 HomeScent 通过类型化 ID 区分，例如 `玫瑰` 不因显示名相同而成为同一个实体。",
        "- approved 表示证据审核通过，但本轮仍不发布 `HAS_SCENT`；发布必须进入后续迁移步骤并通过结构校验。",
        "",
        "## 下一步",
        "",
        "把 approved 清单转换为带 assertion/evidence envelope 的迁移输入；pending_review 继续隔离。迁移前需验证每个标准 ProductConcept 最多绑定一个 ScentIdentity，并确认同名跨类型实体不会被 ID 归一逻辑合并。",
    ]
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
