from __future__ import annotations

import csv
import re
from collections import defaultdict
from pathlib import Path

from clean_diptyque_products_v2 import classify_note_families, derive_scent_concept_evidence


ROOT = Path(__file__).resolve().parent
INPUT_CSV = ROOT / "diptyque_products_cleaned.csv"
NODES_CSV = ROOT / "diptyque_graph_nodes.csv"
EDGES_CSV = ROOT / "diptyque_graph_edges.csv"
NEO4J_NODES_CSV = ROOT / "diptyque_graph_nodes_neo4j.csv"
NEO4J_EDGES_CSV = ROOT / "diptyque_graph_edges_neo4j.csv"
RELATION_DICTIONARY_CSV = ROOT / "diptyque_relation_dictionary.csv"
PRODUCT_RELATIONS_CSV = ROOT / "diptyque_product_relations.csv"
COMPATIBILITY_SPEC_RELATIONS_CSV = ROOT / "diptyque_compatibility_spec_relations.csv"


def split_multi(value: str) -> list[str]:
    return [part.strip() for part in (value or "").split("|") if part.strip()]


def uniq_keep_order(values):
    return list(dict.fromkeys(values))


def node_id(kind: str, name: str) -> str:
    return f"{kind}:{name}"


def first_nonblank(*values: str) -> str:
    for value in values:
        if value:
            return value
    return ""


def main() -> None:
    with INPUT_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))

    nodes: dict[str, dict[str, str]] = {}
    edge_keys: set[tuple[str, str, str]] = set()
    edges: list[dict[str, str]] = []
    product_keys_by_name: dict[str, set[str]] = defaultdict(set)
    sizes_by_product_key: dict[str, set[str]] = defaultdict(set)
    semantic_names: set[str] = set()

    for row in rows:
        product_key = (row.get("product_key") or "").strip()
        product_name = (row.get("product_name") or "").strip()
        product_keys_by_name[product_name].add(product_key)
        size = (row.get("size") or "").strip()
        if size:
            sizes_by_product_key[product_key].add(size)
        semantic_names.update(
            value
            for value in [
                (row.get("core_family") or "").strip(),
                (row.get("product_form") or "").strip(),
                *split_multi(row.get("collection_or_scent") or ""),
                *split_multi(row.get("note_tokens") or ""),
                *split_multi(row.get("scent_profiles") or ""),
                *split_multi(row.get("scent_accords") or ""),
                *split_multi(row.get("scent_concepts") or ""),
                *split_multi(row.get("material_or_craft") or ""),
                *split_multi(row.get("marketing_tags") or ""),
                *split_multi(row.get("variant_tags") or ""),
            ]
            if value
        )

    def add_node(
        id_value: str,
        node_type: str,
        name: str,
        *,
        display_label: str = "",
        spu: str = "",
        sku: str = "",
        size: str = "",
        price: str = "",
        stock: str = "",
        url: str = "",
        type_raw: str = "",
        type_derived: str = "",
        core_family: str = "",
        product_form: str = "",
    ) -> None:
        existing = nodes.get(id_value)
        base = {
            "id": id_value,
            "node_type": node_type,
            "name": name,
            "display_label": display_label or name,
            "spu": spu,
            "sku": sku,
            "size": size,
            "price": price,
            "stock": stock,
            "url": url,
            "type_raw": type_raw,
            "type_derived": type_derived,
            "core_family": core_family,
            "product_form": product_form,
        }
        if existing is None:
            nodes[id_value] = base
            return

        for key, value in base.items():
            if key == "id":
                continue
            if not existing.get(key) and value:
                existing[key] = value

    def add_edge(
        source: str,
        target: str,
        edge_type: str,
        *,
        source_type: str,
        target_type: str,
        source_name: str,
        target_name: str,
        via_field: str,
        relation_layer: str = "fact",
        evidence_type: str = "source_field",
        evidence_text: str = "",
        evidence_url: str = "",
        confidence: str = "1.00",
        review_status: str = "source_derived",
        scenario: str = "",
    ) -> None:
        key = (source, edge_type, target)
        if key in edge_keys:
            return
        edge_keys.add(key)
        edges.append(
            {
                "source": source,
                "target": target,
                "edge_type": edge_type,
                "source_type": source_type,
                "target_type": target_type,
                "source_name": source_name,
                "target_name": target_name,
                "via_field": via_field,
                "relation_layer": relation_layer,
                "evidence_type": evidence_type,
                "evidence_text": evidence_text,
                "evidence_url": evidence_url,
                "confidence": confidence,
                "review_status": review_status,
                "scenario": scenario,
            }
        )

    scent_domain_id = node_id("domain", "香调")
    add_node(scent_domain_id, "OntologyDomain", "香调")

    def add_scent_term(
        term: str,
        *,
        kind: str,
        node_type: str,
        family_edge_type: str,
        via_field: str,
        product_id: str,
        product_name: str,
    ) -> None:
        term_id = node_id(kind, term)
        add_node(term_id, node_type, term)
        for family in classify_note_families(term):
            family_id = node_id("note_family", family)
            add_node(family_id, "NoteFamily", family)
            add_edge(
                scent_domain_id,
                family_id,
                "HAS_NOTE_FAMILY",
                source_type="OntologyDomain",
                target_type="NoteFamily",
                source_name="香调",
                target_name=family,
                via_field="note_family_rules",
            )
            add_edge(
                family_id,
                term_id,
                family_edge_type,
                source_type="NoteFamily",
                target_type=node_type,
                source_name=family,
                target_name=term,
                via_field="note_family_rules",
            )
        add_edge(
            term_id,
            product_id,
            "HAS_PRODUCT",
            source_type=node_type,
            target_type="Product",
            source_name=term,
            target_name=product_name,
            via_field=via_field,
        )

    for row in rows:
        product_name = (row.get("product_name") or "").strip()
        product_key = (row.get("product_key") or "").strip()
        spu = (row.get("spu") or "").strip()
        sku = (row.get("sku") or "").strip()
        product_display = first_nonblank(product_name, (row.get("identity_name") or "").strip())
        if len(product_keys_by_name[product_name]) > 1:
            qualifier = " / ".join(sorted(sizes_by_product_key[product_key])) or spu
            product_display = f"{product_display}（{qualifier}）"
        elif product_name in semantic_names:
            product_display = f"{product_display}（商品）"
        product_id = node_id("product", product_key)
        sku_id = node_id("sku", sku)

        type_raw = (row.get("type_raw") or "").strip()
        type_derived = (row.get("type_derived") or "").strip()
        core_family = (row.get("core_family") or "").strip()
        product_form = (row.get("product_form") or "").strip()

        add_node(
            product_id,
            "Product",
            product_name,
            display_label=product_display,
            spu=spu,
            url=(row.get("url") or "").strip(),
            type_raw=type_raw,
            type_derived=type_derived,
            core_family=core_family,
            product_form=product_form,
        )
        add_node(
            sku_id,
            "SKU",
            first_nonblank(f"{product_name} {(row.get('size') or '').strip()}".strip(), sku),
            display_label=first_nonblank((row.get("size") or "").strip(), sku),
            spu=spu,
            sku=sku,
            size=(row.get("size") or "").strip(),
            price=(row.get("price") or "").strip(),
            stock=(row.get("stock") or "").strip(),
            url=(row.get("url") or "").strip(),
            type_raw=type_raw,
            type_derived=type_derived,
            core_family=core_family,
            product_form=product_form,
        )
        add_edge(
            product_id,
            sku_id,
            "HAS_SKU",
            source_type="Product",
            target_type="SKU",
            source_name=product_name,
            target_name=sku,
            via_field="product_key/sku",
        )

        if core_family:
            family_id = node_id("family", core_family)
            add_node(family_id, "CoreFamily", core_family)

        if product_form:
            form_id = node_id("form", product_form)
            add_node(form_id, "ProductForm", product_form)
            if core_family:
                add_edge(
                    family_id,
                    form_id,
                    "HAS_PRODUCT_FORM",
                    source_type="CoreFamily",
                    target_type="ProductForm",
                    source_name=core_family,
                    target_name=product_form,
                    via_field="core_family/product_form",
                )
            add_edge(
                form_id,
                product_id,
                "HAS_PRODUCT",
                source_type="ProductForm",
                target_type="Product",
                source_name=product_form,
                target_name=product_name,
                via_field="product_form",
            )
        elif core_family:
            add_edge(
                family_id,
                product_id,
                "HAS_PRODUCT",
                source_type="CoreFamily",
                target_type="Product",
                source_name=core_family,
                target_name=product_name,
                via_field="core_family",
            )

        for collection in split_multi(row.get("collection_or_scent") or ""):
            collection_id = node_id("collection", collection)
            add_node(collection_id, "CollectionOrScent", collection)
            add_edge(
                collection_id,
                product_id,
                "HAS_PRODUCT",
                source_type="CollectionOrScent",
                target_type="Product",
                source_name=collection,
                target_name=product_name,
                via_field="collection_or_scent",
            )

        for note in split_multi(row.get("note_tokens") or ""):
            add_scent_term(
                note,
                kind="note",
                node_type="NoteIngredient",
                family_edge_type="HAS_NOTE",
                via_field="note_tokens",
                product_id=product_id,
                product_name=product_name,
            )

        for profile in split_multi(row.get("scent_profiles") or ""):
            add_scent_term(
                profile,
                kind="scent_profile",
                node_type="ScentProfile",
                family_edge_type="HAS_SCENT_PROFILE",
                via_field="scent_profiles",
                product_id=product_id,
                product_name=product_name,
            )

        for accord in split_multi(row.get("scent_accords") or ""):
            add_scent_term(
                accord,
                kind="scent_accord",
                node_type="ScentAccord",
                family_edge_type="HAS_SCENT_ACCORD",
                via_field="scent_accords",
                product_id=product_id,
                product_name=product_name,
            )

        concept_evidence = derive_scent_concept_evidence(
            split_multi(row.get("collection_or_scent") or ""),
            split_multi(row.get("note_tokens") or ""),
            split_multi(row.get("scent_accords") or ""),
        )
        source_node_specs = {
            "collection_or_scent": ("collection", "CollectionOrScent"),
            "note_tokens": ("note", "NoteIngredient"),
            "scent_accords": ("scent_accord", "ScentAccord"),
        }
        for concept, evidence_items in concept_evidence.items():
            concept_id = node_id("scent_concept", concept)
            add_node(concept_id, "ScentConcept", concept)
            source_terms = [term for _, term in evidence_items]
            families = uniq_keep_order(
                family
                for term in [concept, *source_terms]
                for family in classify_note_families(term)
                if family != "未分类"
            ) or ["未分类"]
            for family in families:
                family_id = node_id("note_family", family)
                add_node(family_id, "NoteFamily", family)
                add_edge(
                    scent_domain_id,
                    family_id,
                    "HAS_NOTE_FAMILY",
                    source_type="OntologyDomain",
                    target_type="NoteFamily",
                    source_name="香调",
                    target_name=family,
                    via_field="scent_concept_rules",
                )
                add_edge(
                    family_id,
                    concept_id,
                    "HAS_SCENT_CONCEPT",
                    source_type="NoteFamily",
                    target_type="ScentConcept",
                    source_name=family,
                    target_name=concept,
                    via_field="scent_concept_rules",
                )

            evidence_fields = uniq_keep_order(field for field, _ in evidence_items)
            evidence_text = "; ".join(f"{field}:{term}" for field, term in evidence_items)
            add_edge(
                concept_id,
                product_id,
                "HAS_PRODUCT",
                source_type="ScentConcept",
                target_type="Product",
                source_name=concept,
                target_name=product_name,
                via_field="+".join(evidence_fields),
                evidence_type="normalized_source_fields",
                evidence_text=evidence_text,
            )
            for source_field, source_term in evidence_items:
                source_kind, source_type = source_node_specs[source_field]
                expression_id = node_id(source_kind, source_term)
                add_edge(
                    concept_id,
                    expression_id,
                    "HAS_SCENT_EXPRESSION",
                    source_type="ScentConcept",
                    target_type=source_type,
                    source_name=concept,
                    target_name=source_term,
                    via_field=source_field,
                    evidence_type="controlled_vocabulary",
                    evidence_text=f"{source_field}:{source_term}",
                )

        for material in split_multi(row.get("material_or_craft") or ""):
            material_id = node_id("material", material)
            add_node(material_id, "MaterialOrCraft", material)
            add_edge(
                material_id,
                product_id,
                "HAS_PRODUCT",
                source_type="MaterialOrCraft",
                target_type="Product",
                source_name=material,
                target_name=product_name,
                via_field="material_or_craft",
            )

        for marketing_tag in split_multi(row.get("marketing_tags") or ""):
            tag_id = node_id("marketing_tag", marketing_tag)
            add_node(tag_id, "MarketingTag", marketing_tag)
            add_edge(
                tag_id,
                product_id,
                "HAS_PRODUCT",
                source_type="MarketingTag",
                target_type="Product",
                source_name=marketing_tag,
                target_name=product_name,
                via_field="marketing_tags",
            )

        for variant_tag in split_multi(row.get("variant_tags") or ""):
            variant_id = node_id("variant_tag", variant_tag)
            add_node(variant_id, "VariantTag", variant_tag)
            add_edge(
                variant_id,
                product_id,
                "HAS_PRODUCT",
                source_type="VariantTag",
                target_type="Product",
                source_name=variant_tag,
                target_name=product_name,
                via_field="variant_tags",
            )

    compatibility_spec_count = 0
    product_spec_edge_count = 0
    candle_form_exclusions = {"烛罩", "烛台", "烛盖和灭烛罩", "香氛蜡烛配饰"}
    for row in rows:
        product_key = (row.get("product_key") or "").strip()
        product_id = node_id("product", product_key)
        product_name = (row.get("product_name") or "").strip()
        product_form = (row.get("product_form") or "").strip()
        core_family = (row.get("core_family") or "").strip()

        if "蜡烛" in product_name and product_form not in candle_form_exclusions:
            grams_values = {
                int(value)
                for value in re.findall(r"(?<!\d)(\d{2,4})\s*(?:g|G|克)", (row.get("size") or ""))
            }
            for grams in grams_values:
                spec_value = f"{grams}g"
                spec_name = f"{spec_value}蜡烛"
                spec_id = node_id("compatibility_spec", f"candle_weight:{spec_value}")
                if spec_id not in nodes:
                    compatibility_spec_count += 1
                add_node(spec_id, "CompatibilitySpec", spec_name)
                before = len(edges)
                add_edge(
                    product_id,
                    spec_id,
                    "HAS_COMPATIBILITY_SPEC",
                    source_type="Product",
                    target_type="CompatibilitySpec",
                    source_name=product_name,
                    target_name=spec_name,
                    via_field="size",
                    relation_layer="fact",
                    evidence_type="source_field",
                    evidence_text=(row.get("size") or "").strip(),
                    confidence="1.00",
                    review_status="source_derived",
                    scenario="商品规格",
                )
                product_spec_edge_count += int(len(edges) > before)

        generic_specs: list[tuple[str, str, str, str, str]] = []
        if product_form == "香氛皂":
            generic_specs.append(("product_form", "香氛皂", "香氛皂", "product_form", product_form))
        if (
            core_family == "家居香氛"
            and "蜡烛" in product_name
            and "补充" not in product_name
            and product_form not in candle_form_exclusions
        ):
            generic_specs.append(
                ("product_class", "fragrance_candle", "室内香氛蜡烛", "core_family+product_form", product_form)
            )

        for spec_type, spec_value, spec_name, via_field, evidence_text in generic_specs:
            spec_id = node_id("compatibility_spec", f"{spec_type}:{spec_value}")
            if spec_id not in nodes:
                compatibility_spec_count += 1
            add_node(spec_id, "CompatibilitySpec", spec_name)
            before = len(edges)
            add_edge(
                product_id,
                spec_id,
                "HAS_COMPATIBILITY_SPEC",
                source_type="Product",
                target_type="CompatibilitySpec",
                source_name=product_name,
                target_name=spec_name,
                via_field=via_field,
                relation_layer="fact",
                evidence_type="source_field",
                evidence_text=evidence_text,
                confidence="1.00",
                review_status="source_derived",
                scenario="商品兼容类别",
            )
            product_spec_edge_count += int(len(edges) > before)
    relation_types: dict[str, dict[str, str]] = {}
    if RELATION_DICTIONARY_CSV.exists():
        with RELATION_DICTIONARY_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
            relation_types = {
                (item.get("relation_type") or "").strip(): item
                for item in csv.DictReader(handle)
                if (item.get("relation_type") or "").strip()
            }

    approved_relation_count = 0
    if PRODUCT_RELATIONS_CSV.exists():
        with PRODUCT_RELATIONS_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
            relation_rows = list(csv.DictReader(handle))
        for relation in relation_rows:
            if (relation.get("review_status") or "").strip().lower() != "approved":
                continue
            relation_type = (relation.get("relation_type") or "").strip()
            definition = relation_types.get(relation_type)
            if not definition:
                raise ValueError(f"Unknown approved relation type: {relation_type}")
            if definition.get("source_node_type") != "Product" or definition.get("target_node_type") != "Product":
                raise ValueError(f"Unsupported approved relation endpoints for {relation_type}")
            source_id = node_id("product", (relation.get("source_product_key") or "").strip())
            target_id = node_id("product", (relation.get("target_product_key") or "").strip())
            if source_id not in nodes or target_id not in nodes:
                raise ValueError(
                    f"Approved relation references missing product: {relation.get('relation_id') or relation_type}"
                )
            confidence = (relation.get("confidence") or "").strip()
            min_confidence = (definition.get("min_confidence") or "0").strip()
            if float(confidence or 0) < float(min_confidence or 0):
                raise ValueError(
                    f"Approved relation is below minimum confidence: {relation.get('relation_id') or relation_type}"
                )
            add_edge(
                source_id,
                target_id,
                relation_type,
                source_type="Product",
                target_type="Product",
                source_name=nodes[source_id]["name"],
                target_name=nodes[target_id]["name"],
                via_field=(relation.get("evidence_field") or "").strip(),
                relation_layer=(definition.get("relation_layer") or "").strip(),
                evidence_type=(relation.get("evidence_type") or "").strip(),
                evidence_text=(relation.get("evidence_text") or "").strip(),
                evidence_url=(relation.get("evidence_url") or "").strip(),
                confidence=confidence,
                review_status="approved",
                scenario=(relation.get("scenario") or "").strip(),
            )
            approved_relation_count += 1

    approved_spec_relation_count = 0
    if COMPATIBILITY_SPEC_RELATIONS_CSV.exists():
        with COMPATIBILITY_SPEC_RELATIONS_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
            spec_relation_rows = list(csv.DictReader(handle))
        definition = relation_types.get("ACCESSORY_FOR_SPEC")
        if not definition:
            raise ValueError("Missing ACCESSORY_FOR_SPEC relation definition")
        for relation in spec_relation_rows:
            if (relation.get("review_status") or "").strip().lower() != "approved":
                continue
            source_id = node_id("product", (relation.get("source_product_key") or "").strip())
            spec_type = (relation.get("spec_type") or "").strip()
            spec_value = (relation.get("spec_value") or "").strip()
            spec_id = node_id("compatibility_spec", f"{spec_type}:{spec_value}")
            if source_id not in nodes:
                raise ValueError(
                    f"Approved compatibility relation references missing product: {relation.get('compatibility_id')}"
                )
            confidence = (relation.get("confidence") or "").strip()
            if float(confidence or 0) < float(definition.get("min_confidence") or 0):
                raise ValueError(
                    f"Approved compatibility relation is below minimum confidence: {relation.get('compatibility_id')}"
                )
            spec_name = (relation.get("spec_label") or "").strip() or spec_value
            add_node(spec_id, "CompatibilitySpec", spec_name)
            add_edge(
                source_id,
                spec_id,
                "ACCESSORY_FOR_SPEC",
                source_type="Product",
                target_type="CompatibilitySpec",
                source_name=nodes[source_id]["name"],
                target_name=spec_name,
                via_field=(relation.get("evidence_field") or "").strip(),
                relation_layer=(definition.get("relation_layer") or "").strip(),
                evidence_type=(relation.get("evidence_type") or "").strip(),
                evidence_text=(relation.get("evidence_text") or "").strip(),
                evidence_url=(relation.get("evidence_url") or "").strip(),
                confidence=confidence,
                review_status="approved",
                scenario=(relation.get("scenario") or "").strip(),
            )
            approved_spec_relation_count += 1

    node_fields = [
        "id",
        "node_type",
        "name",
        "display_label",
        "spu",
        "sku",
        "size",
        "price",
        "stock",
        "url",
        "type_raw",
        "type_derived",
        "core_family",
        "product_form",
    ]

    with NODES_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=node_fields)
        writer.writeheader()
        writer.writerows(sorted(nodes.values(), key=lambda item: (item["node_type"], item["id"])))

    edge_fields = [
        "source",
        "target",
        "edge_type",
        "source_type",
        "target_type",
        "source_name",
        "target_name",
        "via_field",
        "relation_layer",
        "evidence_type",
        "evidence_text",
        "evidence_url",
        "confidence",
        "review_status",
        "scenario",
    ]

    with EDGES_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=edge_fields)
        writer.writeheader()
        writer.writerows(sorted(edges, key=lambda item: (item["edge_type"], item["source"], item["target"])))

    neo4j_node_fields = [
        "id:ID",
        ":LABEL",
        "name",
        "display_label",
        "node_type",
        "spu",
        "sku",
        "size",
        "price",
        "stock",
        "url",
        "type_raw",
        "type_derived",
        "core_family",
        "product_form",
    ]
    neo4j_node_rows = []
    for item in sorted(nodes.values(), key=lambda value: (value["node_type"], value["id"])):
        neo4j_node_rows.append(
            {
                "id:ID": item["id"],
                ":LABEL": item["node_type"],
                "name": item["name"],
                "display_label": item["display_label"],
                "node_type": item["node_type"],
                "spu": item["spu"],
                "sku": item["sku"],
                "size": item["size"],
                "price": item["price"],
                "stock": item["stock"],
                "url": item["url"],
                "type_raw": item["type_raw"],
                "type_derived": item["type_derived"],
                "core_family": item["core_family"],
                "product_form": item["product_form"],
            }
        )

    with NEO4J_NODES_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=neo4j_node_fields)
        writer.writeheader()
        writer.writerows(neo4j_node_rows)

    neo4j_edge_fields = [
        ":START_ID",
        ":END_ID",
        ":TYPE",
        "source_type",
        "target_type",
        "source_name",
        "target_name",
        "via_field",
        "relation_layer",
        "evidence_type",
        "evidence_text",
        "evidence_url",
        "confidence",
        "review_status",
        "scenario",
    ]
    neo4j_edge_rows = []
    for item in sorted(edges, key=lambda value: (value["edge_type"], value["source"], value["target"])):
        neo4j_edge_rows.append(
            {
                ":START_ID": item["source"],
                ":END_ID": item["target"],
                ":TYPE": item["edge_type"],
                "source_type": item["source_type"],
                "target_type": item["target_type"],
                "source_name": item["source_name"],
                "target_name": item["target_name"],
                "via_field": item["via_field"],
                "relation_layer": item["relation_layer"],
                "evidence_type": item["evidence_type"],
                "evidence_text": item["evidence_text"],
                "evidence_url": item["evidence_url"],
                "confidence": item["confidence"],
                "review_status": item["review_status"],
                "scenario": item["scenario"],
            }
        )

    with NEO4J_EDGES_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=neo4j_edge_fields)
        writer.writeheader()
        writer.writerows(neo4j_edge_rows)

    print(f"Wrote {NODES_CSV}")
    print(f"Wrote {EDGES_CSV}")
    print(f"Wrote {NEO4J_NODES_CSV}")
    print(f"Wrote {NEO4J_EDGES_CSV}")
    print(f"Node count: {len(nodes)}")
    print(f"Edge count: {len(edges)}")
    print(f"Approved product relations: {approved_relation_count}")
    print(f"Compatibility spec nodes: {compatibility_spec_count}")
    print(f"Product spec edges: {product_spec_edge_count}")
    print(f"Approved accessory spec relations: {approved_spec_relation_count}")


if __name__ == "__main__":
    main()
