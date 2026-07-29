from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
RAW_PATH = ROOT / "diptyque_products.csv"
CLEAN_PATH = ROOT / "diptyque_products_cleaned.csv"
COMPATIBILITY_PATH = ROOT / "diptyque_compatibility_spec_relations.csv"
OUTPUT_CSV = ROOT / "diptyque_ontology_schema_v1_coverage.csv"
OUTPUT_JSON = ROOT / "diptyque_ontology_schema_v1_summary.json"
REPORT_PATH = REPO / "docs" / "ontology" / "full-source-coverage-v1.md"

TEXT_FIELDS = (
    "pdp_short_description", "pdp_long_description", "description_text",
    "usage_tips_text", "story_text", "savoir_faire_text",
    "caracteristics_text", "formule_text",
)

# Audit vocabulary only. Matches remain reviewable evidence candidates.
DIRECT_PATTERNS = {
    "function": {
        "洁肤": (r"清洁(?:肌肤|双手|身体)", r"洁净(?:肌肤|双手|身体)", r"温和洁肤"),
        "润肤": (r"滋润(?:肌肤|双手|身体)", r"保湿(?:肌肤|双手|身体)", r"润肤"),
        "去角质": (r"去除.*角质", r"去角质"),
        "留香": (r"散发.*香气", r"留下.*香气", r"香气.*萦绕"),
        "扩香": (r"扩散.*香气", r"散香", r"为空间.*增香", r"香气.*弥漫"),
        "清洁": (r"清洁(?:餐具|器皿|家居表面)", r"去除(?:污渍|异味)"),
        "装饰": (r"装饰(?:空间|家居|餐桌)", r"作为.*装饰", r"点缀(?:空间|家居|餐桌)"),
        "蜡烛养护": (r"保护.*蜡烛", r"熄灭.*蜡烛", r"修剪.*烛芯"),
        "便携补香": (r"随时补香", r"随身.*补香", r"便于携带"),
    },
    "scene": {
        "沐浴后": (r"沐浴后",), "睡前": (r"睡前", r"入睡前"),
        "待客": (r"待客", r"招待宾客"), "旅行": (r"旅行(?:时|中|使用|携带)?", r"旅途中"),
        "车内": (r"车内", r"车载"), "餐桌": (r"餐桌", r"用餐时"),
        "中大型房间": (r"中型及大型房间", r"中大型房间"),
        "小型空间": (r"小型空间", r"较小空间"),
    },
    "user_need": {
        "放松": (r"放松身心", r"令人放松", r"舒缓身心"),
        "空间氛围": (r"营造.*氛围", r"烘托.*氛围"),
        "空间清新": (r"去除异味", r"净化.*空气", r"清新空气", r"令.*空间.*清新"),
        "送礼": (r"适合.*送礼", r"馈赠", r"礼赠佳选"),
        "便携使用": (r"随身携带", r"便于携带", r"随时随地"),
    },
    "care": {
        "首次燃烧": (r"首次(?:使用|燃烧|点燃)", r"第一次(?:使用|燃烧|点燃)"),
        "修剪烛芯": (r"修剪.*烛芯", r"烛芯.*毫米", r"烛芯.*mm"),
        "烛芯居中": (r"烛芯.*居中", r"调整.*烛芯"),
        "避免阳光": (r"避免.*阳光", r"远离.*阳光"),
        "控制燃烧时长": (r"燃烧.*(?:小时|分钟)", r"每次.*(?:小时|分钟)"),
        "无人照看警示": (r"无人照看", r"无人看管"),
        "清洁方法": (r"清洁.*(?:软布|肥皂|清水)", r"用.*(?:软布|肥皂).*清洁", r"擦拭"),
        "储存方法": (r"存放于", r"储存于", r"盖紧"),
    },
}

FORM_FUNCTION_CANDIDATES = {
    "淡香水": "留香", "淡香精": "留香", "淡香水礼盒": "留香",
    "香膏": "便携补香", "发香喷雾": "留香", "香氛蜡烛": "扩香",
    "室内喷雾": "扩香", "室内扩香摆件": "扩香", "室内香氛": "扩香",
    "室内香氛蜡": "扩香", "扩香精": "扩香", "电子扩香器": "扩香",
    "车载扩香器": "扩香", "洁肤露": "洁肤", "清洁露": "洁肤",
    "香氛皂": "洁肤", "沐浴油": "洁肤", "餐具清洁液": "洁肤",
    "清洁喷雾": "洁肤", "润肤乳": "润肤", "身体乳": "润肤",
    "护手霜": "润肤", "护手乳": "润肤", "身体凝乳": "润肤",
    "滋养油": "润肤", "烛盖和灭烛罩": "蜡烛养护", "烛罩": "蜡烛养护",
    "烛台": "装饰", "托盘": "装饰", "收纳托盘": "装饰",
    "花瓶": "装饰", "装饰摆件": "装饰",
}

NON_SCENT_FAMILIES = {"艺术家居", "文创"}
PHYSICAL_FAMILIES = {"艺术家居", "文创"}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def values(text: str) -> list[str]:
    return sorted({part.strip() for part in re.split(r"[|,，;；]", text or "") if part.strip()})


def merge_raw(rows: list[dict[str, str]]) -> dict[str, str]:
    merged = {}
    for field in rows[0]:
        merged[field] = "\n".join(dict.fromkeys(
            value for row in rows if (value := (row.get(field) or "").strip())
        ))
    return merged


def match_dimension(raw: dict[str, str], dimension: str) -> tuple[list[str], list[str]]:
    matched_values, evidence_fields = set(), set()
    for field in TEXT_FIELDS:
        text = raw.get(field, "")
        for value, patterns in DIRECT_PATTERNS[dimension].items():
            if text and any(re.search(pattern, text, re.IGNORECASE) for pattern in patterns):
                matched_values.add(value)
                evidence_fields.add(field)
    return sorted(matched_values), sorted(evidence_fields)


def status(direct: list[str], candidate: list[str] | None = None) -> str:
    return "direct" if direct else "candidate" if candidate else "none"


def direct_material(raw: dict[str, str]) -> tuple[list[str], list[str]]:
    found, fields = set(), set()
    for field in ("caracteristics_text", "pdp_long_description", "savoir_faire_text"):
        text = raw.get(field, "")
        for match in re.finditer(r"材质\s*[:：]\s*([^\n。；;]+)", text):
            value = match.group(1).strip(" -")
            if value:
                found.add(value)
                fields.add(field)
    return sorted(found), sorted(fields)


def pct(value: int, total: int) -> str:
    return f"{value / total:.1%}" if total else "0.0%"


def write_csv(rows: list[dict[str, object]]) -> None:
    with OUTPUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    raw_rows, clean_rows = read_csv(RAW_PATH), read_csv(CLEAN_PATH)
    raw_by_sku = {row["sku"]: row for row in raw_rows}
    grouped = defaultdict(list)
    for row in clean_rows:
        grouped[row["product_concept_key"]].append(row)

    approved_compatibility, compatibility_products = Counter(), set()
    if COMPATIBILITY_PATH.exists():
        for relation in read_csv(COMPATIBILITY_PATH):
            if relation.get("review_status") == "approved":
                compatibility_products.add(relation["source_product_key"])
                approved_compatibility[relation["relation_type"]] += 1

    output_rows = []
    for key, variants in sorted(grouped.items()):
        first = variants[0]
        raw = merge_raw([raw_by_sku[row["sku"]] for row in variants])
        family, form, flags = first["core_family"], first["product_form"], set()
        scent_values = sorted({v for row in variants for v in values(row["collection_or_scent"])})
        scent_sources = {row.get("collection_source", "") for row in variants if row.get("collection_or_scent")}
        scent_is_name_only = bool(scent_values) and scent_sources <= {"name", "name_override"}
        scent_identity_status = "candidate" if scent_is_name_only else "direct" if scent_values else "none"
        note_values = sorted({v for row in variants for v in values(row["note_tokens"])})
        profile_values = sorted({v for row in variants for v in values(row["scent_profiles"])})
        cleaned_material = sorted({v for row in variants for v in values(row["material_or_craft"])})
        if scent_values and family in NON_SCENT_FAMILIES:
            flags.add("non_scent_family_has_scent_identity")
        if cleaned_material and family not in PHYSICAL_FAMILIES:
            flags.add("material_candidate_outside_physical_family")

        function_direct, function_fields = match_dimension(raw, "function")
        form_candidates = sorted({v for token, v in FORM_FUNCTION_CANDIDATES.items() if token in form})
        scene_direct, scene_fields = match_dimension(raw, "scene")
        need_direct, need_fields = match_dimension(raw, "user_need")
        care_direct, care_fields = match_dimension(raw, "care")
        material_direct, material_fields = direct_material(raw)
        story_fields = ["story_text"] if raw.get("story_text") else []
        craft_fields = ["savoir_faire_text"] if raw.get("savoir_faire_text") else []
        evidence_fields = [field for field in TEXT_FIELDS if raw.get(field)]
        compatibility = key in compatibility_products

        if scent_values and all(row.get("collection_source") in {"name", "name_override"} for row in variants):
            flags.add("scent_identity_name_only")
        if raw.get("ingredients_text") and not note_values:
            flags.add("formula_present_without_note_evidence")
        if raw.get("usage_tips_text") and not care_direct:
            flags.add("usage_text_requires_instruction_review")
        if raw.get("pdp_long_description") and not story_fields and not any((function_direct, scene_direct, need_direct, material_direct, craft_fields)):
            flags.add("long_description_semantics_untyped")

        dimensions = (scent_values, note_values, profile_values, function_direct, scene_direct,
                      need_direct, care_direct, story_fields, material_direct, craft_fields,
                      ["compatibility"] if compatibility else [])
        output_rows.append({
            "product_concept_key": key, "product_name": first["product_concept_name"],
            "core_family": family, "product_form": form,
            "sku_count": len({row["sku"] for row in variants}),
            "scent_identity_status": scent_identity_status, "scent_identity_values": "|".join(scent_values),
            "note_status": status(note_values), "note_values": "|".join(note_values),
            "scent_profile_status": status(profile_values), "scent_profile_values": "|".join(profile_values),
            "function_status": status(function_direct, form_candidates),
            "function_values": "|".join(function_direct or form_candidates),
            "function_evidence_fields": "|".join(function_fields),
            "scene_status": status(scene_direct), "scene_values": "|".join(scene_direct),
            "scene_evidence_fields": "|".join(scene_fields),
            "user_need_status": status(need_direct), "user_need_values": "|".join(need_direct),
            "user_need_evidence_fields": "|".join(need_fields),
            "care_status": status(care_direct), "care_values": "|".join(care_direct),
            "care_evidence_fields": "|".join(care_fields),
            "inspiration_status": status(story_fields), "inspiration_evidence_fields": "|".join(story_fields),
            "material_status": status(material_direct, cleaned_material),
            "material_values": "|".join(material_direct or cleaned_material),
            "material_evidence_fields": "|".join(material_fields),
            "craft_status": status(craft_fields), "craft_evidence_fields": "|".join(craft_fields),
            "compatibility_status": "direct" if compatibility else "none",
            "evidence_field_count": len(evidence_fields), "evidence_fields": "|".join(evidence_fields),
            "direct_semantic_dimension_count": sum(bool(v) for v in dimensions),
            "manual_review_flags": "|".join(sorted(flags)),
            "source_url": raw.get("url", "").split("\n", 1)[0],
        })

    dimension_names = ("scent_identity", "note", "scent_profile", "function", "scene",
                       "user_need", "care", "inspiration", "material", "craft", "compatibility")
    coverage = {}
    for dimension in dimension_names:
        counts = Counter(row[f"{dimension}_status"] for row in output_rows)
        coverage[dimension] = {"direct": counts["direct"], "candidate": counts["candidate"],
                               "none": counts["none"], "direct_rate": pct(counts["direct"], len(output_rows))}
    family_summary = {}
    for family in sorted({row["core_family"] for row in output_rows}):
        rows = [row for row in output_rows if row["core_family"] == family]
        family_summary[family] = {
            "products": len(rows), "sku_count": sum(row["sku_count"] for row in rows),
            "direct_coverage": {d: sum(row[f"{d}_status"] == "direct" for row in rows) for d in dimension_names},
        }
    flag_counts = Counter(flag for row in output_rows for flag in row["manual_review_flags"].split("|") if flag)
    summary = {
        "schema_version": "v1", "audit_mode": "read_only_coverage",
        "source_rows": len(raw_rows), "product_concepts": len(output_rows),
        "sku_count": len({row["sku"] for row in clean_rows if row["sku"]}),
        "coverage": coverage, "families": family_summary,
        "manual_review_flags": dict(flag_counts.most_common()),
        "approved_compatibility_relations": dict(approved_compatibility),
        "publication_effect": {"graph_edges_added": 0, "frontend_records_changed": 0, "facts_auto_approved": 0},
    }
    write_csv(output_rows)
    OUTPUT_JSON.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_report(summary)
    print(f"Audited {len(raw_rows)} source rows, {len(output_rows)} product concepts, {summary['sku_count']} SKUs")
    print(f"Coverage CSV: {OUTPUT_CSV}")
    print(f"Summary JSON: {OUTPUT_JSON}")
    print(f"Report: {REPORT_PATH}")


def write_report(summary: dict[str, object]) -> None:
    labels = {"scent_identity": "ScentIdentity", "note": "NoteIngredient",
              "scent_profile": "ScentProfile", "function": "Function", "scene": "UseScene",
              "user_need": "UserNeed", "care": "CareInstruction", "inspiration": "Inspiration",
              "material": "Material", "craft": "CraftTechnique", "compatibility": "CompatibilitySpec"}
    lines = ["# Ontology Schema v1 full-source coverage audit", "", "## Audit boundary", "",
             f"This read-only audit covers {summary['source_rows']} raw rows, {summary['product_concepts']} ProductConcepts, and {summary['sku_count']} SKUs. It does not publish facts, add graph edges, or change frontend data.", "",
             "`direct` means an official source field explicitly supports the dimension. `candidate` means a controlled product-form or cleaned-field mapping exists but still needs evidence review. `none` means no v1 evidence was found; it does not prove the fact is false.", "",
             "## Overall coverage", "", "| Dimension | Direct | Candidate | None | Direct rate |",
             "| --- | ---: | ---: | ---: | ---: |"]
    for key, label in labels.items():
        item = summary["coverage"][key]
        lines.append(f"| {label} | {item['direct']} | {item['candidate']} | {item['none']} | {item['direct_rate']} |")
    lines += ["", "## Family distribution", "", "| Core family | Products | SKUs | Scent | Function | Scene | Care | Inspiration | Material | Craft |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for family, item in summary["families"].items():
        d = item["direct_coverage"]
        lines.append(f"| {family} | {item['products']} | {item['sku_count']} | {d['scent_identity']} | {d['function']} | {d['scene']} | {d['care']} | {d['inspiration']} | {d['material']} | {d['craft']} |")
    lines += ["", "## Manual-review queue", "", "| Flag | ProductConcepts | Why it matters |", "| --- | ---: | --- |"]
    explanations = {
        "usage_text_requires_instruction_review": "Usage copy exists but the v1 care vocabulary did not classify it; review as UsageInstruction or a new CareInstruction term.",
        "long_description_semantics_untyped": "Long official copy remains available for RAG but has no typed v1 semantic match.",
        "formula_present_without_note_evidence": "Formula ingredients must not be promoted to olfactory notes.",
        "scent_identity_name_only": "The scent identity currently depends only on a name-based cleaning rule and needs corroboration.",
        "material_candidate_outside_physical_family": "A cleaned material candidate appears outside physical families and may be an olfactory/material layer leak.",
        "non_scent_family_has_scent_identity": "An art or stationery product is incorrectly carrying a scent identity candidate.",
    }
    for flag, count in summary["manual_review_flags"].items():
        lines.append(f"| `{flag}` | {count} | {explanations.get(flag, 'Requires ontology review.')} |")
    lines += ["", "## Interpretation", "",
              "- Scent, note, and profile coverage comes from the existing typed cleaning output and retained official fields; this audit does not merge aliases or infer scent families.",
              "- Function candidates derived only from ProductForm are deliberately not approved facts.",
              "- Scene and user-need coverage is expected to be sparse because v1 requires explicit official wording.",
              "- `story_text` is counted as direct Inspiration coverage, while descriptive prose outside that field remains untyped until sentence-level review.",
              "- Material is direct only when an official physical field explicitly labels a material. Existing name/subtitle material mappings remain candidates.",
              "- Compatibility counts reuse the separately reviewed compatibility input; no new compatibility is inferred here.", "",
              "## Next gate", "",
              "Review the flagged rows and sentence excerpts by priority: concept-layer leaks first, name-only scent identities second, then unmapped usage and long-description text. Only reviewed assertions should enter the v1 migration fixture.", "",
              "Machine-readable detail is generated at `data-pipeline/diptyque_ontology_schema_v1_coverage.csv`; aggregate counts are at `data-pipeline/diptyque_ontology_schema_v1_summary.json`."]
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
