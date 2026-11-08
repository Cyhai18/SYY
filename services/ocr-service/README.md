# FunTax OCR service (`structured-v4`)

FastAPI + RapidOCR (CPU/ONNX), with separate business-license and ID-front field
schemas. ID backs are attachments; issuer/validity extraction is not implemented.
No external recognition/translation service is called.

## Run and deploy

```bash
cd services/ocr-service
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --reload --port 8000
```

Nest configuration: `OCR_SERVICE_URL=http://127.0.0.1:8000`.
Docker: `docker compose up -d --build ocr-service api web` from repository root.
The dev-all launcher does not use `--reload`; restart it after Python changes.
`GET /health` reports the pipeline version but does not warm the model. Use an
actual sample request for warmup. Uploads are limited to 10 MiB and decoded images to 24 million pixels. Each
worker runs one inference at a time, with at most eight active/queued HTTP
requests; excess requests return 503. The Nest caller has a 120-second timeout.
Use a single worker unless memory has been budgeted for one model per worker.

## Architecture

| Module                        | Responsibility                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.py`                      | HTTP validation; CPU work offloaded from the event loop; metadata-only logging                                                                              |
| `engine.py`                   | OCR adapter, reused orientation detections, enhancement and deskew; ID direction uses ID field order even if the number is masked or shares its label's box |
| `preprocess.py`               | Optional business-license quadrilateral/perspective candidate                                                                                               |
| `ocr_types.py`                | Shared text-box and extraction-evidence types                                                                                                               |
| `layout.py`                   | row order, spatial frame fusion, split business labels and repeated-print noise                                                                             |
| `extraction.py`               | Business field ownership and candidate evidence; no whole-page name/address guessing                                                                        |
| `id_card.py`                  | ID-specific name row, left address block, number footer, split 住/址, merged-field boundaries, portrait-side security text exclusion                        |
| `refinement.py`               | Business-name region OCR at multiple scales, requiring agreement                                                                                            |
| `validators.py`               | Calendar dates/check digits; no guessed ID digits; uniquely valid credit-code corrections only                                                              |
| `pipeline.py`                 | Image candidates, coherent evidence selection, provenance; one inference lock per worker                                                                    |
| `address_transliteration.py`  | Shared structured address parsing/rendering, explicit/inferred region separation, postcode provenance                                                       |
| `business_transliteration.py` | Company-name suggestions and business policy                                                                                                                |
| `id_transliteration.py`       | ID-specific personal-name policy and shared address rendering                                                                                               |
| `transliteration_data.py`     | Local administrative/postcode reference and organization suffix tables                                                                                      |
| `translate.py`                | Compatibility facade; no separate legacy address algorithm                                                                                                  |
| `parsers.py`                  | Text-only adapter into the same field extractors                                                                                                            |

The base `{docType, fields, rawText}` response is preserved. `diagnostics` adds
source boxes, heuristic evidence scores, missing/conflicting fields and
transliteration policy/provenance. Scores are NOT calibrated probabilities.
Missing identity information is not invented from obscured pixels. The field
schemas remain heuristic; the underlying OCR model has not been replaced.

## ID recognition and UI result semantics

- Names are confined to their visual row; sex/ethnicity/birth labels cannot be
  used to complete an incomplete name. Extended Han characters and middle dots
  are supported by extraction.
- Addresses collect same-row fragments and close continuation lines inside the
  left text block above the number row. Portrait-side security print is excluded
  geometrically; 中国 inside legitimate address text is not globally stripped.
- Number fragments can be joined only on one visual row, with whitespace/case/
  fullwidth normalization. Invalid checksums/dates remain unrecognized.
- Python, Nest and shared frontend validation now reject impossible dates even
  when the check digit passes. Calendar validation is not identity verification.
- Nest keeps `recognized` for valid-identifier compatibility and adds ID
  `status=complete|partial|unrecognized`, `missingFields`, `reviewRequired`.
  Complete means the core name/number/address fields are present, not verified.
- The ID form can fill a partial result with a clear warning. Deleting/replacing
  the front clears the ID field set; omitted new fields cannot preserve old
  English/postcode values. Contacts are retained. Obsolete OCR/duplicate-check
  results are ignored. Removing/replacing an existing front also clears the old
  back attachment to avoid pairing two identities. Uploading the back first is
  still supported.

## English suggestions (`id-v1`, `business-v1`)

A single normalized address parse supplies rendering and postcode suggestions.
CPCA position fields distinguish explicit administrative text from inferred
parents. Only matched spans are removed; unknown details are retained. Place
names use the local administrative reading where available (e.g. Chaoyang).
Rooms, floors, units, blocks and numbers are rendered structurally; Latin brands
and alphanumeric room values retain their case. County-level cities are retained.
City-only and special-area borrowed postcodes are not supplied. District-level
postcodes remain reference suggestions, not verified delivery postcodes.

ID names use a separate surname/given-name rendering (e.g. `Zhang San`,
`Ouyang Ming`) with bounded common polyphonic-surname rules. These rules do not
mutate pypinyin's global dictionary or business names. All personal-name outputs
require confirmation: family-specific readings, given-name polyphony and
passport/registered spelling cannot be determined from an ID image alone.
Middle-dot names are retained without forcing a Han surname split. Latin/mixed
names are retained rather than lowercased or translated into a new name.

Existing manually entered/stored English values are not migrated automatically.

## Practical limits

The supplied documents are a development regression set, not a held-out accuracy
benchmark. The three IDs are redacted; their full names/addresses/numbers cannot
be validated. A sample that outputs the visible surname or address fragments
must not be counted as fully correct identity extraction. The second ID's 中国
contamination was not reproduced on the redacted pixels; positioned synthetic
tests exercise the portrait-side case.

Glare, curvature, severely incomplete labels and merged foreground/background
text may still fail. Image cropping cannot restore missing characters. ID field
region re-OCR, learned card/seal detection and a replacement OCR model have not
been added or benchmarked. Name/address English and postcode fields remain
editable suggestions requiring human confirmation.

See the official documentation for
[CPCA position semantics](https://github.com/DQinYuan/chinese_province_city_area_mapper)
and [pypinyin conversion/customization](https://pypinyin.readthedocs.io/zh-cn/v0.55.0/api.html).
