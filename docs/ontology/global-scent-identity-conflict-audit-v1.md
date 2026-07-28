# Schema v1 全量香气身份隔离导入与冲突审计

## 结果

结果：**PASS_WITH_REVIEW_ITEMS**。隔离数据集包含 155 个 ProductConcept、24 个类型化 ScentIdentity、155 条 HAS_SCENT 和 155 条 Evidence。没有写入旧图谱或前端。

- 117 条来自通过复核的直接结构证据。
- 7 条“大千之蕴”分类记录因系列/集合误作香气而排除。
- 38 条来自已审核名称候选迁移包。
- 4 条 pending_review 继续排除。
- 每个标准 ProductConcept 最多绑定 1 个 ScentIdentity。

## 全局身份检查

- 类型内同名多 ID：0。
- 同名跨 Signature/Home 类型：2 组；保留不同 ID。
- 需要人工裁决的同类型 `香调` 后缀别名：1 组。
- 明确保留为不同身份的复合名称：1 组。

### 同名跨类型

- `玫瑰`: HomeScent=scent:home:7e29b8c11693; SignatureFragrance=scent:signature:7280ec9e7052
- `圣日尔曼大道34号`: HomeScent=scent:home:d1bf12d71e9b; SignatureFragrance=scent:signature:e64ef421b4b7

### 待裁决别名

- SignatureFragrance: `玫瑰` 与 `玫瑰香调`，暂不合并。

### 受保护复合名称

- HomeScent: `玫瑰` 与 `玫瑰天竺葵` 保持不同实体。

## 与旧图谱的结构差异

- 旧图谱有 94 个 ScentConcept 和 22 个 CollectionOrScent；Schema v1 隔离集只有 24 个 ScentIdentity。
- 旧 ScentConcept 中有 82 个名称同时也是 NoteIngredient，说明旧层把香气身份和香材概念混在同一枢纽。
- 旧图谱从 ScentConcept 发出 397 条 HAS_PRODUCT，从 CollectionOrScent 发出 166 条 HAS_PRODUCT。Schema v1 改为 ProductConcept -> ScentIdentity 的单向事实边。
- 因此不能把隔离集直接叠加到旧图谱；应先替换身份层，再让 NoteIngredient 只连接 ScentIdentity。

## 系列/集合误作香气

`大千之蕴`是系列分类，不是一个可供暗影珊瑚、宝石之眼等商品共同绑定的 ScentIdentity。7 条相关 HAS_SCENT 已从隔离集移除，其中体验套装后续应按 ProductSet 建模，其余香水应分别审核自身香气身份。

## 发布前剩余事项

1. 人工裁决同类型 `玫瑰` 与 `玫瑰香调` 是否为同一 SignatureFragrance；在正式别名字典批准前保持分离。
2. `希腊无花果`仅保留为 Philosykos 的 SignatureFragrance；Figuier 家居商品统一绑定 HomeScent `无花果`，并继续保持 `玫瑰/玫瑰天竺葵`等不同身份。
3. 设计旧 CollectionOrScent、ScentConcept、NoteIngredient 到新实体的替换映射，禁止通过名称直接全量合并。
4. 在前端切换前，生成对比快照并检查所有商品香气查询数量。

Provenance 限制：原始快照没有抓取时间，因此 155 条 Evidence 的 `retrievedAt` 为空，但均保留官方 URL、字段、原文和 CSV 快照哈希。
