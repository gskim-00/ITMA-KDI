# [PLAN-20261124-02] 작업 로그

- 계획 문서: `DOCS/ACTIVE/PLAN-20261124-02_asset-form-spec-fields.md` (완료 후 `DOCS/COMPLETE/`)

| 일시 | 구분 | 내용 | 관련 파일 |
|------|------|------|----------|
| 2026-11-24 18:01 | 시작 | 계획 문서 작성. 확인 결과: 추가/수정 화면에 스펙 영역 없음, `/assets/save`는 스펙 값 미처리. 상세정보 모달은 스펙 폼 입력 기능 보유 | `DOCS/ACTIVE/PLAN-20261124-02_asset-form-spec-fields.md` |
| 2026-11-24 18:02 | 수정 | `form-data` 응답에 스펙 값 추가, `_save_asset_form_spec_values()` 추가 후 `save_asset_form`에서 호출 | `blueprints/ITMA.py` |
| 2026-11-24 18:02 | 결정 | 스펙 변경 이력은 `changed_column='asset_details'` 고정값으로 기록 — 이력 복원이 `changed_column`을 SQL 컬럼명으로 사용하므로 항목명을 컬럼명에 넣지 않음 | `blueprints/ITMA.py` |
| 2026-11-24 18:03 | 수정 | 추가/수정 화면 `상세 스펙` 영역, 카테고리 변경 시 스펙 폼 조회·렌더링, 입력값 유지, 저장 payload `spec` | `templates/ITMA/asset_form.html`, `static/js/itma-asset-form.js`, `static/css/itma.css` |
| 2026-11-24 18:03 | 수정 | `?v=20261124a` 갱신 | `templates/ITMA/asset_form.html`, `templates/ITMA/index.html`, `templates/ITMA/dashboard.html` |
| 2026-11-24 18:03 | 검증 | Python AST 검사 통과, `node --check`(node:20 컨테이너) 통과, BOM 없음 | |
| 2026-11-24 18:04 | 검증 | 컨테이너 내부: `/itma/spec-forms?category=hardware` 200(CPU·메모리), `/itma/assets/118/form-data` 200(`spec` 포함). 저장 헬퍼 추가·변경 없음·수정·비우기·다른 카테고리·잘못된 id 무시·이력 기록 확인 후 롤백(실데이터 변경 없음) | |
| 2026-11-24 18:04 | 수정 | 웹 컨테이너 재시작, `/login` 200 | |
| 2026-11-24 18:05 | 완료 | COMPLETE로 이동, v1.3.0 예정 (화면 수동 검증은 사용자 확인 대기) | `DOCS/COMPLETE/PLAN-20261124-02_asset-form-spec-fields.md` |
