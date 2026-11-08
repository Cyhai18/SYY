"""Local administrative/postcode reference and organization suffix tables."""
from __future__ import annotations
import json
import re
from pathlib import Path

_DATA_DIR = Path(__file__).parent / "data"
_ZIP_DATA_PATH = _DATA_DIR / "china_zipcode_adcode.json"

_MUNICIPALITIES = {"北京市", "天津市", "上海市", "重庆市"}

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

# 公司名后缀英文惯用译法，按长度降序匹配。
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
