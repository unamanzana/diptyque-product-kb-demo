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
4. Audit product-to-product relationship coverage and generate review-only candidates.
5. Rebuild `src/data/diptyque-frontend-data.json`.

The rebuild stops immediately when any step fails.

## Versioned Inputs

- `diptyque_products.csv`: raw product export.
- `diptyque_relation_dictionary.csv`: controlled relation vocabulary.
- `diptyque_product_relations.csv`: reviewed product-to-product relations.
- `diptyque_reviewed_recommendation_relations.csv`: model-assisted and rule-gated recommendation relationships.
- `diptyque_compatibility_spec_relations.csv`: reviewed compatibility facts.
- `diptyque_recommendation_rules.csv`: approved recommendation rules.
- `diptyque_token_dictionary_template.csv`: taxonomy review template.

Generated graph CSVs, Neo4j exports, and model batches are ignored by Git. The
relationship audit step also recreates `diptyque_relation_coverage_audit.csv`
and `diptyque_relation_candidates.csv`. Candidates remain `pending_review`
and are never exported as graph edges until moved into a reviewed input file.

Run `npm run data:review-relations` separately to send the current candidate
set through the configured DeepSeek model. The command writes resumable model
review output, but model decisions are not treated as final approval and are
not included in the core rebuild because they use an external paid service.
Run `npm run data:adjudicate-relations` to rebuild the review queue. Publishing
is a separate explicit step: `npm run data:publish-reviewed-relations` writes
the versioned recommendation input consumed by the graph exporter.

## Ontology Boundary

Factual ontology edges and recommendation edges remain separate. Scent links
must come from structured collection, note, profile, or accord evidence. Product
name substring matches must not create scent or material relationships.
## Schema v1 Frontend Candidate

Build the isolated frontend candidate without changing the production snapshot:

```powershell
npm run data:build-frontend-schema-v1-candidate
```

The command rebuilds the approved ScentIdentity migration and regression gate,
then writes `diptyque_frontend_schema_v1_candidate.json` plus its comparison
report. It must not overwrite `src/data/diptyque-frontend-data.json` or the
legacy graph CSV files.