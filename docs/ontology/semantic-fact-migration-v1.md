# Schema v1 共享语义事实迁移

## 边界

本候选集区分官网文案直接支撑的事实关系与已审核 ProductForm 规则推导的功能、需求关系。规则推导只表达商品能力和用户目标，不伪装成官网原文。

## 结果

- ProductConcept：350
- 有共享语义事实的商品：350
- 事实断言：1386
- 校验：PASS

| Predicate | Assertions |
| --- | ---: |
| `HAS_CARE_INSTRUCTION` | 435 |
| `HAS_FUNCTION` | 410 |
| `HAS_MATERIAL` | 68 |
| `HAS_SCENE` | 47 |
| `SERVES_NEED` | 426 |

## 发布规则

- 直接事实包含官网 URL、来源字段和命中原文片段；规则关系明确标注 `controlled_ontology_rule`。
- 每个 ProductConcept 至少连接一个共享 `UserNeed`，功能与需求使用不同受控词表。
- `Material` 仅允许艺术家居与文创商品进入，避免香材词串入物理材质。
- `Function`、`UseScene`、`UserNeed`、`CareInstruction` 使用共享实体，多个商品连接同一节点。
- 未命中不代表商品没有该属性，只表示当前官方资料不足以发布该事实。
