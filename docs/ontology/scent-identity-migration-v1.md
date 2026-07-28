# ScentIdentity 名称候选迁移包 v1

## 结果

迁移包校验结果：**PASS**。本包包含 38 条已审核 `HAS_SCENT` 事实，4 条 pending_review 被明确排除。当前状态为 `ready_for_import_not_published`，尚未写入现有图谱或前端。

## 包内容

| Object | Count |
| --- | ---: |
| ProductConcept | 38 |
| ScentIdentity | 15 |
| HAS_SCENT assertion | 38 |
| Evidence | 38 |
| Excluded pending | 4 |

## 结构约束

- 每个 ProductConcept 最多绑定 1 个 ScentIdentity。
- 推荐关系数量为 0，本包只迁移事实层。
- 每条 approved assertion 都有独立 Evidence，且 subject、object、evidence 引用均可解析。
- ProductConcept ID 优先使用全表唯一 SPU；复用 SPU 才追加概念键哈希消歧。
- 同名 SignatureFragrance 与 HomeScent 使用不同的类型化 ID，不按显示名合并。

## 同名跨类型检查

- `玫瑰`: HomeScent=scent:home:7e29b8c11693; SignatureFragrance=scent:signature:7280ec9e7052

## Provenance 限制

原始 CSV 没有抓取时间，因此 38 条 Evidence 的 `retrievedAt` 仍为空；每条 Evidence 已保存官方 URL、字段、原文片段和原始 CSV 快照 SHA-256。

## 发布边界

本文件是迁移输入，不是前端图谱快照。下一阶段应先在隔离的 Schema v1 数据集中导入并运行全局身份冲突审计；通过后再决定是否替换当前 `ScentConcept` 关系。禁止直接把本包叠加到旧的香气边上，否则会产生重复关系。

## Pilot 身份复用

- `杜桑`复用 `scent:do_son`。
- `奥费恩`复用 `scent:orpheon`。
- HomeScent `浆果香`复用 `scent:baies`。
- 其余新身份保留类型化哈希 ID。
