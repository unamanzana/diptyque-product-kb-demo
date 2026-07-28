# Schema v1 共享语义事实迁移

## 边界

本候选集只发布官网字段可直接支撑、且已经进入受控词表的共享语义事实。产品形态推导功能、未归一工艺长文和模型推荐均不会进入已审核事实层。

## 结果

- ProductConcept：350
- 有共享语义事实的商品：234
- 事实断言：642
- 校验：PASS

| Predicate | Assertions |
| --- | ---: |
| `HAS_CARE_INSTRUCTION` | 435 |
| `HAS_FUNCTION` | 73 |
| `HAS_MATERIAL` | 68 |
| `HAS_SCENE` | 47 |
| `SERVES_NEED` | 19 |

## 发布规则

- 每条断言包含官网 URL、来源字段和命中原文片段。
- `Material` 仅允许艺术家居与文创商品进入，避免香材词串入物理材质。
- `Function`、`UseScene`、`UserNeed`、`CareInstruction` 使用共享实体，多个商品连接同一节点。
- 未命中不代表商品没有该属性，只表示当前官方资料不足以发布该事实。
