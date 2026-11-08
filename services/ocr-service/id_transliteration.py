"""ID-only name policy and shared address rendering. Suggestions, not official names."""
from __future__ import annotations
import re
import unicodedata
from pypinyin import lazy_pinyin, Style
from address_transliteration import parse_address, postal_code, render_address, translation_diagnostics as address_diagnostics

# Explicit surname context, without mutating pypinyin's global dictionary.
# Some families use alternative readings; all name suggestions require confirmation.
_SURNAME = {'单':'Shan', '曾':'Zeng', '解':'Xie', '区':'Ou', '仇':'Qiu', '查':'Zha',
            '乐':'Yue', '翟':'Zhai', '尉':'Yu', '盖':'Ge', '万俟':'Moqi', '尉迟':'Yuchi',
            '长孙':'Zhangsun', '单于':'Chanyu'}
_COMPOUND = set('欧阳 诸葛 司马 司徒 司空 上官 夏侯 东方 皇甫 尉迟 公孙 慕容 令狐 长孙 宇文 闻人 万俟 单于'.split())


def _pinyin(text):
    return ''.join(lazy_pinyin(text, style=Style.NORMAL)).capitalize()


def name_suggestion(name):
    name = unicodedata.normalize('NFKC',name or '').strip()
    if len(name)<2:
        return '', {'requiresConfirmation':True, 'reason':'incomplete_name'}
    if '·' in name or '•' in name:
        value=' · '.join(_pinyin(part) for part in re.split('[·•]',name) if part)
        return value, {'requiresConfirmation':True, 'reason':'unsegmented_name'}
    if not re.fullmatch(r'[\u3400-\u9fff\U00020000-\U0002fa1f]+',name):
        return name, {'requiresConfirmation':True, 'reason':'literal_or_mixed_name'}
    length=2 if name[:2] in _COMPOUND or name[:2] in _SURNAME else 1
    surname,given=name[:length],name[length:]
    surname_pinyin = _SURNAME[surname] if surname in _SURNAME else _pinyin(surname)
    if not given:
        return surname_pinyin, {'requiresConfirmation':True,'reason':'incomplete_given_name'}
    value=surname_pinyin+' '+_pinyin(given)
    return value, {'requiresConfirmation':True,'reason':'surname_rule' if surname in _SURNAME else 'pinyin_suggestion'}


def translate_id_fields(fields):
    result=dict(fields)
    address=unicodedata.normalize('NFKC',fields.get('address') or '').strip()
    parts=parse_address(address)
    name,_=name_suggestion(fields.get('name') or '')
    result.update(name_pinyin=name,address_en=render_address(parts),postal_code=postal_code(parts))
    return result


def diagnostics(fields):
    _, name=name_suggestion(fields.get('name') or '')
    return {**address_diagnostics(fields.get('address') or ''), 'version':'id-v1','name':name}
