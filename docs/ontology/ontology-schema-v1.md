# Diptyque Ontology Schema v1

## 1. Scope

This schema supports catalog navigation, product knowledge graphs, AI shopping assistance, RAG retrieval, and relationship analysis. It does not authorize full-catalog migration or automatic publication of model-generated recommendations.

The source snapshot is `diptyque_products.csv` (370 rows, SHA-256 `C6FE953F463933EDADAEE16C84D8FB65D156570CAEAE116C792003D8256EC365`). Empty or unsupported facts remain absent.

## 2. Layers

| Layer | Purpose | Publication rule |
| --- | --- | --- |
| `catalog` | `CoreFamily -> ProductForm -> ProductConcept -> SKU` navigation | Source-backed taxonomy mapping |
| `fact` | Scent, note, profile, function, scene, material, craft, care, inspiration | Approved assertion with evidence |
| `factual_compatibility` | Refill and accessory compatibility | Explicit specification or usage evidence |
| `official_recommendation` | Official pairing, ritual, layering, or home extension | Official text explicitly recommends the relation |
| `curated_recommendation` | Reviewed editorial recommendation supported by official facts | At least two approved supporting assertions plus human approval |
| `derived` | Query-time facts such as shared scent identity | Never persisted as an official or curated recommendation |
| `candidate` | Model-generated proposal | Never published to the user-facing graph |

## 3. Entity model

| Entity | Purpose | Required fields | Important constraints |
| --- | --- | --- | --- |
| `CoreFamily` | Top-level catalog navigation | `id`, `name` | Not inferred from `type_raw` alone |
| `ProductForm` | Product form within a family | `id`, `name` | A form may appear under one approved family in v1 |
| `ProductConcept` | Stable product concept independent of size | `id`, `name` | Standard products bind to at most one `ScentIdentity` |
| `ProductSet` | Gift set or bundle | `id`, `name` | Uses `CONTAINS_PRODUCT` or `CONTAINS_SKU`; does not copy child scents by default |
| `SKU` | Sellable specification | `id`, `skuCode` | Belongs to exactly one product concept |
| `ScentIdentity` | Reusable scent identity | `id`, `name`, `scentIdentityType` | Subtypes: `SignatureFragrance`, `HomeScent` |
| `NoteIngredient` | Olfactory note or material | `id`, `name` | Distinct from `ScentProfile` and formula ingredients |
| `ScentProfile` | Official sensory family or impression | `id`, `name`, `vocabularyStatus` | No subjective invention |
| `Inspiration` | Official story, place, or raw-material origin | `id`, `inspirationType`, `description` | Long text remains source-backed and RAG-ready |
| `Function` | Official product function | `id`, `name`, `vocabularyStatus` | Product-form mapping may create a derived candidate, not an approved fact |
| `UseScene` | Official use context | `id`, `name`, `vocabularyStatus` | New official scenes enter vocabulary as `draft` |
| `UserNeed` | Officially supported user need | `id`, `name`, `vocabularyStatus` | Must not be inferred from demographic stereotypes |
| `CareInstruction` | Usage or care instruction | `id`, `instructionType`, `text` | Preserve measurable qualifiers such as duration or length |
| `UsageInstruction` | How to apply or use a product | `id`, `text` | Kept separate from scene and care |
| `Material` | Physical material | `id`, `name` | Only physical-product evidence can create this link |
| `CraftTechnique` | Official craft or production method | `id`, `name` | Must not be inferred from a material name |
| `CompatibilitySpec` | Explicit compatible size or device specification | `id`, `specType`, `value`, `unit` | Used when no single compatible product is named |

Entity IDs are stable, type-prefixed identifiers. Names and aliases may change without changing identity. Same text in different entity types always has different IDs, for example `note:晚香玉` and `scent:晚香玉`.

## 4. Relationship model

| Predicate | Domain -> Range | Cardinality | Direction / symmetry | Layer and evidence |
| --- | --- | --- | --- | --- |
| `HAS_PRODUCT_FORM` | `CoreFamily -> ProductForm` | 1:n | Directed | Catalog mapping |
| `HAS_PRODUCT` | `ProductForm -> ProductConcept` | 1:n | Directed | Catalog mapping |
| `HAS_SKU` | `ProductConcept -> SKU` | 1:n | Directed; store once | Catalog fact |
| `CONTAINS_PRODUCT` | `ProductSet -> ProductConcept` | 1:n | Directed | Explicit set contents |
| `CONTAINS_SKU` | `ProductSet -> SKU` | 1:n | Directed | Explicit set contents |
| `HAS_SCENT` | `ProductConcept -> ScentIdentity` | standard 0:1 | Directed | Official name, category, fragrance field, or copy |
| `HAS_NOTE` | `ScentIdentity -> NoteIngredient` | 0:n | Directed | Qualifier `primary`, `secondary`, or `unspecified` |
| `HAS_PROFILE` | `ScentIdentity -> ScentProfile` | 0:n | Directed | Official scent copy only |
| `HAS_INSPIRATION` | `ScentIdentity -> Inspiration` | 0:n | Directed | Official story only |
| `HAS_FUNCTION` | `ProductConcept -> Function` | 0:n | Directed | Official name or copy |
| `HAS_SCENE` | `ProductConcept -> UseScene` | 0:n | Directed | Explicit official context |
| `SERVES_NEED` | `ProductConcept -> UserNeed` | 0:n | Directed | Explicit official claim |
| `HAS_CARE_INSTRUCTION` | `ProductConcept -> CareInstruction` | 0:n | Directed | Official usage guide |
| `HAS_USAGE_INSTRUCTION` | `ProductConcept -> UsageInstruction` | 0:n | Directed | Official usage guide |
| `HAS_MATERIAL` | `ProductConcept -> Material` | 0:n | Directed | Physical material evidence |
| `HAS_CRAFT` | `ProductConcept -> CraftTechnique` | 0:n | Directed | Official craft evidence |
| `HAS_COMPATIBILITY_SPEC` | `ProductConcept -> CompatibilitySpec` | 0:n | Directed | Explicit specification |
| `ACCESSORY_FOR_SPEC` | `ProductConcept -> CompatibilitySpec` | 0:n | Directed | Explicit accessory compatibility |
| `ACCESSORY_FOR` | `ProductConcept -> ProductConcept` | 0:n | Directed | Explicit compatible product |
| `REFILL_FOR` | `SKU -> SKU` | 0:n | Directed | Exact refill target; product-level only if size-independent |
| `PAIRS_WITH` | `ProductConcept -> ProductConcept` | 0:n | Store one canonical direction; query as symmetric | Official or curated recommendation |
| `SCENT_RITUAL_WITH` | `ProductConcept -> ProductConcept` | 0:n | Store one canonical direction; query as symmetric | Official or curated ritual evidence |
| `EXTENDS_TO_HOME` | `ProductConcept -> ProductConcept` | 0:n | Personal to home, directed | Official or curated recommendation |
| `LAYER_WITH` | `ScentIdentity -> ScentIdentity` | 0:n | Symmetric unless `applicationOrder` is stated | Official layering only |

`SHARES_SCENT_IDENTITY` is derived by traversing two `HAS_SCENT` assertions. It is not stored and never means `PAIRS_WITH`.

## 5. Assertion and evidence envelope

```json
{
  "entities": [],
  "assertions": [
    {
      "id": "assertion:...",
      "subjectId": "product:...",
      "predicate": "HAS_SCENT",
      "objectId": "scent:...",
      "objectValue": null,
      "qualifiers": {},
      "relationLayer": "fact",
      "evidenceIds": ["evidence:..."],
      "supportingAssertionIds": [],
      "generationMethod": "source_mapping",
      "confidence": 1.0,
      "reviewStatus": "approved",
      "reviewer": "source_audit",
      "decisionReason": "Official field or copy directly supports the assertion"
    }
  ],
  "evidence": []
}
```

`objectId` and `objectValue` are mutually exclusive. Structured concepts use `objectId`; literal official values use `objectValue`. Every approved non-catalog assertion has at least one evidence item. Evidence stores `sourceType`, `pageName`, `url`, `sourceField`, `excerpt`, `sourceHash`, `retrievedAt`, `validFrom`, and `validTo`.

## 6. Vocabulary governance

Controlled concepts use `draft -> approved -> deprecated`. Each vocabulary record has `canonicalName`, `aliases`, `definition`, `parentConcept`, `sourceEvidenceIds`, and `reviewStatus`. An official but previously unseen term enters as `draft`; it is not discarded because it falls outside an initial enumeration.

Initial families are provisional, not exhaustive:

- `ScentProfile`: floral, woody, green, powdery, milky, citrus, watery, fruity.
- `Function`: cleanse, moisturize, scent, diffuse, decorate, candle care, portable scenting.
- `UseScene`: after bath, travel, car, table, medium or large room, and other official contexts.
- `UserNeed`: relaxation, ambience, space freshness, gifting, portability, only when official copy supports the claim.
- `CareInstruction`: first burn, trim wick, center wick, avoid sunlight, burn duration, cleaning method, and other official instructions.

## 7. Identity and inference rules

- Raw category and form evidence outrank name substrings.
- `玫瑰天竺葵` does not normalize to `玫瑰` without an approved alias assertion.
- `无花果`, `无花果叶`, and `无花果汁` remain distinct until evidence proves equivalence.
- Scent-named trays, lids, and decorations do not bind to a scent identity from their names.
- `subtitle` tokens are typed through separate note and profile dictionaries. A generic profile is never emitted as a note.
- `ingredients_text` describes formula composition and never creates `NoteIngredient` assertions by itself.
- Material extraction runs only for physical product families and physical descriptions. Olfactory words such as `愈创木` never create material assertions.
- Model output may create `candidate` assertions only.
- A `curated_recommendation` requires at least two approved supporting assertions, an explicit scenario, a human reviewer, and an approval reason.

## 8. Presentation contract

The ontology is independent from graph rendering. The UI uses three lenses:

- Catalog exploration: family, form, aggregate product count; no recommendation edges.
- Product understanding: one product plus 10-14 selected semantic neighbors.
- Pairing composition: 2-5 products plus approved official or curated relationship paths.

The product view shows only focus-incident edges by default. Same-label entities display their role, such as `晚香玉（香材）` and `晚香玉（香气）`. Facts use solid lines, recommendations use dashed lines, and candidate relations are never shown.

## 9. Pilot gate

No full-catalog migration begins until the four-case fixture passes all positive and negative invariants in `pilot-validation-v1.md`.
