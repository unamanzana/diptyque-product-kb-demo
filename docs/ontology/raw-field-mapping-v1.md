# Diptyque raw-field mapping v1

## Source preflight

- Source: `C:\Users\potato\Desktop\diptyque-project-workspace\diptyque_products.csv`
- Rows: 370
- SHA-256: `C6FE953F463933EDADAEE16C84D8FB65D156570CAEAE116C792003D8256EC365`
- The workspace source and `data-pipeline/diptyque_products.csv` are byte-identical.

The raw export has 55 fields. Mapping is assertion-based: a raw value is preserved as evidence, while the normalized object is stored separately.

## Mapping table

| Raw field | Target | Rule | Derivation allowed | Evidence policy |
| --- | --- | --- | --- | --- |
| `spu` | `ProductConcept.id` | Stable ID seed; combine with normalized identity only when SPU is reused incorrectly | No semantic inference | Preserve raw SPU |
| `name` | `ProductConcept.name` | Official display name; remove formatting differences only | Normalization only | Product page/name |
| `identity_name` | Alias or identity candidate | Never assume it is a scent; inspect category and form | Candidate only | Preserve raw value |
| `sku` | `SKU.id`, `skuCode` | One SKU entity per non-empty code | No | Product page/export |
| `sizes` | SKU specification or `CompatibilitySpec` | Product size belongs to SKU; phrases such as `搭配300g蜡烛` are compatibility evidence | Typed parsing | Exact raw phrase |
| `type` | `type_raw` evidence | Never use as the ontology root; many rows are blank | Candidate classification only | Raw export |
| `category_names` | `CoreFamily`, `ProductForm`, scent candidate, marketing tag | Token dictionary with typed residual review | Approved dictionary mapping | Exact category path |
| `fragrance` | `HAS_SCENT` candidate | Accept only when product form and official identity agree | Candidate until entity resolution | Raw field plus category/name corroboration |
| `subtitle` | `HAS_NOTE` or `HAS_PROFILE` | Separate note/profile dictionaries; generic profiles never become notes | Typed tokenization | Exact subtitle |
| `pdp_short_description` | Notes, profile, function, inspiration candidate | Extract only explicit statements | Candidate, then review | Exact excerpt |
| `pdp_long_description` | Inspiration, material, craft, function candidate | Preserve narrative context | Candidate, then review | Exact excerpt |
| `description_text` | Same as product descriptions | Use when populated; do not outrank a more specific field | Candidate | Exact excerpt |
| `usage_tips_text` | `CareInstruction`, `UsageInstruction`, compatibility, refill evidence | Split instructions without changing quantities | Yes, source-backed | Exact instruction excerpt |
| `ingredients_text` | Formula text or future `FormulaIngredient` | Never map directly to `NoteIngredient` | No scent inference | Preserve for RAG only in v1 |
| `formule_text` | Texture, application, or function candidate | Do not infer user need from poetic language | Candidate | Exact excerpt |
| `story_text` | `Inspiration` | Official story only | Structured extraction | Exact excerpt |
| `savoir_faire_text` | `CraftTechnique` or craft inspiration | Requires explicit physical craft context | Structured extraction | Exact excerpt |
| `caracteristics_text` | Specification, scene, care, material, compatibility | Parse quantities and labeled facts | Yes, source-backed | Exact labeled statement |
| `detail_json` | Structured fallback | Parse as JSON; never string-search structured data | Field-specific | Preserve source path |
| `url` | Evidence URL | Canonical official product URL | No | Required when present |
| `detail_source` | Evidence source type | `product_page` maps to official product page | No | Required |
| `price`, `market_price`, `stock`, `status` | Operational offer data | Outside Ontology Schema v1; keep separate from stable product identity | No | Do not embed in ontology facts |
| `meta_*`, `plp_description` | Search/display fallback | Lower evidence priority than PDP and usage fields | Candidate only | Record exact field |

## Source priority

1. Explicit official usage, characteristics, story, and PDP statements.
2. Official category, fragrance, name, size, and SKU fields.
3. Cleaned dictionary mapping with retained raw evidence.
4. Model extraction as a `candidate` only.

Name substring matching never overrides a contradictory category, form, or explicit description.

## Pilot case selection

| Requested case | Source result | v1 decision |
| --- | --- | --- |
| 杜桑香氛润肤乳 | Present, SKU `DOSBLOT` | Use as SignatureFragrance/body-care case |
| 影中之水香氛蜡烛 | No matching source row | Do not fabricate; replace with 中号香氛蜡烛-浆果香 |
| 奥费恩固体香膏 | Present, SKU `SOLIDEORPH` | Use with real refill SKU `RSOLIDEORPH` |
| Non-scent product | 水墨画陶瓷烛盖 M is present | Use as material/craft/care/compatibility case |

The replacement candle covers `HomeScent`, official scent profile, room suitability, candle care, material, and craft. It is a stronger schema test than inventing a nonexistent product.

## Pilot source findings

### 杜桑香氛润肤乳

- `HAS_SCENT -> 杜桑` is supported by the official fragrance/category/name context.
- The official short description identifies 晚香玉 as the lead expression and 茉莉、橙花 as accompanying notes.
- The official long description supports an inspiration record for a summer Vietnamese bay.
- No source text explicitly states `沐浴后`, so no `HAS_SCENE` assertion is created.
- Sharing 杜桑 with a perfume does not create `PAIRS_WITH` or `SCENT_RITUAL_WITH`.

### 中号香氛蜡烛-浆果香

- `HomeScent -> 浆果香` is supported by official name/category context.
- `果香调` is a profile, not a note.
- Official text supports blackcurrant berry, leafy green scent, and rose notes without forcing unsupported primary/secondary roles.
- Official characteristics support medium/large room use and 300g/75-hour specifications.
- Official usage supports first burn, wick trimming, wick centering, and unattended-burning warnings.

### 奥费恩固体香膏

- `HAS_SCENT -> 奥费恩` is supported by name/category context.
- Official copy supports the Orpheon club inspiration and note assertions.
- Applying to neck, behind ears, and wrists is a `UsageInstruction`, not a `UseScene`.
- `奥费恩香膏补充装` is a separate ProductConcept/SKU.
- `RSOLIDEORPH REFILL_FOR SOLIDEORPH` is supported by both product usage pages.

### 水墨画陶瓷烛盖 M

- It belongs to art/home decor and has no `HAS_SCENT` assertion.
- Official copy supports ceramic/mixed-clay material and the NG Porcelanas craft record.
- Official usage supports cleaning with soap solution and a soft cloth.
- `搭配：300g蜡烛` creates `ACCESSORY_FOR_SPEC -> candle_300g`, not a scent or arbitrary product pairing.

## Residual audit rules before full migration

- Review all untyped category tokens rather than silently dropping them.
- Review every compound scent identity before alias merging.
- Review all material candidates outside art/home decor and physical accessories.
- Report every relation whose evidence is only a name substring.
- Keep `official_recommendation`, `curated_recommendation`, and `candidate` counts separate.
