# Hybrid RAG v1 regression

## Run

- Cases: 48 across 8 categories
- Local endpoint: `http://localhost:3000/api/chat`
- Raw automated score: 86%
- Business checks excluding local provider connectivity: 288/288, 100%
- Request failures: 0

The local sandbox could not connect to DeepSeek. Every non-deterministic request therefore recorded `deepseek_exception` and used the grounded fallback. The raw score includes that provider-status failure; it is not a retrieval or answer-quality failure.

## Provider-excluded results

| Category | Score |
| --- | ---: |
| Catalog facts | 100% |
| Ontology relations | 100% |
| Fuzzy preferences | 100% |
| Multi-constraint filtering | 100% |
| Comparison | 100% |
| Gifting | 100% |
| Multi-turn context | 100% |
| Challenge and safety | 100% |

## Regressions fixed during this run

- `除了香水` no longer forces the personal-fragrance family and now returns all non-perfume products in the requested series.
- Broad scent-experience questions search personal and home fragrance while excluding refill products.
- `我喜欢杜桑，但想找...` treats Do Son as a preference seed instead of a hard collection filter.
- Negative refill wording no longer becomes a positive `补充装` variant filter.
- Excluded scent terms apply to notes and scent concepts, not only collection names.
- Comparison retrieval reserves evidence for every named collection instead of allowing one collection to occupy all top results.
- Follow-up budget constraints preserve prior preferences; if structured retrieval finds zero valid products, semantic retrieval cannot bypass the empty result.

## Remaining validation

Run the same suite against Render after deployment. That run is required to evaluate DeepSeek reasoning and provider latency because the local sandbox cannot reach the provider.
