# Official-copy Hybrid RAG v1

## Purpose

The chat pipeline combines three distinct responsibilities instead of asking the model to solve all of them:

1. QueryPlan applies intent, conversation context and hard constraints.
2. Structured product retrieval returns valid product candidates and approved graph relations.
3. Official-copy retrieval ranks exact Diptyque product-page excerpts for fuzzy preference interpretation and recommendation explanations.

The model may reason over these results, but it cannot treat retrieval expansion terms as facts.

## Evidence unit

Each official-copy hit includes:

- product ID and product name;
- source field: subtitle, description or story text;
- official product-page URL;
- exact source excerpt;
- retrieval score and matched retrieval terms.

The excerpt must exist verbatim in the selected product's source field. The automated audit checks this invariant.

## Retrieval boundary

Structured retrieval runs first. When it returns product IDs, official-copy retrieval is gated to those IDs. This prevents semantic similarity from bypassing category, price, excluded collection, excluded product form, size or refill constraints.

Chinese query expansions such as `白花 -> 晚香玉/茉莉/橙花` and `森林 -> 雪松/檀香/苔藓` are ranking aids only. The answer must cite the returned exact excerpt or structured ontology fact, never the expansion itself.

## Claim verifier

The initial verifier blocks unsupported assertions about:

- popularity or sales;
- guaranteed longevity, effect or safety;
- gender-specific suitability;
- pet safety.

If the model emits one of these claims without matching evidence, the response falls back to the grounded local answer.

## Operations

No new Render environment variable is required. The index is built from the deployed frontend product snapshot.

Run:

```powershell
npm run audit:official-copy-rag
npm run eval:chat
npm run check
```

The same 48-question dataset remains the regression baseline so improvements are comparable between versions.
