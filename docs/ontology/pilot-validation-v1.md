# Diptyque Ontology Schema v1 pilot validation

## Result

The pilot passes the v1 structural and semantic invariants. It is suitable for schema review, but it does not authorize full-catalog migration.

Fixture totals:

- 53 entities
- 53 assertions
- 23 evidence records
- 6 ProductConcept entities, including two supporting products for SKU and scent-reuse validation
- 7 SKU entities
- 3 ScentIdentity entities
- 8 NoteIngredient entities
- 2 ScentProfile entities
- 0 persisted recommendation assertions

## Case decision

The requested `影中之水香氛蜡烛` is not present in the 370-row source snapshot. The pilot substitutes `中号香氛蜡烛-浆果香`, which is an actual HomeScent product. No nonexistent product is created.

`杜桑淡香水` is included as supporting context for the `杜桑香氛润肤乳` case. Its 50ML and 100ML rows share SPU `EDTDOSON`, proving that one ProductConcept can contain multiple SKU entities. It is not counted as a fifth primary case.

## Positive checks

| Check | Result | Evidence |
| --- | --- | --- |
| ProductConcept and SKU are separate | Pass | `杜桑淡香水` has SKU `DOSON50V2` and `DOSON100V2` |
| Scent identity is reusable | Pass | `杜桑香氛润肤乳` and `杜桑淡香水` both use `scent:do_son` |
| SignatureFragrance and HomeScent are distinct | Pass | 杜桑/奥费恩 are SignatureFragrance; 浆果香 is HomeScent |
| Notes live on ScentIdentity | Pass | 杜桑 and 奥费恩 notes are not duplicated on products |
| Note and profile are separated | Pass | `果香调` and `叶片的绿意芬芳` become profiles; blackcurrant berry and rose remain notes |
| Inspiration is source-backed | Pass | 越南海湾 and 奥费恩俱乐部 cite official descriptions |
| Care is source-backed | Pass | Candle burn/trim/center/safety and lid cleaning have usage evidence |
| Refill is exact and directed | Pass | `RSOLIDEORPH REFILL_FOR SOLIDEORPH` at SKU level |
| Accessory compatibility uses a specification | Pass | Lid points to `CompatibilitySpec: 300g蜡烛` rather than an arbitrary candle |
| Approved non-catalog facts have evidence | Pass | Every approved fact/compatibility assertion has at least one evidence ID |
| Assertion references are valid | Pass | All subject, object, evidence, and supporting assertion IDs resolve |
| `objectId` and `objectValue` are exclusive | Pass | Validated for all 53 assertions |

## Negative checks

| Prohibited behavior | Result |
| --- | --- |
| Bind 水墨画陶瓷烛盖 M to a ScentIdentity | Absent, pass |
| Convert `叶片的绿意芬芳` into a specific leaf ingredient | Absent; modeled as `ScentProfile: 青绿` |
| Create PAIRS_WITH from shared scent identity | Absent, pass |
| Create SCENT_RITUAL_WITH between 杜桑润肤乳 and 杜桑淡香水 | Absent; no explicit recommendation evidence |
| Persist SHARES_SCENT_IDENTITY | Absent; query-time only |
| Treat 奥费恩固体香膏 as a refill | Absent; only the actual refill SKU uses REFILL_FOR |
| Create `沐浴后` scene for 杜桑润肤乳 | Absent; source copy does not say this |
| Create a material from an olfactory wood note | Absent, pass |
| Use formula `ingredients_text` as fragrance notes | Absent, pass |
| Link the lid to an arbitrary scent or product by name | Absent; exact 300g compatibility only |

## Curated recommendation gate

The pilot intentionally contains zero recommendation assertions. The schema gate is defined but not exercised because the four source cases do not contain a safe official or human-reviewed recommendation example.

Before a future curated relation can be approved, it must have:

1. At least two approved supporting fact assertions.
2. A concrete scenario explaining why the products relate.
3. A generation method that is not `official_source`.
4. A named human reviewer.
5. `reviewStatus=approved` and a decision reason.
6. UI wording that identifies it as a curated suggestion rather than an official recommendation.

## Open issues before full migration

1. All 23 evidence items have `retrievedAt=null` because the CSV snapshot does not record the original crawl timestamp. The dataset hash is preserved, but a real refresh pipeline must add retrieval time.
2. Pilot vocabulary concepts remain `draft`; the full raw-field audit must produce counts, aliases, residual terms, and review decisions before promotion.
3. Scent identity aliases require a reviewed bilingual dictionary. Product-name substring matching is not sufficient.
4. ProductSet and gift-set cardinality are specified but not exercised by these four cases.
5. Official layering is specified but not exercised because no layering evidence was found in the pilot source rows.
6. Operational price and stock data remain outside the stable ontology and need a separate Offer model if required later.
7. Full migration needs a regression audit for compound scent names, material leakage, formula ingredients, and name-only relation evidence.

## Gate decision

`Ontology Schema v1 pilot: PASS WITH OPEN PROVENANCE AND VOCABULARY WORK.`

The next authorized step is a read-only full-source coverage audit against this schema. It should measure evidence availability and residual vocabulary without publishing new graph edges or changing the frontend.
