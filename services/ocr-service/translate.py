"""Compatibility entrypoints into shared addresses and separate name policies."""
from __future__ import annotations
from typing import Any

def transliterate(text: str) -> str:
    from address_transliteration import romanize
    return romanize(text)


def translate_address(address: str) -> str:
    from address_transliteration import parse_address, render_address
    return render_address(parse_address(address or ''))


def guess_region(address: str) -> dict[str, str]:
    from address_transliteration import parse_address, place_name, postal_code
    parts = parse_address(address or '')
    city = parts.district if parts.district_explicit and parts.district.endswith('市') else parts.city
    return {'province':parts.province,'city':city,'province_en':place_name(parts.province),
            'city_en':place_name(city,parts.adcode if city==parts.district else ''),
            'postal_code':postal_code(parts)}


def translate_business_license_fields(fields: dict[str, Any]) -> dict[str, Any]:
    """Business-name policy plus shared structured address rendering."""
    from business_transliteration import translate_business_fields
    return translate_business_fields(fields)


def translate_person_name(name: str) -> dict[str, str]:
    from id_transliteration import name_suggestion
    return {'name_pinyin': name_suggestion(name)[0]}


def translate_id_card_fields(fields: dict[str, Any]) -> dict[str, Any]:
    from id_transliteration import translate_id_fields
    return translate_id_fields(fields)
