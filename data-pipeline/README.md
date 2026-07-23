# Diptyque Data Pipeline

This directory is the versioned source of truth for Diptyque product cleaning,
ontology export, factual product relations, and data audits.

## Core Rebuild

Run from the repository root:

```powershell
npm run data:rebuild
```

The command performs these steps in order:

1. Clean `diptyque_products.csv` into typed product fields.
2. Export graph nodes and edges, including `ScentConcept` associations.
3. Audit every scent-concept-to-product edge for missing or extra products.
4. Rebuild `src/data/diptyque-frontend-data.json`.

The rebuild stops immediately when any step fails.

## Versioned Inputs

- `diptyque_products.csv`: raw product export.
- `diptyque_relation_dictionary.csv`: controlled relation vocabulary.
- `diptyque_product_relations.csv`: reviewed product-to-product relations.
- `diptyque_compatibility_spec_relations.csv`: reviewed compatibility facts.
- `diptyque_recommendation_rules.csv`: approved recommendation rules.
- `diptyque_token_dictionary_template.csv`: taxonomy review template.

Generated graph CSVs, candidate relations, Neo4j exports, and model batches are
ignored by Git. They can be recreated from the versioned inputs and scripts.

## Ontology Boundary

Factual ontology edges and recommendation edges remain separate. Scent links
must come from structured collection, note, profile, or accord evidence. Product
name substring matches must not create scent or material relationships.
