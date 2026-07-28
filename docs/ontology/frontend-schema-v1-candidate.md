# Schema v1 前端候选快照

## 结果

结果：**PASS**。候选快照保留 350 个商品和全部推荐规则；除香气身份层外，新增 40 个共享语义概念与 642 条带证据事实边。当前生产前端快照未被覆盖。

## 图谱变化

| Metric | Current | Candidate |
| --- | ---: | ---: |
| Graph nodes | 1050 | 1002 |
| Graph edges | 2872 | 2430 |
| Legacy CollectionOrScent + ScentConcept | 116 | 0 |
| ScentIdentity | 0 | 23 |
| HAS_SCENT | 0 | 155 |
| Shared semantic concepts | 0 | 40 |
| Evidence-backed semantic facts | 0 | 642 |

旧 NoteIngredient、ScentProfile、ScentAccord 直接连商品的推断边已从候选快照移除；本阶段不会在缺少官方事实证据时反向补造 ScentIdentity 到这些语义节点的关系。

## 查询验收

- `希腊无花果`：单一 SignatureFragrance，5 款。
- `无花果`：单一 HomeScent，12 款。
- 155 个带香气商品全部映射到现有前端 Product ID；未解析边为 0。

## 发布边界

该文件由 NEXT_PUBLIC_DIPTYQUE_SCHEMA_V1=true 的独立预览读取；默认生产快照仍保持不变。语义事实进入单品和推荐局部子图，但模型推断和未审核长文不会显示为事实边。
