"""
营业执照字段英文转写：不接入机器翻译 API（企业字号/地址本身没有"标准译文"，机器翻译
容易把字号意译成不可控的词组），采用离线规则法：

- 省/市英文名 + 邮编：`cpca` 库从 address 中识别省/市/区 + adcode，省份用静态英文名表
  （34 个省级行政区是固定集合），邮编用 adcode 查本地固化的
  `data/china_zipcode_adcode.json`（数据来源见该文件旁的说明，adcode -> 6 位邮编，
  精确到区/县级；`两江新区`这类非标准行政区划无法定位到区级 adcode 时留空，不做猜测）。
- 公司名/地址英文：字号、路名等专有名词部分用拼音转写（`pypinyin`），公司组织形式
  后缀（有限公司/个体工商户/经营部……）用静态表译成英文惯用词，行政区划部分用上面的
  省市英文名替换、其余仍为拼音——这是涉外资料里对无官方英文名的中国企业名/地址的
  通行处理方式，产出结果仅作"建议值"，业务上应允许人工编辑。
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import cpca
from pypinyin import Style, pinyin

_DATA_DIR = Path(__file__).parent / "data"
_ZIP_DATA_PATH = _DATA_DIR / "china_zipcode_adcode.json"

_MUNICIPALITIES = {"北京市", "天津市", "上海市", "重庆市"}
_CITY_SUFFIX_STRIP = ("特别行政区", "自治州", "地区", "市", "盟")

# 国家级新区等非标准行政区划名称，cpca 无法把它们识别到区县级 adcode（会导致地址
# 只定位到省级，邮编查不到）。这里给常见新区补一个「主要辖区」的区县 adcode 作为
# 兜底近似值——新区实际横跨多个区，邮编仅供参考，非精确值。
_NEW_AREA_ADCODE_HINT = {
    "两江新区": "500112",  # 重庆市渝北区（两江新区管委会及大竹林等街道主要在此）
}

_PROVINCE_EN = {
    "北京市": "Beijing", "天津市": "Tianjin", "河北省": "Hebei", "山西省": "Shanxi",
    "内蒙古自治区": "Inner Mongolia", "辽宁省": "Liaoning", "吉林省": "Jilin",
    "黑龙江省": "Heilongjiang", "上海市": "Shanghai", "江苏省": "Jiangsu",
    "浙江省": "Zhejiang", "安徽省": "Anhui", "福建省": "Fujian", "江西省": "Jiangxi",
    "山东省": "Shandong", "河南省": "Henan", "湖北省": "Hubei", "湖南省": "Hunan",
    "广东省": "Guangdong", "广西壮族自治区": "Guangxi", "海南省": "Hainan",
    "重庆市": "Chongqing", "四川省": "Sichuan", "贵州省": "Guizhou", "云南省": "Yunnan",
    "西藏自治区": "Tibet", "陕西省": "Shaanxi", "甘肃省": "Gansu", "青海省": "Qinghai",
    "宁夏回族自治区": "Ningxia", "新疆维吾尔自治区": "Xinjiang",
    "香港特别行政区": "Hong Kong", "澳门特别行政区": "Macao", "台湾省": "Taiwan",
}

# 公司名后缀英文惯用译法，按长度降序匹配（与 parsers._COMPANY_NAME_SUFFIXES 呼应）。
_SUFFIX_EN: list[tuple[str, str]] = sorted(
    [
        ("有限责任公司", "Co., Ltd."), ("股份有限公司", "Co., Ltd."), ("有限公司", "Co., Ltd."),
        ("个体工商户", "(Individual Business)"), ("合伙企业", "Partnership"), ("公司", "Company"),
        ("经营部", "Store"), ("服务部", "Service Department"), ("商贸行", "Trading Firm"),
        ("商行", "Trading Firm"), ("商店", "Store"), ("合作社", "Cooperative"), ("中心", "Center"),
        ("事务所", "Office"), ("工作室", "Studio"), ("工程队", "Engineering Team"),
        ("餐饮店", "Restaurant"), ("餐厅", "Restaurant"), ("酒楼", "Restaurant"),
        ("酒店", "Hotel"), ("饭店", "Restaurant"), ("超市", "Supermarket"),
        ("便利店", "Convenience Store"), ("门市部", "Retail Store"), ("经销处", "Distribution Office"),
        ("厂", "Factory"), ("店", "Store"),
    ],
    key=lambda p: -len(p[0]),
)

_TRAILING_BRACKET = re.compile(r"[（(]([^（）()]{0,20})[）)]\s*$")


def _load_zip_index() -> dict[str, dict[str, str]]:
    if not _ZIP_DATA_PATH.exists():
        return {}
    with open(_ZIP_DATA_PATH, encoding="utf-8") as f:
        rows = json.load(f)
    return {row["code"]: row for row in rows}


_ZIP_INDEX = _load_zip_index()
_CITY_ZIP_FALLBACK: dict[str, str] = {}
for _row in _ZIP_INDEX.values():
    _CITY_ZIP_FALLBACK.setdefault(_row["cityCode"], _row.get("zipCode", ""))


def transliterate(text: str) -> str:
    """把中文转写为空格分隔、首字母大写的拼音；数字/字母/符号原样保留（连续字母数字合并为一段）。"""
    if not text:
        return ""
    groups = pinyin(text, style=Style.NORMAL, errors=lambda chars: [[c] for c in chars])
    words: list[str] = []
    buf = ""
    for group in groups:
        s = group[0] if group else ""
        if re.fullmatch(r"[a-zA-Z0-9]", s or ""):
            buf += s
            continue
        if buf:
            words.append(buf)
            buf = ""
        if s.strip():
            words.append(s[0].upper() + s[1:])
    if buf:
        words.append(buf)
    return " ".join(words)


def guess_region(address: str) -> dict[str, str]:
    """从地址中识别省/市 + 英文名 + 邮编（能定位到区县级 adcode 时才给邮编，否则留空）。"""
    result = {"province": "", "city": "", "province_en": "", "city_en": "", "postal_code": ""}
    if not address:
        return result
    df = cpca.transform([address])
    if df.empty:
        return result
    row = df.iloc[0]
    province = (row.get("省") or "").strip()
    city = (row.get("市") or "").strip()
    adcode = str(row.get("adcode") or "").strip()
    if province in _MUNICIPALITIES and (not city or city == "市辖区"):
        city = province
    if not adcode or adcode.endswith("0000"):
        for area_name, hint_adcode in _NEW_AREA_ADCODE_HINT.items():
            if area_name in address:
                adcode = hint_adcode
                break
    result["province"] = province
    result["city"] = city
    result["province_en"] = _PROVINCE_EN.get(province, transliterate(province))
    if city == province:
        result["city_en"] = result["province_en"]
    else:
        city_bare = city
        for suf in _CITY_SUFFIX_STRIP:
            if city_bare.endswith(suf) and len(city_bare) > len(suf):
                city_bare = city_bare[: -len(suf)]
                break
        result["city_en"] = transliterate(city_bare)
    zip_row = _ZIP_INDEX.get(adcode)
    if zip_row:
        result["postal_code"] = zip_row.get("zipCode", "")
    elif len(adcode) >= 4:
        result["postal_code"] = _CITY_ZIP_FALLBACK.get(adcode[:4], "")
    return result


# 行政区划/道路后缀英文惯用译法，按长度降序匹配，用于地址结构化转写。
_DISTRICT_SUFFIX_EN: list[tuple[str, str]] = sorted(
    [
        ("经济技术开发区", "Economic & Technological Development Zone"),
        ("高新技术产业开发区", "High-tech Industrial Development Zone"),
        ("经济开发区", "Economic Development Zone"), ("高新区", "High-tech Zone"),
        ("新区", "New Area"), ("自治县", "Autonomous County"), ("区", "District"),
        ("县", "County"), ("市", "City"),
    ],
    key=lambda p: -len(p[0]),
)
_SUBDISTRICT_SUFFIX_EN = (("街道办事处", "Subdistrict"), ("街道", "Subdistrict"),
                          ("镇", "Town"), ("乡", "Township"))
_ROAD_SUFFIX_EN = (("大道", "Avenue"), ("大街", "Avenue"), ("路", "Road"),
                    ("街", "Street"), ("巷", "Lane"), ("胡同", "Alley"))
_DIRECTION_EN = {"东": "East", "南": "South", "西": "West", "北": "North", "中": "Middle"}

_ADDR_NEW_AREA = re.compile(r"^(.*?新区)")
_ADDR_SUBDISTRICT = re.compile(r"^(.*?(?:街道办事处|街道|镇|乡))")
_ADDR_ROAD = re.compile(r"^(.*?(?:大道|大街|路|街|巷|胡同))")
_ADDR_SECTION = re.compile(r"^(东|南|西|北|中)?段")
_ADDR_NUMBER = re.compile(r"^(\d+)号")
_ADDR_ANNEX = re.compile(r"^附(\d+)号")


def _transliterate_compact(text: str) -> str:
    """把中文转写为不加空格的单个拼音词（首字母大写），用于路名/街道名等专有名词——
    英文地名惯例是整体拼写成一个词（如 Jinkai、Dazhulin），而非逐字加空格。
    """
    if not text:
        return ""
    groups = pinyin(text, style=Style.NORMAL, errors=lambda chars: [[c] for c in chars])
    out = "".join(group[0] for group in groups if group and group[0])
    return out[:1].upper() + out[1:].lower() if out else ""


def _suffix_en(name: str, table: tuple[tuple[str, str], ...]) -> str:
    for suf, en in table:
        if name.endswith(suf):
            return f"{_transliterate_compact(name[: -len(suf)])} {en}".strip()
    return _transliterate_compact(name)


def translate_address(address: str) -> str:
    """地址结构化转写为英文惯用顺序（门牌号/道路/街道/区县在前，省市在后）；
    无法识别省市（如残缺地址）时退化为整体拼音转写。
    """
    if not address:
        return ""
    df = cpca.transform([address])
    if df.empty:
        return transliterate(address)
    row = df.iloc[0]
    province = (row.get("省") or "").strip()
    city = (row.get("市") or "").strip()
    district = (row.get("区") or "").strip()
    remainder = (row.get("地址") or "").strip()
    if not province:
        return transliterate(address)

    new_area_en = ""
    if not district:
        m = _ADDR_NEW_AREA.match(remainder)
        if m:
            new_area_en = _suffix_en(m.group(1), _DISTRICT_SUFFIX_EN)
            remainder = remainder[m.end():]

    subdistrict_en = ""
    m = _ADDR_SUBDISTRICT.match(remainder)
    if m:
        subdistrict_en = _suffix_en(m.group(1), _SUBDISTRICT_SUFFIX_EN)
        remainder = remainder[m.end():]

    road_en = ""
    m = _ADDR_ROAD.match(remainder)
    if m:
        road_en = _suffix_en(m.group(1), _ROAD_SUFFIX_EN)
        remainder = remainder[m.end():]
        m2 = _ADDR_SECTION.match(remainder)
        if m2:
            direction_en = _DIRECTION_EN.get(m2.group(1) or "", "")
            road_en = f"{direction_en} Section of {road_en}".strip()
            remainder = remainder[m2.end():]

    number_en = ""
    m = _ADDR_NUMBER.match(remainder)
    if m:
        number_en = f"No. {m.group(1)}"
        remainder = remainder[m.end():]

    annex_en = ""
    m = _ADDR_ANNEX.match(remainder)
    if m:
        annex_en = f"Annex {m.group(1)}"
        remainder = remainder[m.end():]

    rest_en = transliterate(remainder) if remainder.strip(" :：") else ""

    if district:
        district_en = _suffix_en(district, _DISTRICT_SUFFIX_EN)
    else:
        district_en = new_area_en

    if city in ("", province, "市辖区"):
        city_en = _PROVINCE_EN.get(province, transliterate(province))
    else:
        city_bare = city
        for suf in _CITY_SUFFIX_STRIP:
            if city_bare.endswith(suf) and len(city_bare) > len(suf):
                city_bare = city_bare[: -len(suf)]
                break
        city_en = transliterate(city_bare)

    parts = [p for p in (rest_en, number_en, annex_en, road_en, subdistrict_en,
                         district_en, city_en) if p]
    if not parts:
        return transliterate(address)
    return ", ".join(parts)


def translate_company_name(name: str) -> str:
    """公司名转写：组织形式后缀译成英文惯用词，其余（字号/地名）拼音转写。"""
    if not name:
        return ""
    core = name.strip()
    bracket_en = ""
    m = _TRAILING_BRACKET.search(core)
    if m:
        bracket_cn = m.group(1)
        core = core[: m.start()].strip()
        for suf, en in _SUFFIX_EN:
            if bracket_cn.endswith(suf):
                bracket_en = f" ({en})" if not en.startswith("(") else f" {en}"
                break
        if not bracket_en:
            bracket_en = f" ({transliterate(bracket_cn)})"
    for suf, en in _SUFFIX_EN:
        if core.endswith(suf):
            body = transliterate(core[: -len(suf)])
            return f"{body} {en}{bracket_en}".strip()
    return f"{transliterate(core)}{bracket_en}".strip()


def translate_business_license_fields(fields: dict[str, Any]) -> dict[str, Any]:
    """在 extract_fields 产出的 business_license 字段基础上追加英文转写字段。"""
    region = guess_region(fields.get("address") or "")
    fields["name_en"] = translate_company_name(fields.get("name") or "")
    fields["address_en"] = translate_address(fields.get("address") or "")
    fields["province_en"] = region["province_en"]
    fields["city_en"] = region["city_en"]
    fields["postal_code"] = region["postal_code"]
    return fields


def translate_person_name(name: str) -> dict[str, str]:
    """把中文姓名整体转写为拼音（首字母大写、姓名内部不加空格），供身份证识别结果
    直接填充"姓名（拼音）"表单字段。结果仅作建议值，业务上应允许人工编辑。
    """
    name = (name or "").strip()
    if len(name) < 2:
        return {"name_pinyin": ""}
    return {"name_pinyin": _transliterate_compact(name)}


def translate_id_card_fields(fields: dict[str, Any]) -> dict[str, Any]:
    """在 extract_fields 产出的 id_card_front 字段基础上追加姓名拼音 + 地址英文转写字段，
    地址转写方式与营业执照地址一致（见 `translate_business_license_fields`）。
    """
    fields.update(translate_person_name(fields.get("name") or ""))
    region = guess_region(fields.get("address") or "")
    fields["address_en"] = translate_address(fields.get("address") or "")
    fields["postal_code"] = region["postal_code"]
    return fields
