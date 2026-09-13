"""
结构化字段提取：按 doc_type（business_license / id_card_front / id_card_back）
在 RapidOCR 输出的文本行上做标签定位 + 正则校验 + 校验位纠错，产出结构化字段。
"""

from __future__ import annotations

import itertools
import re
from typing import Any

_COMPANY_NAME_SUFFIXES = (
    "有限公司", "有限责任公司", "股份有限公司", "公司", "合伙企业", "个体工商户",
    "经营部", "服务部", "商行", "商店", "商贸行", "合作社", "中心", "事务所",
    "工作室", "工程队", "餐厅", "酒店", "酒楼", "饭店", "餐饮店", "超市",
    "便利店", "门市部", "经销处", "厂", "店",
)
_NAME_EXCLUDE_KEYWORDS = (
    "类型", "经营范围", "成立日期", "注册资本", "登记机关", "统一社会信用",
    "信用代码", "营业执照", "法定代表", "负责人", "经营者", "住所", "地址",
    "营业期限", "经营期限", "有效期",
)


_TRAILING_BRACKET = re.compile(r"[（(][^（）()]{0,20}[）)]\s*$")


def _guess_company_name(lines: list[str]) -> str:
    for raw in lines:
        ln = (raw or "").strip()
        if not (3 < len(ln) <= 40):
            continue
        if any(kw in ln for kw in _NAME_EXCLUDE_KEYWORDS):
            continue
        if ln.startswith(("型", "（", "(")):
            continue
        # 名称行常带括注（如「（个体工商户）」），判断公司后缀时先剥离括注部分，
        # 但返回值保留括注（这是名称的一部分，不是要排除的独立行）。
        core = _TRAILING_BRACKET.sub("", ln).strip()
        if core.endswith(_COMPANY_NAME_SUFFIXES) or ln.endswith(_COMPANY_NAME_SUFFIXES):
            return ln
    return ""


_BL_ADDR_LABELS = ("住所", "住址", "经营场所", "营业场所", "生产经营场所", "主要经营场所", "地址")
_BL_ADDR_MARK = re.compile(r"[省市区县镇乡村路街巷弄号室幢栋楼苑园社道厦场寓]|工业|大道|开发区|科技馆")
_BL_ADDR_STOP = (
    "注册资本", "成立日期", "法定代表", "经营范围", "登记机关", "类型", "名称",
    "统一社会信用", "信用代码", "负责人", "经营者", "注册号", "营业期限",
    "经营期限", "有效期", "公积金", "二维码", "市场监督", "工商行政",
    "市场主体", "应当", "公示", "年报", "报送", "提示", "网址", "义务",
    "登记日期", "扫描", "国家企业", "中华人民", "gsxt", "http", "www", "成立",
)
_BL_ADDR_FRAGMENT = {"住", "所", "址", "住所", "住址", "经营场所", "营业场所", "场所"}
_BL_ADDR_PREFIX = re.compile(r"^[\s:：]*(?:住所|住址|经营场所|营业场所|地址|住|所|址)?[\s:：]*")


def _bl_addr_value(ln: str):
    for lab in _BL_ADDR_LABELS:
        spaced = r"\s*".join(lab)
        m = re.match(rf"^\s*{spaced}\s*[:：]?\s*(.*)$", ln)
        if m:
            return m.group(1).strip()
    m = re.match(r"^\s*[住]?所\s*[:：]?\s*(.*)$", ln)
    if m and (m.group(1) == "" or _BL_ADDR_MARK.search(m.group(1))):
        return m.group(1).strip()
    return None


def _find_address(lines: list[str]) -> str:
    n = len(lines)
    for i, raw in enumerate(lines):
        ln = (raw or "").strip()
        val = _bl_addr_value(ln)
        if val is None:
            continue
        val = _BL_ADDR_PREFIX.sub("", val).strip()
        parts = [val] if val else []
        j = i + 1
        while j < n:
            nxt = (lines[j] or "").strip()
            if not nxt or nxt in _BL_ADDR_FRAGMENT:
                j += 1
                continue
            if any(s in nxt for s in _BL_ADDR_STOP):
                break
            cleaned = _BL_ADDR_PREFIX.sub("", nxt).strip()
            if 0 < len(cleaned) <= 40 and _BL_ADDR_MARK.search(cleaned):
                parts.append(cleaned)
                j += 1
                if re.search(r"[室号幢栋楼]\s*$", cleaned):
                    break
                continue
            break
        addr = "".join(parts).strip(" :：")
        if len(addr) >= 6 and _BL_ADDR_MARK.search(addr):
            return addr
    return ""


_ADDR_STOP = ("公民身份", "身份号码", "签发", "有效期")
_ADDR_SKIP = ("姓名", "姓 名", "性别", "民族", "出生", "CHINA", "中国", "居民身份证", "照片", "中华人民共和国")
_ADDR_KEYWORDS = tuple("省市区县乡镇街道路弄号栋幢室单元楼组村社区院巷道街村委")


def _id_front_address(lines: list[str]) -> str:
    label_idx = -1
    inline = ""
    for i, raw in enumerate(lines):
        m = re.search(r"(?:住\s*址|地\s*址)[:：]?\s*(.*)", raw or "")
        if m:
            label_idx = i
            inline = m.group(1).strip()
            break
    if label_idx < 0:
        return ""
    parts = [inline] if inline else []
    for raw in lines[label_idx + 1:]:
        s = (raw or "").strip()
        if not s:
            continue
        if any(k in s for k in _ADDR_STOP) or re.search(r"\d{15,}", s):
            break
        if any(k in s for k in _ADDR_SKIP):
            continue
        if any(k in s for k in _ADDR_KEYWORDS) or len(re.findall(r"[\u4e00-\u9fa5]", s)) >= 3:
            parts.append(s)
        else:
            break
    return "".join(parts).strip()


_LP_LABEL_TAIL = re.compile(r"(?:法定代表人|负责人|经营者|投资人|责人|代表人)\s*[:：]?\s*$")
_LP_NAME = re.compile(r"^[\u4e00-\u9fa5·]{2,8}$")
_LP_NAME_STOP = (
    "有限", "公司", "责任", "企业", "经营", "范围", "注册", "资本", "成立",
    "日期", "住所", "场所", "类型", "名称", "机关", "信用", "代码", "期限",
    "组成", "形式", "股东", "出资", "负责", "代表", "营者", "投资", "个人",
)


def _find_legal_person(lines: list[str]) -> str:
    n = len(lines)
    for i, raw in enumerate(lines):
        ln = (raw or "").strip()
        if not _LP_LABEL_TAIL.search(ln):
            continue
        for j in range(i + 1, min(i + 4, n)):
            nxt = (lines[j] or "").strip()
            if not nxt:
                continue
            if _LP_NAME.match(nxt) and not any(k in nxt for k in _LP_NAME_STOP):
                return nxt
            break
    return ""


def _join_text(lines: list[str]) -> str:
    return "\n".join([x.strip() for x in lines if x and x.strip()])


# 统一社会信用代码（GB 32100）字符集：不含 I/O/Z/S/V，共 31 个字符。
_CC_CHARS = "0123456789ABCDEFGHJKLMNPQRTUWXY"
_CC_INDEX = {c: i for i, c in enumerate(_CC_CHARS)}
_CC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28]
_CC_FORBIDDEN = set("IOZSV")
_CC_CONFUSE = {
    "S": ["8", "5", "6"], "O": ["0", "D", "Q"], "I": ["1"], "Z": ["2", "7"],
    "V": ["Y", "U"], "B": ["8"], "D": ["0"], "G": ["6", "9"], "Q": ["0"],
    "L": ["1"], "0": ["D", "Q"], "8": ["B"],
}


def _cc_check_char(first17: str) -> str:
    total = sum(_CC_INDEX[c] * w for c, w in zip(first17, _CC_WEIGHTS))
    return _CC_CHARS[(31 - (total % 31)) % 31]


def _cc_valid(code: str) -> bool:
    if len(code) != 18 or any(c not in _CC_INDEX for c in code):
        return False
    return _cc_check_char(code[:17]) == code[17]


def _cc_correct(code: str) -> str:
    """用 GB32100 校验位反推纠错，仅在禁用字符位（I/O/Z/S/V，必为 OCR 误识）上尝试替换。"""
    if len(code) != 18 or not any(ch in _CC_FORBIDDEN for ch in code):
        return ""
    opts = []
    for ch in code:
        if ch in _CC_FORBIDDEN:
            opts.append([a for a in _CC_CONFUSE.get(ch, ["0"]) if a in _CC_INDEX] or ["0"])
        else:
            opts.append([ch])
    total = 1
    for o in opts:
        total *= len(o)
    if total > 20000:
        return ""
    for combo in itertools.product(*opts):
        cand = "".join(combo)
        if _cc_valid(cand):
            return cand
    return ""


def _find_credit_code(text: str) -> str:
    candidates = re.findall(r"[0-9A-Z]{18}", text.upper())
    if not candidates:
        return ""
    for c in candidates:
        if _cc_valid(c):
            return c
    # 只对含有 OCR 易混淆的禁用字符（I/O/Z/S/V）的候选做纠错重试：纯数字/字母的 18 位串
    # （例如身份证号误传到营业执照框时提取到的号码）本身就不含这些禁用字符，说明它并非
    # OCR 误识导致校验位不过，而是本来就不是信用代码——不应该被当作"最接近"的兜底强行返回，
    # 否则会把身份证号误判成统一社会信用代码写入公司信息表单。
    candidates_with_forbidden = [c for c in candidates if any(ch in _CC_FORBIDDEN for ch in c)]
    if not candidates_with_forbidden:
        return ""
    best = min(candidates_with_forbidden, key=lambda c: sum(ch in _CC_FORBIDDEN for ch in c))
    fixed = _cc_correct(best)
    if fixed:
        return fixed
    return ""


_ID_CARD_MARKERS = re.compile(r"公民身份号码|居民身份证|中华人民共和国居民身份证")


_ID_NUMBER_RE = re.compile(r"\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]")
_ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
_ID_CHECK_CODES = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"]


def is_valid_id_number(id_number: str) -> bool:
    """校验中国大陆身份证号校验位（GB 11643-1999）。"""
    if not _ID_NUMBER_RE.fullmatch(id_number):
        return False
    digits = [int(c) for c in id_number[:17]]
    total = sum(d * w for d, w in zip(digits, _ID_WEIGHTS))
    return _ID_CHECK_CODES[total % 11] == id_number[17].upper()


def extract_fields(doc_type: str, lines: list[str]) -> dict[str, Any]:
    """按 doc_type 从文本行中提取结构化字段。当前只覆盖客户录入向导实际使用的字段。"""
    text = _join_text(lines)
    fields: dict[str, Any] = {"name": "", "address": "", "legal_person": "",
                              "credit_code": "", "id_number": ""}
    if not text:
        return fields

    if doc_type == "business_license":
        # 身份证正反面误传到营业执照框时，文本里会出现"公民身份号码/居民身份证"等
        # 专属标志，这类文本本身就不含营业执照信息（名称/地址/统一信用代码），
        # 直接短路返回空字段，避免"住址"标签被 _find_address 当作经营场所误抽取、
        # 姓名被当作公司名/法定代表人误抽取。
        if _ID_CARD_MARKERS.search(text):
            return fields
        fields["credit_code"] = _find_credit_code(text)
        m = re.search(r"(?:名\s*称|名称)[:：]?\s*([^\n]+)", text)
        if m:
            fields["name"] = m.group(1).strip()
        fields["address"] = _find_address(lines)
        if not fields["name"]:
            fields["name"] = _guess_company_name(lines)
        if fields["name"]:
            fields["name"] = re.sub(
                r"(?:注册资本|成立日期|营业期限|经营期限|类\s*型|法定代表人?|经营者|登记机关|住\s*所|经营范围).*$",
                "", fields["name"],
            ).strip()
            fields["name"] = re.sub(r"^(?:名\s*称|名称|称)[:：、\s]*", "", fields["name"]).strip()
        for pattern in (
            r"法定代表人\s*([\u4e00-\u9fa5·]{2,8})",
            r"(?:法定代表|负责人|经营者)[:：]?\s*([\u4e00-\u9fa5·]{2,8})",
        ):
            m = re.search(pattern, text)
            if m:
                cand = m.group(1).strip()
                if not any(k in cand for k in _LP_NAME_STOP):
                    fields["legal_person"] = cand
                    break
        if not fields["legal_person"]:
            fields["legal_person"] = _find_legal_person(lines)
        return fields

    if doc_type == "id_card_front":
        wm = ("居民身份证", "身份证", "份证", "CHINA", "中国", "居民")
        lines = [ln for ln in lines if not any(w in (ln or "") for w in wm)]
        text = _join_text(lines)
        m = re.search(r"(?:姓名|姓\s*名)[:：]?\s*([\u4e00-\u9fa5·]{2,8})", text)
        if m:
            fields["name"] = re.sub(r"(?:性别|民族|出生).*$", "", m.group(1)).strip()
        addr = _id_front_address(lines)
        if addr:
            fields["address"] = addr
        else:
            m = re.search(r"(?:住址|地址)[:：]?\s*([^\n]+)", text)
            if m:
                fields["address"] = m.group(1).strip()
        m = re.search(r"(?:公民身份号码|身份证号码?|号码)[:：]?\s*([0-9Xx]{18})", text)
        if not m:
            m = re.search(r"\b(\d{17}[0-9Xx])\b", text)
        if m and is_valid_id_number(m.group(1).upper()):
            fields["id_number"] = m.group(1).upper()
        return fields

    if doc_type == "id_card_back":
        return fields

    return fields
