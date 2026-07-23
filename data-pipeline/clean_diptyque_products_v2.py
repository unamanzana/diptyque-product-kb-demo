from __future__ import annotations

import csv
import re
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parent
INPUT_CSV = ROOT / "diptyque_products.csv"
OUTPUT_CSV = ROOT / "diptyque_products_cleaned.csv"
TOKEN_DICT_CSV = ROOT / "diptyque_category_token_dictionary.csv"
UNASSIGNED_CSV = ROOT / "diptyque_unassigned_tokens.csv"

DROP_TOKENS = {"探索全部"}

MARKETING_TAGS = {
    "人气精选",
    "当季精选",
    "臻选礼赠",
    "夏日限定系列",
    "夏日气息家居香氛",
    "夏日护肤仪式",
}

CORE_FAMILY_BY_TOKEN = {
    "个人香氛": "个人香氛",
    "家居香氛": "家居香氛",
    "室内香氛": "家居香氛",
    "家居清洁护理": "家居香氛",
    "家居清洁护理系列": "家居香氛",
    "身体护理": "身体护理",
    "身体护肤": "身体护理",
    "手部护肤": "身体护理",
    "香氛之艺身体护理": "身体护理",
    "艺术家居": "艺术家居",
    "文创": "文创",
}

CORE_FAMILY_PRIORITY = ["文创", "艺术家居", "身体护理", "家居香氛", "个人香氛"]

SPECIFIC_PRODUCT_FORMS = [
    "大千之蕴淡香精",
    "超大号香氛蜡烛",
    "大号香氛蜡烛",
    "中号香氛蜡烛",
    "迷你香氛蜡烛",
    "经典香氛蜡烛",
    "大千之境香氛蜡烛",
    "烛台香氛蜡烛",
    "室内扩香摆件",
    "车载扩香器",
    "电子扩香器",
    "室内喷雾",
    "发香喷雾",
    "室内香氛蜡",
    "香氛蜡烛",
    "扩香精",
    "淡香精",
    "淡香水",
    "香膏",
    "烛盖和灭烛罩",
    "烛罩",
    "花瓶",
    "烛台",
    "托盘",
]

GENERAL_PRODUCT_FORMS = [
    "室内香氛",
    "香氛蜡烛配饰",
    "蜡烛配件",
    "其他配件",
    "装饰摆件",
    "梳妆用具",
]

COLLECTION_OR_SCENT_TOKENS = {
    "圣日尔曼大道34号",
    "浆果香",
    "无花果",
    "希腊无花果",
    "晚香玉",
    "玫瑰",
    "玫瑰香调",
    "杜桑",
    "奥费恩",
    "含羞草",
    "炭木香",
    "琥珀",
    "感官之水",
    "橙花",
    "纸上",
    "巴黎之水",
    "影中之水",
    "谭道",
    "大千之蕴",
    "生姜",
    "肌肤之花",
}

NAME_FORM_RULES = [
    ("烛台香氛蜡烛", "烛台香氛蜡烛"),
    ("超大号香氛蜡烛", "超大号香氛蜡烛"),
    ("大号香氛蜡烛", "大号香氛蜡烛"),
    ("中号香氛蜡烛", "中号香氛蜡烛"),
    ("迷你香氛蜡烛", "迷你香氛蜡烛"),
    ("发香喷雾", "发香喷雾"),
    ("淡香水礼盒", "淡香水礼盒"),
    ("体验套装", "礼盒"),
    ("淡香精", "淡香精"),
    ("淡香水", "淡香水"),
    ("滋养油", "滋养油"),
    ("烛台", "烛台"),
    ("礼盒", "礼盒"),
    ("餐具清洁液", "餐具清洁液"),
    ("清洁喷雾", "清洁喷雾"),
    ("香氛护手霜", "护手霜"),
    ("护手霜", "护手霜"),
    ("护手乳", "护手乳"),
    ("润肤乳", "润肤乳"),
    ("身体乳", "身体乳"),
    ("洁肤露", "洁肤露"),
    ("清洁露", "清洁露"),
    ("沐浴油", "沐浴油"),
    ("去角质霜", "去角质霜"),
    ("香氛皂", "香氛皂"),
    ("身体凝乳", "身体凝乳"),
    ("凝乳", "身体凝乳"),
    ("护理剂", "护理剂"),
    ("线香盒", "线香盒"),
    ("笔记本", "笔记本"),
    ("便签本", "便签本"),
    ("笔筒", "笔筒"),
    ("收纳托盘", "收纳托盘"),
    ("收纳瓶", "收纳瓶"),
    ("收纳罐", "收纳罐"),
    ("收纳包", "收纳包"),
    ("平底杯", "平底杯"),
]

NON_SCENT_PRODUCT_FORMS = {
    "烛盖和灭烛罩",
    "烛罩",
    "花瓶",
    "烛台",
    "托盘",
    "线香盒",
    "笔记本",
    "便签本",
    "笔筒",
    "收纳托盘",
    "收纳瓶",
    "收纳罐",
    "收纳包",
    "平底杯",
    "香氛蜡烛配饰",
    "蜡烛配件",
    "其他配件",
    "装饰摆件",
    "梳妆用具",
}

MATERIAL_RULES = [
    ("玻璃", "玻璃"),
    ("陶瓷", "陶瓷"),
    ("金属", "金属"),
    ("漆木", "木质"),
    ("木制", "木质"),
    ("木", "木质"),
    ("皮革", "皮革"),
    ("镜面", "镜面"),
    ("蜡质", "蜡质"),
]

NAME_COLLECTION_RULES = [
    "圣日尔曼大道34号",
    "希腊无花果",
    "无花果",
    "浆果香",
    "晚香玉",
    "玫瑰香调",
    "玫瑰",
    "杜桑",
    "奥费恩",
    "含羞草",
    "炭木香",
    "琥珀",
    "感官之水",
    "橙花",
    "纸上",
    "巴黎之水",
    "影中之水",
    "谭道",
    "大千之蕴",
    "生姜",
    "肌肤之花",
]

GENERIC_SCENT_PROFILES = {
    "花香调": "花香",
    "花香": "花香",
    "木质香调": "木质",
    "木质": "木质",
    "果香调": "果香",
    "果香": "果香",
    "草本香调": "草本绿香",
    "草本香": "草本绿香",
    "草本": "草本绿香",
    "辛香调": "辛香",
    "辛香": "辛香",
    "海洋香调": "海洋矿物",
    "海洋香": "海洋矿物",
    "柑橘": "柑橘",
}

NOTE_ALIASES = {
    "无花果树木": "无花果木",
    "黑加伦子叶": "黑醋栗叶",
    "黑加伦子花蕾": "黑醋栗花蕾",
    "檀香木": "檀香",
    "鸢尾花": "鸢尾",
    "粉红胡椒子": "粉红胡椒",
    "紫罗兰叶片": "紫罗兰叶",
}

# Broader scent concepts are deliberately conservative. They only merge terms
# that the source data identifies as variants, preparations, or named parts of
# the same olfactory material. Product-name substring matching is never used.
SCENT_CONCEPT_ALIASES = {
    "希腊无花果": "无花果",
    "无花果叶": "无花果",
    "无花果木": "无花果",
    "无花果树汁": "无花果",
    "无花果汁": "无花果",
    "玫瑰香调": "玫瑰",
    "大马士革玫瑰": "玫瑰",
    "千叶玫瑰": "玫瑰",
    "大马士革及千叶玫瑰": "玫瑰",
    "土耳其玫瑰": "玫瑰",
    "波旁玫瑰": "玫瑰",
    "玫瑰醚": "玫瑰",
    "橙花油": "橙花",
    "苦橙花": "橙花",
    "雪松香精": "雪松",
    "红雪松香精": "雪松",
    "阿特拉斯雪松": "雪松",
    "茉莉香精": "茉莉",
    "依兰香精": "依兰",
    "香草香精": "香草",
    "抹茶香精": "抹茶",
    "白茶香精": "白茶",
    "马黛茶香精": "马黛茶",
    "麦麸香精": "麦麸",
    "白陶土香精": "白陶土",
    "焦土香精": "焦土",
    "苔藓香精": "苔藓",
    "莎草油": "莎草",
    "海地香根草": "香根草",
    "爪哇香根草": "香根草",
    "白麝香": "麝香",
    "姜": "生姜",
    "岩玫瑰": "岩蔷薇",
    "荔枝香调": "荔枝",
    "广藿香香调": "广藿香",
    "鸢尾花香调": "鸢尾",
    "海洋矿物香调": "海洋矿物",
    "蒸稻米香调": "蒸稻米",
}

# Only collection labels that are themselves a concrete smell are promoted.
# Branded identities such as 杜桑 and 奥费恩 remain CollectionOrScent nodes.
COLLECTION_SCENT_CONCEPTS = {
    "无花果",
    "希腊无花果",
    "晚香玉",
    "玫瑰",
    "玫瑰香调",
    "琥珀",
    "含羞草",
    "橙花",
    "生姜",
}


NOTE_FAMILY_OVERRIDES = {
    "琥珀木质香": ["树脂琥珀", "木质"],
}

NOTE_FAMILY_KEYWORDS = [
    ("海洋矿物", ["海洋", "矿物", "焦土", "白陶土"]),
    ("树脂琥珀", ["琥珀", "焚香", "没药", "乳香", "安息香", "香脂", "白松香", "岩玫瑰", "岩蔷薇", "龙涎香"]),
    ("柑橘", ["柑橘", "佛手柑", "柠檬", "葡萄柚", "柚子", "青柑", "青橘", "红柑", "苦橙"]),
    ("花香", ["花香调", "玫瑰", "茉莉", "晚香玉", "橙花", "依兰", "鸢尾", "含羞草", "天竺葵", "小苍兰", "康乃馨", "金银花", "水仙", "仙客来", "玉兰", "紫藤", "永生花", "洋甘菊", "黄葵"]),
    ("果香", ["果香调", "无花果", "浆果", "覆盆子", "荔枝", "黑醋栗", "黑加伦子", "大黄"]),
    ("茶香美食", ["咖啡", "茶", "抹茶", "马黛", "蜂蜜", "黑芝麻", "香草", "香豆", "零陵香豆", "麦麸", "蒸稻米", "蜂蜡"]),
    ("辛香", ["辛香调", "胡椒", "姜", "小豆蔻", "肉豆蔻", "肉桂", "丁香", "香菜", "香芹", "小茴香"]),
    ("木质", ["木质香调", "木质香", "雪松", "檀香", "紫檀", "香根草", "广藿香", "柏树", "愈创木", "无花果木", "无花果树", "香桃木", "暖木", "皮革"]),
    ("草本绿香", ["草本香调", "杜松子", "百里香", "薄荷", "迷迭香", "鼠尾草", "柠檬草", "柠檬桉", "当归根", "菖蒲", "莎草", "紫苏", "荨麻", "苔藓", "无花果叶", "黑醋栗叶", "黑加伦子叶", "苦橙叶", "紫罗兰叶", "洋蓟"]),
    ("麝香粉香", ["麝香", "麝香调", "黄葵籽"]),
]
NOTE_REJECT_TERMS = {
    "赋活",
    "洁净",
    "细腻",
    "清爽",
    "绵密",
    "滋养",
    "亮泽",
    "呵护",
    "去污",
    "去油脂",
    "除垢",
    "泡沫丰富",
    "去除异味",
    "芳香家居环境",
    "手工制作",
    "火焰吹制",
    "陶瓷",
    "玻璃",
    "素瓷",
    "木版印刷",
    "横格线条",
    "清洁",
    "充电式",
}


def split_tokens(value: str) -> list[str]:
    return [part.strip() for part in value.split("|") if part.strip()]


def uniq_keep_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


def join_or_blank(items: list[str]) -> str:
    return "|".join(items)


def normalize_product_name(value: str) -> str:
    return re.sub(r"[\s\-–—·]+", "", value).strip()


def make_product_key(spu: str, name: str, sku: str) -> str:
    stable_name = normalize_product_name(name) or sku
    return f"{spu or sku}::{stable_name}"


def keep_longest_matches(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in sorted(uniq_keep_order(values), key=lambda item: (-len(item), item)):
        if any(value in selected for selected in result):
            continue
        result.append(value)
    return result


def pick_core_family(tokens: list[str], name: str, type_raw: str) -> str:
    families = [CORE_FAMILY_BY_TOKEN[token] for token in tokens if token in CORE_FAMILY_BY_TOKEN]
    families = uniq_keep_order(families)
    for family in CORE_FAMILY_PRIORITY:
        if family in families:
            return family

    if any(word in name for word in ["笔记本", "便签本", "笔筒"]):
        return "文创"
    if any(word in name for word in ["护手", "润肤", "洁肤", "清洁露", "香氛皂", "沐浴", "凝乳", "去角质"]):
        return "身体护理"
    if type_raw == "candle":
        return "家居香氛"
    if any(word in name for word in ["烛罩", "烛盖", "烛台", "花瓶", "托盘", "收纳", "平底杯", "线香盒"]):
        return "艺术家居"
    if type_raw == "fragrance":
        return "个人香氛"
    return ""


def pick_product_form(tokens: list[str], name: str) -> tuple[str, str]:
    for pattern, value in NAME_FORM_RULES:
        if pattern in name:
            return value, "name"

    for token in SPECIFIC_PRODUCT_FORMS:
        if token in tokens:
            return token, "category"

    for token in GENERAL_PRODUCT_FORMS:
        if token in tokens:
            return token, "category"

    return "", ""


def normalize_fragrance_collection(value: str, name: str) -> str:
    normalized = re.sub(r"\d+(?:ML|L)$", "", value.strip(), flags=re.IGNORECASE)
    normalized = {"奥费恩香调": "奥费恩"}.get(normalized, normalized)
    if normalized == "玫瑰" and "玫瑰香调" in name:
        normalized = "玫瑰香调"
    return normalized if normalized in COLLECTION_OR_SCENT_TOKENS else ""


def pick_collection(
    tokens: list[str],
    name: str,
    fragrance_raw: str,
    core_family: str,
    product_form: str,
) -> tuple[list[str], str]:
    category_values = keep_longest_matches([token for token in tokens if token in COLLECTION_OR_SCENT_TOKENS])
    name_values = keep_longest_matches([token for token in NAME_COLLECTION_RULES if token in name])
    strong_name_values = [value for value in name_values if name.startswith(value)]
    fragrance_value = normalize_fragrance_collection(fragrance_raw, name)
    scent_bearing = product_form not in NON_SCENT_PRODUCT_FORMS and (
        core_family in {"个人香氛", "家居香氛", "身体护理"}
        or "香氛蜡烛" in product_form
    )

    if category_values:
        if scent_bearing and strong_name_values and not set(strong_name_values).intersection(category_values):
            return strong_name_values, "name_override"
        if fragrance_value and fragrance_value in category_values:
            return category_values, "category_and_fragrance"
        source = "category_and_name" if set(name_values).intersection(category_values) else "category"
        return category_values, source
    if scent_bearing and name_values:
        return name_values, "name"
    if scent_bearing and fragrance_value:
        return [fragrance_value], "fragrance"
    return [], ""


def classify_note_families(term: str) -> list[str]:
    if term in GENERIC_SCENT_PROFILES:
        return [GENERIC_SCENT_PROFILES[term]]
    if term in NOTE_FAMILY_OVERRIDES:
        return NOTE_FAMILY_OVERRIDES[term]

    matches: list[tuple[int, str]] = []
    for family, keywords in NOTE_FAMILY_KEYWORDS:
        matched_lengths = [len(keyword) for keyword in keywords if keyword in term]
        if matched_lengths:
            matches.append((max(matched_lengths), family))
    if not matches:
        return ["未分类"]

    longest = max(length for length, _ in matches)
    return uniq_keep_order([family for length, family in matches if length == longest])


def classify_note_family(note: str) -> str:
    return classify_note_families(note)[0]


def pick_scent_terms(
    subtitle: str,
    name: str,
    type_raw: str,
    core_family: str,
    collections: list[str],
) -> tuple[list[str], list[str], list[str], str]:
    has_scent_context = (
        type_raw in {"fragrance", "candle"}
        or core_family in {"个人香氛", "家居香氛"}
        or bool(collections)
        or "香调" in name
        or "香氛" in name
    )
    if not subtitle or not has_scent_context or any(marker in name for marker in ["礼盒", "套装"]):
        return [], [], [], ""

    notes: list[str] = []
    profiles: list[str] = []
    accords: list[str] = []
    for part in re.split(r"[、,，/|；;]+", subtitle):
        note = part.strip(" 。.")
        note = re.sub(r"(?:的)?香气$", "", note).strip()
        if not note or len(note) > 24:
            continue
        if any(term in note for term in NOTE_REJECT_TERMS):
            continue
        if note in {"令人平和着迷", "香气与呵护", "便携扩香", "全新冷式扩香装饰摆件"}:
            continue
        if note in GENERIC_SCENT_PROFILES:
            profiles.append(note)
        elif note.endswith("香调"):
            accords.append(note)
        else:
            notes.append(NOTE_ALIASES.get(note, note))

    note_values = uniq_keep_order(notes)
    profile_values = uniq_keep_order(profiles)
    accord_values = uniq_keep_order(accords)
    source = "subtitle" if note_values or profile_values or accord_values else ""
    return note_values, profile_values, accord_values, source


def derive_scent_concept_evidence(
    collections: list[str],
    notes: list[str],
    accords: list[str],
) -> dict[str, list[tuple[str, str]]]:
    evidence: dict[str, list[tuple[str, str]]] = {}

    def add(concept: str, source_field: str, source_term: str) -> None:
        if not concept:
            return
        item = (source_field, source_term)
        bucket = evidence.setdefault(concept, [])
        if item not in bucket:
            bucket.append(item)

    for collection in collections:
        if collection in COLLECTION_SCENT_CONCEPTS:
            add(SCENT_CONCEPT_ALIASES.get(collection, collection), "collection_or_scent", collection)
    for note in notes:
        add(SCENT_CONCEPT_ALIASES.get(note, note), "note_tokens", note)
    for accord in accords:
        add(SCENT_CONCEPT_ALIASES.get(accord, accord.removesuffix("香调")), "scent_accords", accord)

    return evidence


def pick_scent_concepts(
    collections: list[str],
    notes: list[str],
    accords: list[str],
) -> list[str]:
    return list(derive_scent_concept_evidence(collections, notes, accords))


def pick_materials(name: str, subtitle: str, core_family: str) -> tuple[list[str], str]:
    if core_family != "艺术家居":
        return [], ""

    name_values = uniq_keep_order([value for pattern, value in MATERIAL_RULES if pattern in name])
    subtitle_values = uniq_keep_order([value for pattern, value in MATERIAL_RULES if pattern in subtitle])
    values = uniq_keep_order(name_values + subtitle_values)
    if values:
        if name_values and subtitle_values:
            return values, "name_and_subtitle"
        return values, "name" if name_values else "subtitle"
    return [], ""


def pick_variant_tags(tokens: list[str], name: str) -> list[str]:
    values: list[str] = []
    if "补充装" in tokens or any(word in name for word in ["补充装", "补充瓶", "补充册"]):
        values.append("补充装")
    if "限量版" in name:
        values.append("限量版")
    return uniq_keep_order(values)


def derive_type(core_family: str, type_raw: str) -> str:
    if core_family == "个人香氛":
        return "fragrance"
    if core_family == "家居香氛":
        return "home_fragrance"
    if core_family == "身体护理":
        return "body_care"
    if core_family == "艺术家居":
        return "decor_accessory"
    if core_family == "文创":
        return "stationery"
    return type_raw


def classify_token(token: str) -> tuple[str, str]:
    if token in DROP_TOKENS:
        return "drop", "drop"
    if token in MARKETING_TAGS:
        return "marketing_tag", token
    if token in CORE_FAMILY_BY_TOKEN:
        return "core_family", CORE_FAMILY_BY_TOKEN[token]
    if token in SPECIFIC_PRODUCT_FORMS or token in GENERAL_PRODUCT_FORMS:
        return "product_form", token
    if token in COLLECTION_OR_SCENT_TOKENS:
        return "collection_or_scent", token
    if token == "补充装":
        return "variant_tag", token
    return "other", ""


def main() -> None:
    with INPUT_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))

    output_rows: list[dict[str, str]] = []
    token_counts: Counter[str] = Counter()
    unassigned_counts: Counter[str] = Counter()

    for row in rows:
        type_raw = (row.get("type") or "").strip()
        name = (row.get("name") or "").strip()
        subtitle = (row.get("subtitle") or "").strip()
        fragrance_raw = (row.get("fragrance") or "").strip()
        raw_tokens = split_tokens(row.get("category_names") or "")
        clean_tokens = [token for token in raw_tokens if token not in DROP_TOKENS]
        token_counts.update(raw_tokens)

        marketing_tags = [token for token in clean_tokens if token in MARKETING_TAGS]
        product_form, product_form_source = pick_product_form(clean_tokens, name)
        core_family = pick_core_family(clean_tokens, name, type_raw)
        collection_values, collection_source = pick_collection(
            clean_tokens,
            name,
            fragrance_raw,
            core_family,
            product_form,
        )
        note_values, scent_profile_values, scent_accord_values, scent_source = pick_scent_terms(
            subtitle,
            name,
            type_raw,
            core_family,
            collection_values,
        )
        scent_concept_values = pick_scent_concepts(collection_values, note_values, scent_accord_values)
        classified_scent_terms = scent_profile_values + scent_accord_values + note_values
        note_family_values = uniq_keep_order(
            family
            for term in classified_scent_terms
            for family in classify_note_families(term)
        )
        material_values, material_source = pick_materials(name, subtitle, core_family)
        variant_tags = pick_variant_tags(clean_tokens, name)
        type_derived = derive_type(core_family, type_raw)

        assigned_tokens = set(marketing_tags)
        assigned_tokens.update(collection_values)
        assigned_tokens.update(variant_tags)
        if product_form:
            assigned_tokens.add(product_form)
        for token in clean_tokens:
            if token in CORE_FAMILY_BY_TOKEN:
                assigned_tokens.add(token)

        other_tokens = [token for token in clean_tokens if token not in assigned_tokens]
        unassigned_counts.update(other_tokens)

        spu = (row.get("spu") or "").strip()
        sku = (row.get("sku") or "").strip()

        output_rows.append(
            {
                "product_key": make_product_key(spu, name, sku),
                "product_name": name,
                "identity_name": (row.get("identity_name") or "").strip(),
                "spu": spu,
                "sku": sku,
                "size": (row.get("sizes") or "").strip(),
                "price": (row.get("price") or "").strip(),
                "stock": (row.get("stock") or "").strip(),
                "url": (row.get("url") or "").strip(),
                "type_raw": type_raw,
                "type_derived": type_derived,
                "fragrance_raw": fragrance_raw,
                "fragrance_normalized": normalize_fragrance_collection(fragrance_raw, name),
                "core_family": core_family,
                "product_form": product_form,
                "product_form_source": product_form_source,
                "collection_or_scent": join_or_blank(collection_values),
                "collection_source": collection_source,
                "note_tokens": join_or_blank(note_values),
                "note_source": scent_source if note_values else "",
                "scent_profiles": join_or_blank(scent_profile_values),
                "scent_profile_source": scent_source if scent_profile_values else "",
                "scent_accords": join_or_blank(scent_accord_values),
                "scent_accord_source": scent_source if scent_accord_values else "",
                "scent_concepts": join_or_blank(scent_concept_values),
                "note_families": join_or_blank(note_family_values),
                "material_or_craft": join_or_blank(material_values),
                "material_source": material_source,
                "marketing_tags": join_or_blank(marketing_tags),
                "variant_tags": join_or_blank(variant_tags),
                "category_names_raw": (row.get("category_names") or "").strip(),
                "category_tokens_clean": join_or_blank(clean_tokens),
                "other_tokens": join_or_blank(other_tokens),
            }
        )

    output_fields = [
        "product_key",
        "product_name",
        "identity_name",
        "spu",
        "sku",
        "size",
        "price",
        "stock",
        "url",
        "type_raw",
        "type_derived",
        "fragrance_raw",
        "fragrance_normalized",
        "core_family",
        "product_form",
        "product_form_source",
        "collection_or_scent",
        "collection_source",
        "note_tokens",
        "note_source",
        "scent_profiles",
        "scent_profile_source",
        "scent_accords",
        "scent_accord_source",
        "scent_concepts",
        "note_families",
        "material_or_craft",
        "material_source",
        "marketing_tags",
        "variant_tags",
        "category_names_raw",
        "category_tokens_clean",
        "other_tokens",
    ]

    with OUTPUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=output_fields)
        writer.writeheader()
        writer.writerows(output_rows)

    with TOKEN_DICT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["token", "count", "token_role", "normalized_value"])
        writer.writeheader()
        for token, count in token_counts.most_common():
            token_role, normalized_value = classify_token(token)
            writer.writerow(
                {
                    "token": token,
                    "count": count,
                    "token_role": token_role,
                    "normalized_value": normalized_value,
                }
            )

    with UNASSIGNED_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["token", "count"])
        writer.writeheader()
        for token, count in unassigned_counts.most_common():
            writer.writerow({"token": token, "count": count})

    print(f"Wrote {OUTPUT_CSV}")
    print(f"Wrote {TOKEN_DICT_CSV}")
    print(f"Wrote {UNASSIGNED_CSV}")


if __name__ == "__main__":
    main()
