# Schema v1 香气查询新旧回归门禁

## 结果

结果：**PASS**。已比较 23 个 ScentIdentity 和 22 个用户查询词；新数据的 155 条商品香气事实与旧图谱中已批准替换的 155 条完全一致，非预期回归为 0。

预期差异只有 4 个 pending 商品和 7 个大千之蕴集合商品。它们不会被误报为数据丢失。

## 待确认商品

| ScentIdentity | Type | New count | Pending excluded | Product |
| --- | --- | ---: | ---: | --- |
| 橙花 | HomeScent | 8 | 1 | 橙花 - 电子扩香器香氛补充包 |
| 炭木香 | HomeScent | 5 | 1 | 炭木香烛台香氛蜡烛 |
| 玫瑰 | HomeScent | 11 | 1 | 超大号香氛蜡烛-玫瑰 |
| 感官之水 | SignatureFragrance | 5 | 1 | 感官之水淡香水（限量版） |

## 需要分组展示的查询词

- `圣日尔曼大道34号`：HomeScent 圣日尔曼大道34号=11款；SignatureFragrance 圣日尔曼大道34号=3款；总计 14 款。
- `玫瑰`：HomeScent 玫瑰=11款；SignatureFragrance 玫瑰香调=9款；总计 20 款。

`玫瑰`必须按 HomeScent 与 SignatureFragrance/玫瑰香调分组展示；不能重新合并成一个节点。`圣日尔曼大道34号`也采用相同的类型分组规则。`希腊无花果`只解析为 Philosykos 的 SignatureFragrance；Figuier 家居商品统一通过 `无花果`查询。

## 切换门禁

- 所有 23 个身份的 approved 商品集合必须与替换表完全一致。
- 4 个 pending 和 7 个集合商品必须继续出现在预期差异清单中。
- 不允许出现非预期新增或删除商品。
- 前端对 typed_groups 查询必须展示分组，不得只返回其中一个身份。
- 商品卡片和图谱应使用同一组 ProductConcept ID，避免左右结果不一致。

通过本门禁后，下一阶段才可以生成 Schema v1 前端候选快照；仍不能直接覆盖当前生产快照。
