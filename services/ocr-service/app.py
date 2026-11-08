"""HTTP boundary only; recognition, extraction and transliteration are separate."""
from __future__ import annotations

import asyncio
import logging
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from pipeline import VERSION, recognize_serialized
from translate import translate_business_license_fields, translate_id_card_fields

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('ocr-service')
app = FastAPI(title='FunTax OCR Service')
ALLOWED_DOC_TYPES = {'business_license', 'id_card_front', 'id_card_back'}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_PENDING_REQUESTS = 8
_inference_slot = asyncio.Semaphore(1)
_pending_requests = 0


async def read_upload(file: UploadFile) -> bytes:
    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail='仅支持图片文件')
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail='图片不能超过 10 MB')
    if not data:
        raise HTTPException(status_code=400, detail='空文件')
    return data


def process_document(data: bytes, doc_type: str) -> dict:
    result = recognize_serialized(data, doc_type)
    if doc_type == 'business_license':
        result['fields'] = translate_business_license_fields(result['fields'])
        from business_transliteration import translation_diagnostics
        result['diagnostics']['transliteration'] = translation_diagnostics(result['fields'].get('address', ''))
    elif doc_type == 'id_card_front':
        result['fields'] = translate_id_card_fields(result['fields'])
        from id_transliteration import diagnostics
        result['diagnostics']['transliteration'] = diagnostics(result['fields'])
    return result


@app.get('/health')
async def health():
    return {'status': 'ok', 'pipeline': VERSION}


@app.post('/recognize')
async def recognize(file: UploadFile = File(...), doc_type: str = Form(...)):
    global _pending_requests
    counted = False
    try:
        if doc_type not in ALLOWED_DOC_TYPES:
            raise HTTPException(status_code=400, detail='doc_type 无效')
        # Wait before reading the spooled upload, not in a worker holding bytes.
        if _pending_requests >= MAX_PENDING_REQUESTS:
            raise HTTPException(status_code=503, detail='识别服务繁忙，请稍后重试')
        _pending_requests += 1
        counted = True
        async with _inference_slot:
            data = await read_upload(file)
            try:
                result = await run_in_threadpool(process_document, data, doc_type)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            except Exception as exc:
                logger.exception('OCR failed for doc_type=%s', doc_type)
                raise HTTPException(status_code=500, detail='识别失败，请稍后重试') from exc
        logger.info('pipeline=%s doc_type=%s elapsedMs=%s missingFields=%s', VERSION, doc_type,
                    result['diagnostics']['elapsedMs'], result['diagnostics']['missingFields'])
        return result
    finally:
        if counted:
            _pending_requests -= 1
        if file is not None:
            await file.close()
