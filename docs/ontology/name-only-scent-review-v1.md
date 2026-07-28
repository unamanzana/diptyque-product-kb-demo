# 名称型 ScentIdentity 候选审核 v1

## 结论

本轮审核 42 个仅由名称清洗产生的香气候选：38 个有独立官方字段佐证，可进入待迁移的 approved 清单；4 个证据不足，继续保留为 pending_review。没有候选被自动写入图谱或前端。

审核时不把商品名、URL slug、通用 meta 列表重复计算为独立证据。`fragrance`、正文、故事或使用说明必须明确出现候选香气，才允许 approved。

## 证据分布

| Evidence field | Products |
| --- | ---: |
| `fragrance` | 20 |
| `pdp_short_description` | 11 |
| `pdp_long_description` | 5 |
| `description_text` | 2 |
| `meta_description` | 2 |
| `product_name` | 2 |

## 仍待确认

| ProductConcept | Candidate | Type | Evidence | Reason |
| --- | --- | --- | --- | --- |
| 橙花 - 电子扩香器香氛补充包 | 橙花 | HomeScent | `meta_description` | Only weak title, subtitle, or metadata evidence is available; it cannot independently publish HAS_SCENT. |
| 炭木香烛台香氛蜡烛 | 炭木香 | HomeScent | `product_name` | No independent source field corroborates the name-derived scent identity. |
| 超大号香氛蜡烛-玫瑰 | 玫瑰 | HomeScent | `product_name` | No independent source field corroborates the name-derived scent identity. |
| 感官之水淡香水（限量版） | 感官之水 | SignatureFragrance | `meta_description` | Only weak title, subtitle, or metadata evidence is available; it cannot independently publish HAS_SCENT. |

## 同名跨类型身份

以下标签同时出现在 SignatureFragrance 与 HomeScent 中。它们必须使用不同的类型化 ID，不能按显示名称合并：

- `玫瑰`: HomeScent, SignatureFragrance

## 规范化决定

- `橙花香调淡香水` 的 SignatureFragrance 规范名保留为 `橙花香调`，避免与 HomeScent `橙花` 合并。
- 4 款商品名保留“希腊无花果”的 `figuier` 家居产品统一规范到 HomeScent `无花果`；`希腊无花果`只作为 `philosykos` 的 SignatureFragrance 身份。
- 同名 SignatureFragrance 与 HomeScent 通过类型化 ID 区分，例如 `玫瑰` 不因显示名相同而成为同一个实体。
- approved 表示证据审核通过，但本轮仍不发布 `HAS_SCENT`；发布必须进入后续迁移步骤并通过结构校验。

## 下一步

把 approved 清单转换为带 assertion/evidence envelope 的迁移输入；pending_review 继续隔离。迁移前需验证每个标准 ProductConcept 最多绑定一个 ScentIdentity，并确认同名跨类型实体不会被 ID 归一逻辑合并。
