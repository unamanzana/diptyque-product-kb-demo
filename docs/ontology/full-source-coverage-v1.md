# Ontology Schema v1 full-source coverage audit

## Audit boundary

This read-only audit covers 370 raw rows, 350 ProductConcepts, and 370 SKUs. It does not publish facts, add graph edges, or change frontend data.

`direct` means an official source field explicitly supports the dimension. `candidate` means a controlled product-form or cleaned-field mapping exists but still needs evidence review. `none` means no v1 evidence was found; it does not prove the fact is false.

## Overall coverage

| Dimension | Direct | Candidate | None | Direct rate |
| --- | ---: | ---: | ---: | ---: |
| ScentIdentity | 124 | 42 | 184 | 35.4% |
| NoteIngredient | 97 | 0 | 253 | 27.7% |
| ScentProfile | 145 | 0 | 205 | 41.4% |
| Function | 154 | 177 | 19 | 44.0% |
| UseScene | 47 | 0 | 303 | 13.4% |
| UserNeed | 17 | 0 | 333 | 4.9% |
| CareInstruction | 161 | 0 | 189 | 46.0% |
| Inspiration | 94 | 0 | 256 | 26.9% |
| Material | 57 | 17 | 276 | 16.3% |
| CraftTechnique | 50 | 0 | 300 | 14.3% |
| CompatibilitySpec | 34 | 0 | 316 | 9.7% |

## Family distribution

| Core family | Products | SKUs | Scent | Function | Scene | Care | Inspiration | Material | Craft |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 个人香氛 | 70 | 82 | 38 | 7 | 4 | 0 | 41 | 0 | 1 |
| 家居香氛 | 168 | 171 | 72 | 134 | 38 | 108 | 36 | 0 | 10 |
| 文创 | 9 | 9 | 0 | 0 | 0 | 0 | 0 | 9 | 0 |
| 艺术家居 | 65 | 69 | 0 | 2 | 3 | 52 | 11 | 48 | 38 |
| 身体护理 | 38 | 39 | 14 | 11 | 2 | 1 | 6 | 0 | 1 |

## Manual-review queue

| Flag | ProductConcepts | Why it matters |
| --- | ---: | --- |
| `usage_text_requires_instruction_review` | 91 | Usage copy exists but the v1 care vocabulary did not classify it; review as UsageInstruction or a new CareInstruction term. |
| `long_description_semantics_untyped` | 82 | Long official copy remains available for RAG but has no typed v1 semantic match. |
| `scent_identity_name_only` | 42 | The scent identity currently depends only on a name-based cleaning rule and needs corroboration. |
| `formula_present_without_note_evidence` | 22 | Formula ingredients must not be promoted to olfactory notes. |

## Interpretation

- Scent, note, and profile coverage comes from the existing typed cleaning output and retained official fields; this audit does not merge aliases or infer scent families.
- Function candidates derived only from ProductForm are deliberately not approved facts.
- Scene and user-need coverage is expected to be sparse because v1 requires explicit official wording.
- `story_text` is counted as direct Inspiration coverage, while descriptive prose outside that field remains untyped until sentence-level review.
- Material is direct only when an official physical field explicitly labels a material. Existing name/subtitle material mappings remain candidates.
- Compatibility counts reuse the separately reviewed compatibility input; no new compatibility is inferred here.

## Next gate

Review the flagged rows and sentence excerpts by priority: concept-layer leaks first, name-only scent identities second, then unmapped usage and long-description text. Only reviewed assertions should enter the v1 migration fixture.

Machine-readable detail is generated at `data-pipeline/diptyque_ontology_schema_v1_coverage.csv`; aggregate counts are at `data-pipeline/diptyque_ontology_schema_v1_summary.json`.
