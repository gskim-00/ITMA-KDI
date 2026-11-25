# [PLAN-20261124-03] 작업 로그

- 계획 문서: `DOCS/ACTIVE/PLAN-20261124-03_spec-form-select.md` (완료 후 `DOCS/COMPLETE/`)

| 일시 | 구분 | 내용 | 관련 파일 |
|------|------|------|----------|
| 2026-11-24 18:09 | 시작 | 계획 문서 작성 (요청: 카테고리 스펙 폼이 여러 개일 때 추가/수정 화면에서 폼 선택) | `DOCS/ACTIVE/PLAN-20261124-03_spec-form-select.md` |
| 2026-11-24 18:12 | 수정 | `_save_asset_form_spec_values()`에 `spec_form_id` 처리(선택 폼 항목만 저장, 다른 폼 연결 값 삭제·이력), `ANY(%s::int[])` 형 지정 | `blueprints/ITMA.py` |
| 2026-11-24 18:13 | 수정 | 스펙 폼 선택 상자, 기본 선택(저장 값 많은 폼 → 1개면 자동), 폼 변경 시 삭제 안내, payload `spec_form_id`, 저장 후 다시 표시 | `static/js/itma-asset-form.js`, `static/css/itma.css` |
| 2026-11-24 18:13 | 결정 | 존재하지 않거나 다른 카테고리의 폼 id는 선택 없음으로 처리(삭제 없음) | `blueprints/ITMA.py` |
| 2026-11-24 18:14 | 수정 | `?v=20261124b` 갱신 | `templates/ITMA/asset_form.html`, `templates/ITMA/index.html`, `templates/ITMA/dashboard.html` |
| 2026-11-24 18:15 | 검증 | Python AST·`node --check` 통과. 롤백 테스트: 폼 A 저장 → 폼 B 선택 시 A 값 삭제·B 저장·이력, B 선택 시 A 항목 값 무시, 잘못된 폼 id 처리, 변경 없음 False | |
| 2026-11-24 18:15 | 수정 | 웹 컨테이너 재시작, `/login` 200 | |
| 2026-11-24 18:16 | 완료 | COMPLETE로 이동, v1.3.1 예정 (화면 수동 검증은 사용자 확인 대기) | `DOCS/COMPLETE/PLAN-20261124-03_spec-form-select.md` |
| 2026-11-25 09:57 | 결정 | 예정 버전 → 사용자 요청으로 1.2.0에 통합 확정 | `CHANGELOG.md` |
