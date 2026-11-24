# [PLAN-20261112-01] 작업 로그

- 계획 문서: `DOCS/COMPLETE/PLAN-20261112-01_upload-template-columns.md`

| 일시 | 구분 | 내용 | 관련 파일 |
|------|------|------|----------|
| 2026-11-12 00:00 | 시작 | 계획 문서 작성 — 화면 컬럼(기본 16 / 장비 정보 6 / 장비 상세 3) 확인 | `static/js/itma-handler.js`, `blueprints/ITMA.py` |
| 2026-11-12 00:03 | 결정 | 시리얼은 화면의 장비 상세 `Serial Number` 컬럼으로 받고, 중복 검사·저장은 `itma_assets.serial_number`와 `itma_asset_details.serial_number` 모두 대상 | `blueprints/ITMA.py` |
| 2026-11-12 00:03 | 결정 | 번호·수정 일시·수정자는 화면과 같도록 양식에 포함하되 자동 입력 컬럼(회색)으로 업로드 시 무시 | `blueprints/ITMA.py` |
| 2026-11-12 00:04 | 수정 | 업로드 양식 상수·별칭 추가, `_normalize_columns()` 재작성, `upload_assets()`·`download_template()` 수정 | `blueprints/ITMA.py` |
| 2026-11-12 00:05 | 검증 | `py_compile` 통과, CRLF 유지 | `blueprints/ITMA.py` |
| 2026-11-12 00:06 | 검증 | 모의 DB 검증 — 템플릿 25컬럼, 빈 양식, 새 양식(장비 정보·상세 저장), 중복 3종, 숫자 시리얼, 이전 양식 호환 | |
| 2026-11-12 00:10 | 완료 | VERSION 1.1.0, CHANGELOG 기록, 계획 문서 COMPLETE 작성 | `DOCS/COMPLETE/PLAN-20261112-01_upload-template-columns.md` |

구분 값: `시작` / `수정` / `검증` / `이슈` / `결정` / `롤백` / `완료` / `취소`
