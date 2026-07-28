# Diptyque Ontology Schema v1 全量审计结论

## 审计范围

- 原始数据：370 行
- ProductConcept：350 个
- SKU：370 个
- 审计方式：只读，不发布事实、不新增图谱边、不修改前端数据

本次不是统计“有多少字段不为空”，而是检查每类信息能否进入对应的本体层，以及是否存在概念串层。

## 主要结论

### 1. 当前没有发现非香气商品误绑香气

`艺术家居` 和 `文创` 中，误带 `ScentIdentity` 的 ProductConcept 数量为 0。陶瓷托盘、烛盖、花瓶等商品不会因为名称中出现玫瑰、无花果等词而绑定到同名香气。

### 2. 当前没有发现嗅觉词误当实体材质

个人香氛、家居香氛和身体护理中，超出实体商品边界的材质候选数量为 0。`愈创木`、`檀香木`等香材不会再生成 `Material=木质材质`。

### 3. 42 个香气身份仍然只有名称依据

124 个 ProductConcept 有多字段支持的香气身份，另有 42 个仅由商品名称或名称覆盖规则识别出的香气候选。这 42 个暂时保持 `candidate`，不能自动发布为 `HAS_SCENT`。

其中包含真实但缺少结构字段佐证的商品，例如部分杜桑、奥费恩身体护理，以及部分家居香氛补充包。下一步应逐条回看官方分类、描述和香气页，而不是删除或直接批准。

### 4. 保养说明和商品功能必须分开

97 个蜡烛商品的“修剪烛芯、首次燃烧、控制时长”等说明曾同时命中 `CareInstruction` 和 `Function=蜡烛养护`。本次审计已把后者降回品型候选：

- 普通蜡烛：保留 `CareInstruction`，功能只保留 `扩香` 候选。
- 烛盖、烛罩等配件：有明确文案时，才允许 `Function=蜡烛养护`。

### 5. 原始 CSV 存在一条明确的跨商品字段污染

`三重水淡香水` 的 `savoir_faire_text` 与 10 个“大千之境”蜡烛/补充装的压制玻璃烛杯工艺文案相同。该内容与淡香水商品不相符，不能生成 `HAS_CRAFT`。

- 受影响 ProductConcept：`EDTTROIS100V1::三重水淡香水`
- 来源页：`https://www.diptyque-cn.com/p/edt-trois-fl-101.html`
- 处理：保持 `candidate` 并标记 `cross_family_duplicate_craft_copy`
- 大千之境商品：文案与玻璃烛杯实体一致，可作为工艺事实继续复核

### 6. 配方成分不能补成香材

22 个 ProductConcept 有 `ingredients_text`，但没有正式的 `note_tokens` 证据。这些配方内容继续留给 RAG，不得因为出现植物或化学名称就生成 `NoteIngredient`。

### 7. 大量官方文案仍未完成类型化

- 91 个 ProductConcept 有使用说明，但尚未匹配现有 CareInstruction 词表。它们更可能是 `UsageInstruction`，或需要新增受控保养词。
- 82 个 ProductConcept 有长描述，但没有进入现有 Function、Scene、UserNeed、Material、Craft 或 Inspiration 类型。文案仍可用于 RAG，不能在没有句级证据审核时自动建边。

## 覆盖结果

| 维度 | Direct | Candidate | None |
| --- | ---: | ---: | ---: |
| ScentIdentity | 124 | 42 | 184 |
| NoteIngredient | 97 | 0 | 253 |
| ScentProfile | 145 | 0 | 205 |
| Function | 72 | 259 | 19 |
| UseScene | 47 | 0 | 303 |
| UserNeed | 18 | 0 | 332 |
| CareInstruction | 161 | 0 | 189 |
| Inspiration | 94 | 0 | 256 |
| Material | 57 | 17 | 276 |
| CraftTechnique | 48 | 2 | 300 |
| CompatibilitySpec | 34 | 0 | 316 |

`None` 表示当前 Schema v1 没找到足够证据，不代表该事实一定不存在。场景和用户需求覆盖率低是严格证据政策的正常结果，不应该用常识强行补满。

## 下一步处理顺序

1. P0：修正或隔离 `三重水淡香水` 的串行工艺字段，并核对是否还有跨家族的重复语义字段。
2. P0：逐条复核 42 个仅名称支持的香气身份，建立有证据的 ScentIdentity 映射。
3. P1：把 91 个未分类使用说明拆成 UsageInstruction、CareInstruction 和 CompatibilitySpec。
4. P1：审核 17 个材质候选与 2 个工艺候选，禁止从名称直接发布事实。
5. P2：对 82 个未类型化长描述做句级候选提取，模型只生成 candidate，人工审核后才能发布。

本轮完成后再开始 v1 全量迁移，比直接生成大量商品关系更稳。图谱应该先得到可信的事实层，再在事实层上生成可解释的推荐关系。
