# Diptyque 分类清洗设计

## 原则

- 保留原始字段 `category_names_raw`，不要覆盖。
- `探索全部` 删除。
- `人气精选`、`当季精选`、`臻选礼赠` 保留，但它们是标签，不是核心品类。
- 不要把所有分类词硬塞进一条树里，要拆成并行维度。

## 建议列设计

产品主表建议至少有这些列：

```text
product_name
spu
sku
type_raw
category_names_raw
core_family
product_form
collection_or_scent
material_or_craft
marketing_tags
variant_tags
```

## 每列含义

- `type_raw`
  爬虫抓到的原始 `type`，只做参考，不做最终分类依据。

- `category_names_raw`
  原始分类组合，例如：
  `个人香氛 | 人气精选 | 奥费恩 | 探索全部 | 淡香精`

- `core_family`
  核心大类。
  例如：`个人香氛`、`家居香氛`、`身体护理`、`艺术家居`

- `product_form`
  具体小类或商品形态。
  例如：`淡香水`、`淡香精`、`香氛蜡烛`、`扩香精`、`发香喷雾`、`香膏`、`烛罩`、`托盘`、`花瓶`

- `collection_or_scent`
  系列名、香型名、香调主题。
  例如：`奥费恩`、`杜桑`、`无花果`、`浆果香`、`玫瑰香调`

- `material_or_craft`
  材质、工艺、器型特征。
  例如：`玻璃`、`陶瓷`、`木质`、`金属`

- `marketing_tags`
  运营标签，允许多值。
  例如：`人气精选|当季精选|臻选礼赠`

- `variant_tags`
  版本或销售形态标签，允许多值。
  例如：`补充装|限量版`

## 不建议做成单树的原因

下面这些东西不是一个维度：

- `个人香氛`
- `淡香精`
- `奥费恩`
- `人气精选`

它们分别属于：

- 核心大类
- 商品形态
- 系列/香型
- 运营标签

如果强行放进一棵树，后面问“送礼产品”或者“奥费恩的淡香精”时会很别扭。

## 推荐映射逻辑

### 个人香氛

```text
core_family = 个人香氛
product_form = 淡香水 / 淡香精 / 发香喷雾 / 香膏
collection_or_scent = 奥费恩 / 杜桑 / 无花果 / 浆果香 / 玫瑰香调
```

### 家居香氛

```text
core_family = 家居香氛
product_form = 香氛蜡烛 / 室内香氛 / 扩香精 / 室内扩香摆件 / 电子扩香器
collection_or_scent = 浆果香 / 无花果 / 晚香玉 / 圣日尔曼大道34号
```

### 身体护理

```text
core_family = 身体护理
product_form = 护手乳 / 清洁露 / 润肤乳 / 香氛皂
collection_or_scent = 杜桑 / 无花果 / 圣日尔曼大道34号
```

### 艺术家居

```text
core_family = 艺术家居
product_form = 烛罩 / 蜡烛配件 / 托盘 / 花瓶 / 烛台
material_or_craft = 玻璃 / 陶瓷 / 木质 / 金属
```

## 和 type 的关系

不要直接用原始 `type` 作为最终分类。

建议保留两个字段：

```text
type_raw
type_derived
```

其中：

- `type_raw` 来自原始抓取
- `type_derived` 来自你清洗后的分类列

例如：

```text
东京淡香水 50ML
type_raw = 空
core_family = 个人香氛
product_form = 淡香水
type_derived = fragrance
```

```text
全曲线玻璃烛罩 L
type_raw = 空
core_family = 艺术家居
product_form = 烛罩
material_or_craft = 玻璃
type_derived = decor_accessory
```

## 三元组落法

清洗完之后可以这样出图谱：

```text
产品 - BELONGS_TO_FAMILY -> 个人香氛
产品 - HAS_PRODUCT_FORM -> 淡香精
产品 - IN_COLLECTION -> 奥费恩
产品 - HAS_MARKETING_TAG -> 人气精选
产品 - HAS_VARIANT_TAG -> 补充装
产品 - HAS_MATERIAL -> 玻璃
```

## 最小可执行顺序

1. 保留原始 `category_names_raw`
2. 把组合字段拆成 token
3. 先做 token 字典
4. 再把 token 回填到产品主表的多列
5. 最后再生成图谱节点和关系
