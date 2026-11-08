"""Shared structured address suggestions and explicit postcode provenance."""
from __future__ import annotations
from dataclasses import dataclass
from functools import lru_cache
import re
from collections import Counter
import unicodedata
import cpca
from pypinyin import lazy_pinyin, Style
import transliteration_data as data

_DISTRICT_COUNTS = Counter(row.get("name") for row in data._ZIP_INDEX.values())

@dataclass(frozen=True)
class AddressParts:
    province: str = ''
    city: str = ''
    district: str = ''
    remainder: str = ''
    adcode: str = ''
    district_explicit: bool = False
    warnings: tuple[str, ...] = ()


def romanize(text: str, compact: bool = False) -> str:
    """Only Chinese runs are romanized; Latin brand case and numbers survive."""
    parts = []
    for run in re.findall(r'[\u4e00-\u9fff]+|[^\u4e00-\u9fff]+', text):
        if re.fullmatch(r'[\u4e00-\u9fff]+', run):
            syllables = lazy_pinyin(run, style=Style.NORMAL)
            parts.append(''.join(syllables).capitalize() if compact else ' '.join(s.capitalize() for s in syllables))
        else:
            parts.append(run)
    return re.sub(r'\s+', ' ', ' '.join(parts)).strip()


def _base(name):
    for ending in ('特别行政区', '维吾尔自治区', '壮族自治区', '回族自治区', '自治区', '自治州', '地区', '省', '市', '区', '县', '盟'):
        if name.endswith(ending):
            return name[:-len(ending)]
    return name


def place_name(name: str, adcode: str = '') -> str:
    row = data._ZIP_INDEX.get(adcode, {})
    # The local administrative reference carries place-specific readings,
    # avoiding general-purpose pinyin's 朝阳 -> Zhaoyang error.
    if row.get('name') == name and row.get('pinyin'):
        return ''.join(row['pinyin'].split()).capitalize()
    if name in data._PROVINCE_EN:
        return data._PROVINCE_EN[name]
    return romanize(_base(name), compact=True)


def _explicit_span(address, name, position):
    if not name or position < 0:
        return None
    for spelling in (name, _base(name)):
        if spelling and address.startswith(spelling, position):
            return position, position + len(spelling)
    return None


@lru_cache(maxsize=256)
def parse_address(address: str) -> AddressParts:
    if not address:
        return AddressParts()
    frame = cpca.transform([address], pos_sensitive=True)
    if frame.empty:
        return AddressParts(remainder=address, warnings=('region_not_found',))
    row = frame.iloc[0]
    province, city, district = (str(row.get(key) or '') for key in ('省', '市', '区'))
    positions = [int(row.get(key + '_pos', -1)) for key in ('省', '市', '区')]
    adcode = str(row.get('adcode') or '')
    if province in data._MUNICIPALITIES:
        city = province
    if positions[0] < 0 and positions[1] < 0 and district:
        if _DISTRICT_COUNTS[district] > 1:
            return AddressParts(remainder=address, warnings=('ambiguous_region',))
    spans = [span for name, pos in zip((province, city, district), positions)
             if (span := _explicit_span(address, name, pos)) is not None]
    # Remove just the identified administrative spans, preserving unknown prefixes
    # and all details; cpca's remainder alone can discard text before a place name.
    remainder = ''.join(char for i, char in enumerate(address)
                        if not any(start <= i < end for start, end in spans)).strip(' ,，')
    warnings = () if spans else ('region_not_found',)
    return AddressParts(province, city, district, remainder, adcode,
                        positions[2] >= 0, warnings)


_SUFFIXES = {
    '街道办事处':'Subdistrict', '街道':'Subdistrict', '社区':'Community',
    '小区':'Residential Area', '工业园':'Industrial Park', '开发区':'Development Zone',
    '新区':'New Area', '大道':'Avenue', '大街':'Street', '胡同':'Alley',
    '路':'Road', '街':'Street', '巷':'Lane', '镇':'Town', '乡':'Township', '村':'Village',
}
_SUFFIX_PATTERN = '|'.join(sorted(_SUFFIXES, key=len, reverse=True))
_DETAIL = re.compile(
    r'(?P<unit>[A-Za-z0-9一二三四五六七八九十百]+)(?P<kind>号房|号楼|单元|栋|幢|座|层|楼|室|房|号)'
    r'|(?P<place>[\u4e00-\u9fffA-Za-z0-9]+?)(?P<suffix>' + _SUFFIX_PATTERN + r')'
)
_UNITS = {'号房':'Room', '号楼':'Building', '单元':'Unit', '栋':'Building', '幢':'Building',
          '座':'Block', '层':'Floor', '楼':'Floor', '室':'Room', '房':'Room', '号':'No.'}
_DECLARATIONS = {'自主申报':'Self-declared', '住所申报':'Address declared', '承诺申报':'Declared by commitment'}


def _number(text):
    digits = {'一':1, '二':2, '三':3, '四':4, '五':5, '六':6, '七':7, '八':8, '九':9}
    if text in digits:
        return str(digits[text])
    if re.fullmatch(r'[一二三四五六七八九]?十[一二三四五六七八九]?', text):
        first, last = text.split('十')
        return str(digits.get(first, 1)*10 + digits.get(last, 0))
    return romanize(text, compact=True)


def render_details(text):
    parts, declarations = [], []
    # Declarations are annotations, not part of the building/room name.
    def annotation(match):
        value = match.group(1)
        declarations.append(_DECLARATIONS[value] if value in _DECLARATIONS else romanize(value))
        return ' '
    text = re.sub(r'[（(]([^（）()]+)[）)]', annotation, text)
    position = 0
    for match in _DETAIL.finditer(text):
        gap = text[position:match.start()].strip(' ,，')
        if gap:
            parts.append(romanize(gap))
        if match.group('unit'):
            parts.append(f"{_UNITS[match.group('kind')]} {_number(match.group('unit'))}")
        else:
            parts.append(f"{romanize(match.group('place'), compact=True)} {_SUFFIXES[match.group('suffix')]}")
        position = match.end()
    tail = text[position:].strip(' ,，')
    if tail:
        parts.append(romanize(tail))
    return list(reversed(parts)), declarations


def render_address(parts: AddressParts):
    details, annotations = render_details(parts.remainder)
    district = ''
    if parts.district:
        suffix = 'City' if parts.district.endswith('市') else ('County' if parts.district.endswith('县') else 'District')
        district = f'{place_name(parts.district, parts.adcode)} {suffix}'
    city = place_name(parts.city) if parts.city and parts.city != '市辖区' else ''
    province = place_name(parts.province) if parts.province else ''
    units = details + [district, city, province if province != city else '']
    result = ', '.join(value for value in units if value)
    if annotations:
        result += ' (' + '; '.join(annotations) + ')'
    return result



def postal_code(parts: AddressParts) -> str:
    """Only an explicitly matched district can supply a reference postcode."""
    row = data._ZIP_INDEX.get(parts.adcode, {})
    return row.get('zipCode', '') if parts.district_explicit and row.get('name') == parts.district else ''


def translation_diagnostics(address):
    parts = parse_address(unicodedata.normalize('NFKC', address or '').strip())
    exact = parts.district_explicit and data._ZIP_INDEX.get(parts.adcode, {}).get('name') == parts.district
    return {'version': 'address-v1', 'kind': 'transliteration_suggestion',
            'regionWarnings': list(parts.warnings),
            'cityLevel': 'county_city' if parts.district.endswith('市') and parts.district_explicit else 'prefecture_or_municipality',
            'postalCodeSource': 'district_reference' if exact else 'not_inferred',
            'postalCodeVerified': False}
