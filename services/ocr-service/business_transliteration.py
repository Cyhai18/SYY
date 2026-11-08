"""Business-name policy with shared structured address suggestions.

One address parse supplies both rendering and region fields. Administrative
inference is distinguished from text actually present; no city-first postcode
or special-area district guess is used.
"""
from __future__ import annotations

import unicodedata
import transliteration_data as data
from address_transliteration import (parse_address, place_name, postal_code, render_address,
                                     romanize, translation_diagnostics as address_diagnostics)

_COMPANY_PLACE_SET = {r['name'] for r in data._ZIP_INDEX.values() if r.get('name', '').endswith('市')}
_COMPANY_PLACE_SET.update(r['city'] for r in data._ZIP_INDEX.values() if r.get('city'))
_COMPANY_PLACE_SET.update(data._PROVINCE_EN)
_COMPANY_PLACES = tuple(sorted(_COMPANY_PLACE_SET, key=len, reverse=True))



def render_company_name(name):
    if not name:
        return ''
    # Do not lowercase embedded Latin brands or flatten all punctuation.
    text = name.strip()
    annotation = ''
    match = data._TRAILING_BRACKET.search(text)
    if match:
        value = match.group(1)
        annotation = ' ' + next((en if en.startswith('(') else '(' + en + ')'
                                for suffix, en in data._SUFFIX_EN if value == suffix),
                               '(' + romanize(value) + ')')
        text = text[:match.start()].strip()
    suffix = next(((cn, en) for cn, en in data._SUFFIX_EN if text.endswith(cn)), None)
    core = text[:-len(suffix[0])] if suffix else text
    # Resolve only explicit, leading administrative names. Company brands are
    # transliterated, not passed through a machine-translation guess.
    leading = next((place for place in _COMPANY_PLACES if core.startswith(place)), '')
    body = ((place_name(leading) + ' ' + romanize(core[len(leading):])).strip()
            if leading else romanize(core))
    return (body + (' ' + suffix[1] if suffix else '') + annotation).strip()


def translate_business_fields(fields):
    result = dict(fields)
    address = unicodedata.normalize('NFKC', fields.get('address') or '').strip()
    parts = parse_address(address)
    city = parts.district if parts.district.endswith('市') and parts.district_explicit else parts.city
    result.update(
        name_en=render_company_name(fields.get('name') or ''),
        address_en=render_address(parts),
        province_en=place_name(parts.province),
        city_en=place_name(city, parts.adcode if city == parts.district else ''),
        postal_code=postal_code(parts),
    )
    return result


def translation_diagnostics(address):
    result = address_diagnostics(address)
    return {**result, 'version': 'business-v1'}
