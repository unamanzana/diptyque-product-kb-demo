from __future__ import annotations

import csv
import hashlib
import json
from collections import Counter, defaultdict
from copy import deepcopy
from pathlib import Path

import build_scent_query_regression_snapshot_v1 as query_regression
import build_semantic_fact_dataset_v1 as semantic_facts


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
CURRENT_FRONTEND_PATH = REPO / "src" / "data" / "diptyque-frontend-data.json"
DATASET_PATH = ROOT / "diptyque_isolated_scent_identity_dataset_v1.json"
SEMANTIC_DATASET_PATH = ROOT / "diptyque_semantic_fact_dataset_v1.json"
NODE_MAP_PATH = ROOT / "diptyque_legacy_scent_node_replacement_v1.csv"
EDGE_MAP_PATH = ROOT / "diptyque_legacy_scent_edge_replacement_v1.csv"
QUERY_SNAPSHOT_PATH = ROOT / "diptyque_scent_query_regression_snapshot_v1.json"
NAME_REVIEW_PATH = ROOT / "diptyque_scent_identity_name_review_v1.csv"
CANDIDATE_PATH = ROOT / "diptyque_frontend_schema_v1_candidate.json"
COMPARISON_PATH = ROOT / "diptyque_frontend_schema_v1_comparison.json"
REPORT_PATH = REPO / "docs" / "ontology" / "frontend-schema-v1-candidate.md"


NOTE_FAMILY_DISPLAY_LABELS = {
    "木质": "木质调",
    "果香": "果香调",
    "柑橘": "柑橘调",
    "树脂琥珀": "琥珀调",
    "海洋矿物": "海洋调",
    "花香": "花香调",
    "茶香美食": "茶香与美食调",
    "草本绿香": "绿叶草本调",
    "辛香": "辛香调",
    "麝香粉香": "麝香粉香调",
}

def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def edge_key(edge: dict[str, object]) -> tuple[str, str, str]:
    return str(edge["source"]), str(edge["target"]), str(edge["edgeType"])


def main() -> None:
    production_hash_before = file_sha256(CURRENT_FRONTEND_PATH)
    query_regression.main()
    semantic_facts.main()

    current = json.loads(CURRENT_FRONTEND_PATH.read_text(encoding="utf-8"))
    dataset = json.loads(DATASET_PATH.read_text(encoding="utf-8"))
    semantic_dataset = json.loads(SEMANTIC_DATASET_PATH.read_text(encoding="utf-8"))
    query_snapshot = json.loads(QUERY_SNAPSHOT_PATH.read_text(encoding="utf-8"))
    node_map = read_csv(NODE_MAP_PATH)
    edge_map = read_csv(EDGE_MAP_PATH)
    name_review_rows = read_csv(NAME_REVIEW_PATH)

    entities = {entity["id"]: entity for entity in dataset["entities"]}
    evidence = {item["id"]: item for item in dataset["evidence"]}
    scents = [entity for entity in dataset["entities"] if entity["entityType"] == "ScentIdentity"]
    products = [entity for entity in dataset["entities"] if entity["entityType"] == "ProductConcept"]
    current_products = {product["id"]: product for product in current["products"]}

    dataset_to_frontend_product: dict[str, str] = {}
    for product in products:
        frontend_id = f"product:{product['properties']['productConceptKey']}"
        if frontend_id not in current_products:
            raise ValueError(f"Schema v1 ProductConcept cannot resolve to frontend product: {product['id']}")
        dataset_to_frontend_product[product["id"]] = frontend_id

    semantic_entities = {entity["id"]: entity for entity in semantic_dataset["entities"]}
    semantic_evidence = {item["id"]: item for item in semantic_dataset["evidence"]}
    semantic_products = [
        entity for entity in semantic_dataset["entities"] if entity["entityType"] == "ProductConcept"
    ]
    semantic_concepts = [
        entity for entity in semantic_dataset["entities"] if entity["entityType"] != "ProductConcept"
    ]
    semantic_domain_labels = {
        "Function": "功能",
        "UseScene": "使用场景",
        "UserNeed": "需求",
        "CareInstruction": "保养说明",
        "UsageInstruction": "使用说明",
        "Material": "材质",
        "CraftTechnique": "工艺",
    }
    semantic_domain_types = sorted({concept["entityType"] for concept in semantic_concepts})
    semantic_to_frontend_product: dict[str, str] = {}
    for product in semantic_products:
        frontend_id = f"product:{product['properties']['productConceptKey']}"
        if frontend_id not in current_products:
            raise ValueError(f"Semantic ProductConcept cannot resolve to frontend product: {product['id']}")
        semantic_to_frontend_product[product["id"]] = frontend_id

    semantic_property_keys = {
        "Function": "functions",
        "UseScene": "scenes",
        "UserNeed": "userNeeds",
        "CareInstruction": "careInstructions",
        "Material": "semanticMaterials",
        "CraftTechnique": "craftTechniques",
    }
    semantic_display_labels = {
        "HAS_FUNCTION": "功能",
        "HAS_SCENE": "场景",
        "SERVES_NEED": "需求",
        "HAS_CARE_INSTRUCTION": "保养",
        "HAS_MATERIAL": "材质",
        "HAS_CRAFT": "工艺",
    }
    semantic_values_by_product: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    semantic_edges = []
    for assertion in semantic_dataset["assertions"]:
        source_id = semantic_to_frontend_product[assertion["subjectId"]]
        concept = semantic_entities[assertion["objectId"]]
        evidence_item = semantic_evidence[assertion["evidenceIds"][0]]
        property_key = semantic_property_keys[concept["entityType"]]
        semantic_values_by_product[source_id][property_key].append(concept["name"])
        semantic_edges.append({
            "source": source_id,
            "target": concept["id"],
            "edgeType": assertion["predicate"],
            "sourceType": "Product",
            "targetType": concept["entityType"],
            "sourceName": current_products[source_id]["name"],
            "targetName": concept["name"],
            "viaField": evidence_item["sourceField"],
            "relationLayer": assertion["relationLayer"],
            "evidenceType": evidence_item["sourceType"],
            "evidenceText": evidence_item["excerpt"],
            "evidenceUrl": evidence_item["url"],
            "confidence": str(assertion["confidence"]),
            "reviewStatus": assertion["reviewStatus"],
            "scenario": "",
            "displayLabel": semantic_display_labels[assertion["predicate"]],
        })
    scents_by_product: dict[str, list[dict[str, str]]] = defaultdict(list)
    scent_edges = []
    for assertion in dataset["assertions"]:
        source_id = dataset_to_frontend_product[assertion["subjectId"]]
        scent = entities[assertion["objectId"]]
        evidence_item = evidence[assertion["evidenceIds"][0]]
        scent_ref = {
            "id": scent["id"],
            "name": scent["name"],
            "scentIdentityType": scent["properties"]["scentIdentityType"],
            "aliases": scent["properties"].get("aliases", []),
        }
        scents_by_product[source_id].append(scent_ref)
        scent_edges.append({
            "source": source_id,
            "target": scent["id"],
            "edgeType": "HAS_SCENT",
            "sourceType": "Product",
            "targetType": "ScentIdentity",
            "sourceName": current_products[source_id]["name"],
            "targetName": scent["name"],
            "viaField": evidence_item["sourceField"],
            "relationLayer": "fact",
            "evidenceType": evidence_item["sourceType"],
            "evidenceText": evidence_item["excerpt"],
            "evidenceUrl": evidence_item["url"],
            "confidence": str(assertion["confidence"]),
            "reviewStatus": assertion["reviewStatus"],
            "scenario": "",
            "displayLabel": "所属系列" if scent["properties"]["scentIdentityType"] == "SignatureFragrance" else "家居香味",
        })

    candidate_products = deepcopy(current["products"])
    for product in candidate_products:
        product["scentIdentities"] = sorted(
            scents_by_product.get(product["id"], []),
            key=lambda item: (item["scentIdentityType"], item["name"]),
        )
        semantic_values = semantic_values_by_product.get(product["id"], {})
        product["semanticFacts"] = {
            key: sorted(set(semantic_values.get(key, [])))
            for key in semantic_property_keys.values()
        }

    current_node_by_id = {node["id"]: node for node in current["graph"]["nodes"]}
    note_family_by_note: dict[str, str] = {}
    note_family_id_by_name: dict[str, str] = {}
    note_id_by_name: dict[str, str] = {
        node["name"]: node["id"]
        for node in current["graph"]["nodes"]
        if node["nodeType"] == "NoteIngredient"
    }
    for node in current["graph"]["nodes"]:
        if node["nodeType"] == "NoteFamily":
            note_family_id_by_name[node["name"]] = node["id"]
    for edge in current["graph"]["edges"]:
        source = current_node_by_id.get(edge["source"])
        target = current_node_by_id.get(edge["target"])
        if not source or not target or source["nodeType"] != "NoteFamily":
            continue
        if edge["edgeType"] == "HAS_NOTE" and target["nodeType"] == "NoteIngredient":
            note_family_by_note[target["name"]] = source["id"]

    products_by_scent: dict[str, list[dict[str, object]]] = defaultdict(list)
    for product in candidate_products:
        for scent_ref in product["scentIdentities"]:
            products_by_scent[scent_ref["id"]].append(product)

    product_note_family_edges = []
    product_note_edges = []
    for product in candidate_products:
        for family_name in product.get("noteFamilies", []):
            family_id = note_family_id_by_name.get(family_name)
            if not family_id:
                continue
            product_note_family_edges.append({
                "source": product["id"],
                "target": family_id,
                "edgeType": "HAS_NOTE_FAMILY",
                "sourceType": "Product",
                "targetType": "NoteFamily",
                "sourceName": product["name"],
                "targetName": current_node_by_id[family_id]["name"],
                "viaField": "note_families",
                "relationLayer": "fact",
                "evidenceType": "controlled_ontology_rule",
                "evidenceText": product.get("subtitle", ""),
                "evidenceUrl": product.get("url", ""),
                "confidence": "0.9",
                "reviewStatus": "approved",
                "scenario": "",
                "displayLabel": "香调",
            })
        for note_name in product.get("notes", []):
            note_id = note_id_by_name.get(note_name)
            if not note_id:
                continue
            product_note_edges.append({
                "source": product["id"],
                "target": note_id,
                "edgeType": "HAS_NOTE",
                "sourceType": "Product",
                "targetType": "NoteIngredient",
                "sourceName": product["name"],
                "targetName": note_name,
                "viaField": "note_tokens",
                "relationLayer": "fact",
                "evidenceType": "official_product_copy",
                "evidenceText": product.get("subtitle", ""),
                "evidenceUrl": product.get("url", ""),
                "confidence": "1.0",
                "reviewStatus": "approved",
                "scenario": "",
                "displayLabel": "香材",
            })
    formal_series_audit = []
    for scent in scents:
        if scent["properties"]["scentIdentityType"] != "SignatureFragrance":
            continue
        linked_products = products_by_scent.get(scent["id"], [])
        official_profiles = sorted({
            profile
            for product in linked_products
            for profile in product.get("scentProfiles", [])
        })
        families = sorted({
            family
            for product in linked_products
            for family in product.get("noteFamilies", [])
        })
        notes = sorted({
            note
            for product in linked_products
            for note in product.get("notes", [])
        })
        formal_series_audit.append({
            "scentIdentityId": scent["id"],
            "seriesName": scent["name"],
            "productCount": len(linked_products),
            "officialScentProfiles": official_profiles,
            "scentFamilies": families,
            "displayScentFamilies": [NOTE_FAMILY_DISPLAY_LABELS.get(family, family) for family in families],
            "noteIngredients": notes,
            "familyEvidence": "official_profile_and_notes" if official_profiles else "note_derived",
            "coverageStatus": "covered" if families else "missing",
        })
    name_review_summary = {
        "rowCount": len(name_review_rows),
        "approvedCount": sum(row["decision"] == "approved" for row in name_review_rows),
        "pendingCount": sum(row["decision"] == "pending_review" for row in name_review_rows),
        "pendingProductConceptKeys": sorted(
            row["product_concept_key"] for row in name_review_rows if row["decision"] == "pending_review"
        ),
    }
    scent_name_counts = Counter(scent["name"] for scent in scents)
    scent_type_labels = {"SignatureFragrance": "个人香氛", "HomeScent": "家居香氛"}
    legacy_node_ids = {row["legacy_node_id"] for row in node_map}
    candidate_nodes = [
        deepcopy(node) for node in current["graph"]["nodes"]
        if node["id"] not in legacy_node_ids
    ]
    for node in candidate_nodes:
        if node["nodeType"] == "NoteFamily":
            node["displayLabel"] = NOTE_FAMILY_DISPLAY_LABELS.get(
                node["name"],
                node["displayLabel"] if node["displayLabel"].endswith("调") else f"{node['displayLabel']}调",
            )
    candidate_nodes.extend({
        "id": scent["id"],
        "nodeType": "ScentIdentity",
        "name": scent["name"],
        "displayLabel": (
            f"{scent['name']}（{scent_type_labels[scent['properties']['scentIdentityType']]}）"
            if scent_name_counts[scent["name"]] > 1
            else scent["name"]
        ),
        "spu": "",
        "sku": "",
        "size": "",
        "price": None,
        "stock": None,
        "url": "",
        "typeRaw": "",
        "typeDerived": "",
        "coreFamily": "香味系列" if scent["properties"]["scentIdentityType"] == "SignatureFragrance" else "家居香味",
        "productForm": scent["properties"]["scentIdentityType"],
        "scentIdentityType": scent["properties"]["scentIdentityType"],
        "aliases": scent["properties"].get("aliases", []),
    } for scent in scents)
    candidate_nodes.extend({
        "id": concept["id"],
        "nodeType": concept["entityType"],
        "name": concept["name"],
        "displayLabel": concept["name"],
        "spu": "",
        "sku": "",
        "size": "",
        "price": None,
        "stock": None,
        "url": "",
        "typeRaw": "",
        "typeDerived": "",
        "coreFamily": "共享语义",
        "productForm": concept["entityType"],
        "aliases": concept["properties"].get("aliases", []),
        "vocabularyStatus": concept["properties"].get("vocabularyStatus", "approved"),
    } for concept in semantic_concepts)
    candidate_nodes.extend({
        "id": f"semantic-domain:{entity_type}",
        "nodeType": "SemanticDomain",
        "name": semantic_domain_labels[entity_type],
        "displayLabel": semantic_domain_labels[entity_type],
        "spu": "",
        "sku": "",
        "size": "",
        "price": None,
        "stock": None,
        "url": "",
        "typeRaw": "",
        "typeDerived": "",
        "coreFamily": "共享语义",
        "productForm": entity_type,
        "aliases": [],
    } for entity_type in semantic_domain_types)
    candidate_nodes.append({
        "id": "domain:系列",
        "nodeType": "OntologyDomain",
        "name": "系列",
        "displayLabel": "系列",
        "spu": "",
        "sku": "",
        "size": "",
        "price": None,
        "stock": None,
        "url": "",
        "typeRaw": "",
        "typeDerived": "",
        "coreFamily": "系列",
        "productForm": "ScentIdentity",
        "aliases": [],
    })
    candidate_nodes.sort(key=lambda node: node["id"])

    retired_edge_keys = {
        (row["legacy_source"], row["legacy_target"], row["legacy_edge_type"])
        for row in edge_map if row["action"] != "retain_navigation_only"
    }
    candidate_edges = [
        deepcopy(edge) for edge in current["graph"]["edges"]
        if edge_key(edge) not in retired_edge_keys
    ]
    candidate_edges.extend(scent_edges)
    candidate_edges.extend(product_note_family_edges)
    candidate_edges.extend(product_note_edges)
    candidate_edges.extend(semantic_edges)
    candidate_edges.extend({
        "source": f"semantic-domain:{concept['entityType']}",
        "target": concept["id"],
        "edgeType": "HAS_SEMANTIC_CONCEPT",
        "sourceType": "SemanticDomain",
        "targetType": concept["entityType"],
        "sourceName": semantic_domain_labels[concept["entityType"]],
        "targetName": concept["name"],
        "viaField": "schema_type_membership",
        "relationLayer": "navigation",
        "evidenceType": "schema_type_membership",
        "evidenceText": "",
        "evidenceUrl": "",
        "confidence": "1.0",
        "reviewStatus": "approved",
        "scenario": "",
        "displayLabel": "包含",
    } for concept in semantic_concepts)
    scent_domain = next((node for node in candidate_nodes if node["id"] == "domain:香调"), None)
    series_domain = next((node for node in candidate_nodes if node["id"] == "domain:系列"), None)
    if not scent_domain or not series_domain:
        raise ValueError("Expected both domain:香调 and domain:系列")
    candidate_edges.extend({
        "source": series_domain["id"],
        "target": scent["id"],
        "edgeType": "HAS_SCENT_IDENTITY",
        "sourceType": "OntologyDomain",
        "targetType": "ScentIdentity",
        "sourceName": series_domain["name"],
        "targetName": scent["name"],
        "viaField": "schema_type_membership",
        "relationLayer": "navigation",
        "evidenceType": "schema_type_membership",
        "evidenceText": "",
        "evidenceUrl": "",
        "confidence": "1.0",
        "reviewStatus": "approved",
        "scenario": "",
        "displayLabel": "香味系列",
    } for scent in scents if scent["properties"]["scentIdentityType"] == "SignatureFragrance")
    candidate_edges.sort(key=lambda edge: (edge["source"], edge["target"], edge["edgeType"]))

    candidate = {
        "schemaVersion": "1.0.0-candidate",
        "snapshotStatus": "isolated_validated_not_published",
        "sourceHashes": {
            "currentFrontend": production_hash_before,
            "scentIdentityDataset": file_sha256(DATASET_PATH),
            "semanticFactDataset": file_sha256(SEMANTIC_DATASET_PATH),
            "queryRegression": file_sha256(QUERY_SNAPSHOT_PATH),
        },
        "products": candidate_products,
        "recommendationRules": deepcopy(current.get("recommendationRules", [])),
        "graph": {"nodes": candidate_nodes, "edges": candidate_edges},
        "scentQueryIndex": query_snapshot["queryTerms"],
        "expectedExclusions": query_snapshot["expectedDifferences"],
        "scentSeriesAudit": {
            "summary": name_review_summary,
            "series": formal_series_audit,
        },
        "migration": {
            "removedLegacyNodeIds": sorted(legacy_node_ids),
            "removedLegacyEdgeCount": len(retired_edge_keys),
            "datasetToFrontendProductIds": dataset_to_frontend_product,
            "semanticDatasetToFrontendProductIds": semantic_to_frontend_product,
        },
    }

    comparison = validate_candidate(
        current=current,
        candidate=candidate,
        dataset=dataset,
        semantic_dataset=semantic_dataset,
        query_snapshot=query_snapshot,
        node_map=node_map,
        edge_map=edge_map,
        production_hash_before=production_hash_before,
    )
    CANDIDATE_PATH.write_text(
        json.dumps(candidate, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    comparison["checks"]["productionFrontendHashUnchanged"] = (
        file_sha256(CURRENT_FRONTEND_PATH) == production_hash_before
    )
    if not comparison["checks"]["productionFrontendHashUnchanged"]:
        comparison["failures"].append("Current frontend snapshot changed while building candidate")
    comparison["status"] = "PASS" if not comparison["failures"] else "FAIL"
    COMPARISON_PATH.write_text(
        json.dumps(comparison, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    write_report(comparison)

    print(f"Candidate: {CANDIDATE_PATH}")
    print(f"Products: {len(candidate_products)}")
    print(f"Graph nodes: {len(candidate_nodes)}, edges: {len(candidate_edges)}")
    print(f"Scent identities: {len(scents)}, formal series: {sum(scent['properties']['scentIdentityType'] == 'SignatureFragrance' for scent in scents)}, product facts: {len(scent_edges)}, note-family facts: {len(product_note_family_edges)}, note facts: {len(product_note_edges)}")
    print(f"Semantic concepts: {len(semantic_concepts)}, semantic facts: {len(semantic_edges)}")
    print(f"Validation: {comparison['status']}")
    if comparison["failures"]:
        raise SystemExit("; ".join(comparison["failures"]))


def validate_candidate(
    *,
    current: dict[str, object],
    candidate: dict[str, object],
    dataset: dict[str, object],
    semantic_dataset: dict[str, object],
    query_snapshot: dict[str, object],
    node_map: list[dict[str, str]],
    edge_map: list[dict[str, str]],
    production_hash_before: str,
) -> dict[str, object]:
    failures = []
    current_nodes = current["graph"]["nodes"]
    current_edges = current["graph"]["edges"]
    candidate_nodes = candidate["graph"]["nodes"]
    candidate_edges = candidate["graph"]["edges"]
    node_ids = {node["id"] for node in candidate_nodes}
    legacy_node_ids = {row["legacy_node_id"] for row in node_map}
    retired_edge_keys = {
        (row["legacy_source"], row["legacy_target"], row["legacy_edge_type"])
        for row in edge_map if row["action"] != "retain_navigation_only"
    }
    unresolved_edges = [
        edge_key(edge) for edge in candidate_edges
        if edge["source"] not in node_ids or edge["target"] not in node_ids
    ]
    leaked_legacy_nodes = sorted(node_ids & legacy_node_ids)
    leaked_retired_edges = sorted(edge_key(edge) for edge in candidate_edges if edge_key(edge) in retired_edge_keys)
    product_ids = {product["id"] for product in candidate["products"]}
    candidate_base_products = [
        {key: value for key, value in product.items() if key not in {"scentIdentities", "semanticFacts"}}
        for product in candidate["products"]
    ]
    max_scent_identities_per_product = max(
        (len(product["scentIdentities"]) for product in candidate["products"]),
        default=0,
    )
    scented_product_ids = {
        edge["source"] for edge in candidate_edges if edge["edgeType"] == "HAS_SCENT"
    }
    semantic_predicates = {assertion["predicate"] for assertion in semantic_dataset["assertions"]}
    semantic_fact_edges = [edge for edge in candidate_edges if edge["edgeType"] in semantic_predicates]
    semantic_product_ids = {edge["source"] for edge in semantic_fact_edges}
    semantic_concept_ids = {
        entity["id"] for entity in semantic_dataset["entities"] if entity["entityType"] != "ProductConcept"
    }
    query_by_term = {item["queryTerm"]: item for item in query_snapshot["queryTerms"]}

    checks = {
        "productionFrontendHashBefore": production_hash_before,
        "productionFrontendHashUnchanged": None,
        "productCountPreserved": len(candidate["products"]) == len(current["products"]) == 350,
        "productPayloadPreserved": candidate_base_products == current["products"],
        "skuCountPreserved": (
            sum(len(product["skus"]) for product in candidate["products"])
            == sum(len(product["skus"]) for product in current["products"])
            == 369
        ),
        "recommendationRulesPreserved": candidate["recommendationRules"] == current.get("recommendationRules", []),
        "legacyNodeCountRemoved": sum(node_id not in node_ids for node_id in legacy_node_ids),
        "legacySemanticNodesRemaining": leaked_legacy_nodes,
        "retiredLegacyEdgesRemaining": leaked_retired_edges,
        "unresolvedGraphEdges": unresolved_edges,
        "scentIdentityNodeCount": sum(node["nodeType"] == "ScentIdentity" for node in candidate_nodes),
        "hasScentEdgeCount": sum(edge["edgeType"] == "HAS_SCENT" for edge in candidate_edges),
        "scentIdentityNavigationEdgeCount": sum(
            edge["edgeType"] == "HAS_SCENT_IDENTITY" and edge["source"] == "domain:系列"
            for edge in candidate_edges
        ),
        "legacyScentSeriesEdgeCount": sum(
            edge["edgeType"] == "HAS_SCENT_SERIES" for edge in candidate_edges
        ),
        "productNoteFamilyEdgeCount": sum(
            edge["edgeType"] == "HAS_NOTE_FAMILY" and edge["sourceType"] == "Product"
            for edge in candidate_edges
        ),
        "productNoteEdgeCount": sum(
            edge["edgeType"] == "HAS_NOTE" and edge["sourceType"] == "Product"
            for edge in candidate_edges
        ),
        "seriesDomainNodeCount": sum(node["id"] == "domain:系列" for node in candidate_nodes),
        "nameReviewRowCount": candidate["scentSeriesAudit"]["summary"]["rowCount"],
        "pendingNameReviewCount": candidate["scentSeriesAudit"]["summary"]["pendingCount"],
        "formalSeriesAuditCount": len(candidate["scentSeriesAudit"]["series"]),
        "formalSeriesWithoutScentFamilyCount": sum(
            item["coverageStatus"] != "covered"
            for item in candidate["scentSeriesAudit"]["series"]
        ),
        "officialProfileSeriesCount": sum(
            bool(item["officialScentProfiles"])
            for item in candidate["scentSeriesAudit"]["series"]
        ),
        "scentedProductCount": len(scented_product_ids),
        "maxScentIdentitiesPerProduct": max_scent_identities_per_product,
        "allScentedProductsResolve": scented_product_ids <= product_ids,
        "semanticDatasetStatus": semantic_dataset["summary"]["status"],
        "semanticConceptNodeCount": sum(node["id"] in semantic_concept_ids for node in candidate_nodes),
        "semanticFactEdgeCount": len(semantic_fact_edges),
        "semanticProductCount": len(semantic_product_ids),
        "allSemanticProductsResolve": semantic_product_ids <= product_ids,
        "identityRegressionStatus": query_snapshot["status"],
        "figuierQueryCount": query_by_term["无花果"]["totalDistinctProducts"],
        "philosykosQueryCount": query_by_term["希腊无花果"]["totalDistinctProducts"],
        "philosykosResolution": query_by_term["希腊无花果"]["resolution"],
        "currentGraph": {
            "nodes": len(current_nodes),
            "edges": len(current_edges),
            "nodeTypes": dict(Counter(node["nodeType"] for node in current_nodes)),
        },
        "candidateGraph": {
            "nodes": len(candidate_nodes),
            "edges": len(candidate_edges),
            "nodeTypes": dict(Counter(node["nodeType"] for node in candidate_nodes)),
        },
    }

    expected = {
        "productCountPreserved": True,
        "productPayloadPreserved": True,
        "skuCountPreserved": True,
        "legacyNodeCountRemoved": 116,
        "scentIdentityNodeCount": 23,
        "hasScentEdgeCount": 155,
        "scentIdentityNavigationEdgeCount": 12,
        "legacyScentSeriesEdgeCount": 0,
        "productNoteFamilyEdgeCount": sum(len(product.get("noteFamilies", [])) for product in candidate["products"]),
        "productNoteEdgeCount": sum(len(product.get("notes", [])) for product in candidate["products"]),
        "seriesDomainNodeCount": 1,
        "nameReviewRowCount": 42,
        "pendingNameReviewCount": 4,
        "formalSeriesAuditCount": 12,
        "formalSeriesWithoutScentFamilyCount": 0,
        "officialProfileSeriesCount": 4,
        "scentedProductCount": 155,
        "maxScentIdentitiesPerProduct": 1,
        "semanticDatasetStatus": "PASS",
        "semanticConceptNodeCount": len(semantic_concept_ids),
        "semanticFactEdgeCount": len(semantic_dataset["assertions"]),
        "semanticProductCount": semantic_dataset["summary"]["productsWithSemanticFacts"],
        "allSemanticProductsResolve": True,
        "figuierQueryCount": 12,
        "philosykosQueryCount": 5,
        "philosykosResolution": "single_identity",
    }
    for key, value in expected.items():
        if checks[key] != value:
            failures.append(f"{key}: expected {value!r}, found {checks[key]!r}")
    if not checks["recommendationRulesPreserved"]:
        failures.append("Recommendation rules changed in candidate")
    if leaked_legacy_nodes:
        failures.append(f"Legacy semantic nodes remain: {len(leaked_legacy_nodes)}")
    if leaked_retired_edges:
        failures.append(f"Retired legacy edges remain: {len(leaked_retired_edges)}")
    if unresolved_edges:
        failures.append(f"Candidate graph has unresolved edges: {len(unresolved_edges)}")
    if not checks["allScentedProductsResolve"]:
        failures.append("HAS_SCENT references a product absent from frontend products")
    if semantic_dataset["summary"]["status"] != "PASS":
        failures.append("Semantic fact dataset is not PASS")
    if query_snapshot["status"] != "PASS":
        failures.append("Scent query regression gate is not PASS")

    return {
        "schemaVersion": "1.0.0",
        "status": "PASS" if not failures else "FAIL",
        "checks": checks,
        "expected": expected,
        "failures": failures,
        "publicationEffect": {"productionFrontendRecordsChanged": 0, "legacyGraphFilesChanged": 0},
    }


def write_report(comparison: dict[str, object]) -> None:
    checks = comparison["checks"]
    current_graph = checks["currentGraph"]
    candidate_graph = checks["candidateGraph"]
    lines = [
        "# Schema v1 前端候选快照",
        "",
        "## 结果",
        "",
        f"结果：**{comparison['status']}**。候选快照保留 350 个商品和全部推荐规则；系列入口包含 {checks['scentIdentityNavigationEdgeCount']} 个正式个人香氛系列，商品层新增 {checks['productNoteFamilyEdgeCount']} 条香调事实与 {checks['productNoteEdgeCount']} 条香材事实，另有 {checks['semanticConceptNodeCount']} 个共享语义概念。",
        "",
        "## 图谱变化",
        "",
        "| Metric | Current | Candidate |",
        "| --- | ---: | ---: |",
        f"| Graph nodes | {current_graph['nodes']} | {candidate_graph['nodes']} |",
        f"| Graph edges | {current_graph['edges']} | {candidate_graph['edges']} |",
        f"| Legacy CollectionOrScent + ScentConcept | 116 | 0 |",
        f"| ScentIdentity | 0 | {checks['scentIdentityNodeCount']} |",
        f"| HAS_SCENT | 0 | {checks['hasScentEdgeCount']} |",
        f"| 商品 → 香调 | 0 | {checks['productNoteFamilyEdgeCount']} |",
        f"| 商品 → 香材 | 0 | {checks['productNoteEdgeCount']} |",
        f"| Shared semantic concepts | 0 | {checks['semanticConceptNodeCount']} |",
        f"| Evidence-backed semantic facts | 0 | {checks['semanticFactEdgeCount']} |",
        "",
        "香调与香材都落在逐商品事实层；页面可按商品与系列事实求交集展示，不再用香调或香材给整个系列笼统定性。",
        "",
        "## 香味系列与香调审计",
        "",
        f"- {checks['scentIdentityNavigationEdgeCount']} 个正式个人香氛系列从独立的“系列”入口进入；其余家居气味身份不进入系列分支。",
        f"- 旧的“官方香调/香材归类 → 整个系列”边为 {checks['legacyScentSeriesEdgeCount']} 条。",
        f"- 名称审核清单共 {checks['nameReviewRowCount']} 条商品记录，其中 {checks['pendingNameReviewCount']} 条继续隔离。",
        f"- 已逐一审计 {checks['formalSeriesAuditCount']} 个正式系列；缺少香调归属的系列为 {checks['formalSeriesWithoutScentFamilyCount']} 个。",
        f"- {checks['officialProfileSeriesCount']} 个系列有官网直接香调表述，其余系列仅按官方香材事实归纳；用户界面统一显示“花香调、木质调、海洋调”等易懂名称。",
        "",
        "## 查询验收",
        "",
        f"- `希腊无花果`：单一 SignatureFragrance，{checks['philosykosQueryCount']} 款。",
        f"- `无花果`：单一 HomeScent，{checks['figuierQueryCount']} 款。",
        f"- 155 个带香气商品全部映射到现有前端 Product ID；未解析边为 {len(checks['unresolvedGraphEdges'])}。",
        "",
        "## 发布边界",
        "",
        "该文件由 NEXT_PUBLIC_DIPTYQUE_SCHEMA_V1=true 的独立预览读取；默认生产快照仍保持不变。语义事实进入单品和推荐局部子图，但模型推断和未审核长文不会显示为事实边。",
    ]
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
