"""Identity checksum validation independent of OCR and page layout."""
import itertools
from datetime import date
import re

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
    solutions = set()
    for combo in itertools.product(*opts):
        cand = "".join(combo)
        if _cc_valid(cand):
            solutions.add(cand)
            if len(solutions) > 1:
                return ""
    return next(iter(solutions), "")


def find_credit_code(text: str) -> str:
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
    try:
        date(int(id_number[6:10]), int(id_number[10:12]), int(id_number[12:14]))
    except ValueError:
        return False
    digits = [int(c) for c in id_number[:17]]
    total = sum(d * w for d, w in zip(digits, _ID_WEIGHTS))
    return _ID_CHECK_CODES[total % 11] == id_number[17].upper()
