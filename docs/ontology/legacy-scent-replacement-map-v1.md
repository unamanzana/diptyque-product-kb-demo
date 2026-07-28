# 旧香气图谱到 Schema v1 替换映射

## 结果

映射结果：**PASS**。已覆盖 116 个旧 CollectionOrScent/ScentConcept 节点和 1428 条相关语义边；本轮只生成替换计划，没有修改旧图谱或前端。

## 玫瑰别名裁决

SignatureFragrance `玫瑰` 已归并为 `玫瑰香调`的类型内别名。依据是官方洁肤露文案直接写明“玫瑰香调洁肤露”，且香材组合与玫瑰香调系列一致。HomeScent `玫瑰`保持独立，别名解析必须带实体类型。

## 节点替换

| Action | Nodes |
| --- | ---: |
| `replace_with_note_ingredient` | 76 |
| `replace_with_scent_identity` | 21 |
| `quarantine_untyped_scent_concept` | 10 |
| `split_by_relation_context` | 6 |
| `split_by_product_family` | 2 |
| `retire_to_collection_review` | 1 |

- 纯香材 ScentConcept 替换为 NoteIngredient。
- 同时承担香气身份和香材含义的节点按关系上下文拆分。
- `大千之蕴`退回集合/系列审核，不进入 ScentIdentity。
- 仍无法定型的 10 个 ScentConcept 保持隔离，不猜测为香材或调性。

## 边替换

| Action | Edges |
| --- | ---: |
| `retire_direct_semantic_product_edge` | 895 |
| `replace_and_reverse` | 155 |
| `retire_legacy_pivot_edge` | 129 |
| `retain_navigation_only` | 126 |
| `retire_legacy_family_pivot` | 112 |
| `retire_collection_umbrella_edge` | 7 |
| `quarantine_pending_identity` | 4 |

CollectionOrScent -> Product 的 166 条旧边已经完整对账：

- 155 条替换并反向为 ProductConcept -> HAS_SCENT -> ScentIdentity。
- 4 条继续隔离为 pending_review。
- 7 条因大千之蕴是集合而退役。
- 0 条未匹配。

旧 NoteIngredient/ScentConcept/ScentProfile/ScentAccord 直接连商品的边不会照搬。Schema v1 后续应从官方证据建立 ScentIdentity -> NoteIngredient/ScentProfile/ScentAccord，再通过香气身份查询商品。

## 切换顺序

1. 在隔离环境加载最终 155 条 HAS_SCENT 和 24 个 ScentIdentity。
2. 按节点映射拆分或退役旧 CollectionOrScent/ScentConcept。
3. 删除旧语义到商品的直连边之前，先生成查询结果对比快照。
4. 单独迁移 HAS_NOTE、HAS_PROFILE、HAS_ACCORD；不从旧 ScentConcept -> Product 反推。
5. 最后切换前端查询与可视化，推荐关系保持独立。

## 同名层级保护

已从 CollectionOrScent 映射中移除 6 个同名 NoteIngredient 目标。Collection 节点现在只能替换为类型化 ScentIdentity；香材目标仅保留在 ScentConcept 的上下文拆分中。
