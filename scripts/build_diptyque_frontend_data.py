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

    raw_by_sku = {(row.get("sku") or "").strip(): row for row in raw_rows if (row.get("sku") or "").strip()}
    product_groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in cleaned_rows:
        product_groups[(row.get("spu") or "").strip()].append(row)

    products: list[dict[str, object]] = []

    for spu, group in sorted(product_groups.items(), key=lambda item: item[0]):
        first = group[0]
        sku_items: list[dict[str, object]] = []
        sizes: list[str] = []
        prices: list[int] = []
        stocks: list[int] = []
        collections: list[str] = []
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
                "id": f"product:{spu}",
                "name": (first.get("product_name") or "").strip(),
                "identityName": (first.get("identity_name") or "").strip(),
                "spu": spu,
                "coreFamily": (first.get("core_family") or "").strip(),
                "productForm": (first.get("product_form") or "").strip(),
                "typeRaw": (first.get("type_raw") or "").strip(),
                "typeDerived": (first.get("type_derived") or "").strip(),
                "collections": uniq_keep_order(collections),
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
            }
        )

    payload = {
        "products": products,
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


if __name__ == "__main__":
    main()
