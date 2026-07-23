from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DESKTOP_ROOT = REPO_ROOT.parent

CLEANED_CSV = DESKTOP_ROOT / "diptyque_products_cleaned.csv"
RAW_CSV = DESKTOP_ROOT / "diptyque_products.csv"
GRAPH_NODES_CSV = DESKTOP_ROOT / "diptyque_graph_nodes.csv"
GRAPH_EDGES_CSV = DESKTOP_ROOT / "diptyque_graph_edges.csv"
RECOMMENDATION_RULES_CSV = DESKTOP_ROOT / "diptyque_recommendation_rules.csv"
OUTPUT_JSON = REPO_ROOT / "src" / "data" / "diptyque-frontend-data.json"


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def split_multi(value: str) -> list[str]:
    return [part.strip() for part in (value or "").split("|") if part.strip()]


def uniq_keep_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def to_int(value: str) -> int | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def main() -> None:
    cleaned_rows = read_csv(CLEANED_CSV)
    raw_rows = read_csv(RAW_CSV)
    graph_nodes = read_csv(GRAPH_NODES_CSV)
    graph_edges = read_csv(GRAPH_EDGES_CSV)
    recommendation_rule_rows = read_csv(RECOMMENDATION_RULES_CSV) if RECOMMENDATION_RULES_CSV.exists() else []

    raw_by_sku = {(row.get("sku") or "").strip(): row for row in raw_rows if (row.get("sku") or "").strip()}
    product_groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in cleaned_rows:
        product_groups[(row.get("product_key") or "").strip()].append(row)

    products: list[dict[str, object]] = []

    for product_key, group in sorted(product_groups.items(), key=lambda item: item[0]):
        first = max(group, key=lambda row: (len((row.get("product_name") or "").strip()), (row.get("product_name") or "").strip()))
        spu = (first.get("spu") or "").strip()
        sku_items: list[dict[str, object]] = []
        sizes: list[str] = []
        prices: list[int] = []
        stocks: list[int] = []
        collections: list[str] = []
        notes: list[str] = []
        scent_profiles: list[str] = []
        scent_accords: list[str] = []
        note_families: list[str] = []
        materials: list[str] = []
        marketing_tags: list[str] = []
        variant_tags: list[str] = []
        category_tokens: list[str] = []
        other_tokens: list[str] = []
        image = ""
        subtitle = ""
        description = ""
        story_text = ""
        url = ""

        for row in group:
            sku = (row.get("sku") or "").strip()
            raw = raw_by_sku.get(sku, {})

            size = (row.get("size") or "").strip()
            price = to_int(row.get("price") or "")
            stock = to_int(row.get("stock") or "")
            sku_url = (row.get("url") or "").strip() or (raw.get("url") or "").strip()
            sku_image = (raw.get("thumbnail") or "").strip() or (raw.get("small_image") or "").strip() or (raw.get("base_image") or "").strip()

            if size:
                sizes.append(size)
            if price is not None:
                prices.append(price)
            if stock is not None:
                stocks.append(stock)

            collections.extend(split_multi(row.get("collection_or_scent") or ""))
            notes.extend(split_multi(row.get("note_tokens") or ""))
            scent_profiles.extend(split_multi(row.get("scent_profiles") or ""))
            scent_accords.extend(split_multi(row.get("scent_accords") or ""))
            note_families.extend(split_multi(row.get("note_families") or ""))
            materials.extend(split_multi(row.get("material_or_craft") or ""))
            marketing_tags.extend(split_multi(row.get("marketing_tags") or ""))
            variant_tags.extend(split_multi(row.get("variant_tags") or ""))
            category_tokens.extend(split_multi(row.get("category_tokens_clean") or ""))
            other_tokens.extend(split_multi(row.get("other_tokens") or ""))

            if not image and sku_image:
                image = sku_image
            if not subtitle:
                subtitle = (raw.get("subtitle") or "").strip()
            if not description:
                description = (raw.get("pdp_short_description") or "").strip() or (raw.get("plp_description") or "").strip()
            if not story_text:
                story_text = (raw.get("story_text") or "").strip()
            if not url and sku_url:
                url = sku_url

            sku_items.append(
                {
                    "id": f"sku:{sku}",
                    "sku": sku,
                    "size": size,
                    "price": price,
                    "stock": stock,
                    "url": sku_url,
                    "image": sku_image,
                }
            )

        products.append(
            {
                "id": f"product:{product_key}",
                "name": (first.get("product_name") or "").strip(),
                "identityName": next(((row.get("identity_name") or "").strip() for row in group if (row.get("identity_name") or "").strip()), ""),
                "spu": spu,
                "coreFamily": (first.get("core_family") or "").strip(),
                "productForm": (first.get("product_form") or "").strip(),
                "typeRaw": next(((row.get("type_raw") or "").strip() for row in group if (row.get("type_raw") or "").strip()), ""),
                "typeDerived": next(((row.get("type_derived") or "").strip() for row in group if (row.get("type_derived") or "").strip()), ""),
                "collections": uniq_keep_order(collections),
                "notes": uniq_keep_order(notes),
                "scentProfiles": uniq_keep_order(scent_profiles),
                "scentAccords": uniq_keep_order(scent_accords),
                "noteFamilies": uniq_keep_order(note_families),
                "materials": uniq_keep_order(materials),
                "marketingTags": uniq_keep_order(marketing_tags),
                "variantTags": uniq_keep_order(variant_tags),
                "categoryTokens": uniq_keep_order(category_tokens),
                "otherTokens": uniq_keep_order(other_tokens),
                "subtitle": subtitle,
                "description": description,
                "storyText": story_text,
                "image": image,
                "url": url,
                "sizes": uniq_keep_order(sizes),
                "priceMin": min(prices) if prices else None,
                "priceMax": max(prices) if prices else None,
                "stockTotal": sum(stock for stock in stocks if stock is not None),
                "skuCount": len(sku_items),
                "skus": sorted(
                    sku_items,
                    key=lambda item: (
                        item["size"] or "",
                        item["price"] if item["price"] is not None else 10**9,
                        item["sku"],
                    ),
                ),
            }
        )

    nodes = []
    for row in graph_nodes:
        nodes.append(
            {
                "id": row["id"],
                "nodeType": row["node_type"],
                "name": row["name"],
                "displayLabel": row["display_label"],
                "spu": row["spu"],
                "sku": row["sku"],
                "size": row["size"],
                "price": to_int(row["price"]),
                "stock": to_int(row["stock"]),
                "url": row["url"],
                "typeRaw": row["type_raw"],
                "typeDerived": row["type_derived"],
                "coreFamily": row["core_family"],
                "productForm": row["product_form"],
            }
        )

    edges = []
    for row in graph_edges:
        edges.append(
            {
                "source": row["source"],
                "target": row["target"],
                "edgeType": row["edge_type"],
                "sourceType": row["source_type"],
                "targetType": row["target_type"],
                "sourceName": row["source_name"],
                "targetName": row["target_name"],
                "viaField": row["via_field"],
                "relationLayer": row.get("relation_layer", ""),
                "evidenceType": row.get("evidence_type", ""),
                "evidenceText": row.get("evidence_text", ""),
                "evidenceUrl": row.get("evidence_url", ""),
                "confidence": row.get("confidence", ""),
                "reviewStatus": row.get("review_status", ""),
                "scenario": row.get("scenario", ""),
            }
        )

    recommendation_rules = [
        {
            "ruleId": row["rule_id"],
            "sourceProductId": f"product:{row['source_product_key']}",
            "sourceProductName": row["source_product_name"],
            "relationType": row["relation_type"],
            "targetCollection": row["target_collection"],
            "targetCoreFamily": row["target_core_family"],
            "targetProductForms": split_multi(row["target_product_forms"]),
            "evidenceType": row["evidence_type"],
            "evidenceField": row["evidence_field"],
            "evidenceText": row["evidence_text"],
            "evidenceUrl": row["evidence_url"],
            "confidence": row["confidence"],
            "reviewStatus": row["review_status"],
            "decisionReason": row["decision_reason"],
            "notes": row["notes"],
        }
        for row in recommendation_rule_rows
        if row.get("review_status") == "approved"
    ]

    payload = {
        "products": products,
        "recommendationRules": recommendation_rules,
        "graph": {
            "nodes": nodes,
            "edges": edges,
        },
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_JSON.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))

    print(f"Wrote {OUTPUT_JSON}")
    print(f"Products: {len(products)}")
    print(f"Graph nodes: {len(nodes)}")
    print(f"Graph edges: {len(edges)}")
    print(f"Recommendation rules: {len(recommendation_rules)}")


if __name__ == "__main__":
    main()
