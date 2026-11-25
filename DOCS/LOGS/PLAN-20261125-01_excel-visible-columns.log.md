# [PLAN-20261125-01] 작업 로그

- 계획 문서: `DOCS/ACTIVE/PLAN-20261125-01_excel-visible-columns.md` (완료 후 `DOCS/COMPLETE/`)

| 일시 | 구분 | 내용 | 관련 파일 |
|------|------|------|----------|
| 2026-11-25 10:22 | 시작 | 요청 접수(엑셀 업로드·다운로드를 자산 목록 표시 항목 기준으로, 작업 전 안내창). 현재 구조 분석 후 계획 문서 작성, 상태 계획. 착수 전 사용자 확인 4건(9번) 대기 | `DOCS/ACTIVE/PLAN-20261125-01_excel-visible-columns.md` |
| 2026-11-25 10:45 | 결정 | 사용자 답변 반영해 계획 재작성: ① '모든 항목' 다운로드 유지 ② 번호 = 엑셀 순번 재부여 ③ 스펙·사용자 정의 컬럼은 현재 서버 기준, 삭제 시 엑셀에서도 제외, 스펙 값은 목록과 같은 연결 값만 ④ 업로드 템플릿 기본 형식 고정 ⑤ 다운로드 흐름: 자산 선택(선택/모든) → 안내창 → 사용자 지정/기본 항목 선택. 남은 확인 3건(기본 정보 17개 여부, 기본 항목 구성, 장비 상세 17개 제외) | `DOCS/ACTIVE/PLAN-20261125-01_excel-visible-columns.md` |
| 2026-11-25 13:29 | 결정 | (정정) 바로 위 줄의 기록 시각 10:45는 잘못 기재 — 실제 재작성 시각 13:28 | `DOCS/LOGS/PLAN-20261125-01_excel-visible-columns.log.md` |
| 2026-11-25 13:41 | 결정 | 사용자 확정: 기본 형식 = 기본 정보 17 + 장비 정보 6 + 장비 상세 3 = 26개 고정(템플릿·기본 항목 다운로드 공통), 기본 항목 다운로드에 스펙·사용자 정의 컬럼 미포함(사용자 지정에서만), 장비 상세 17개 항목 이번 버전 제외. 남은 확인 사항 없음 | `DOCS/ACTIVE/PLAN-20261125-01_excel-visible-columns.md` |
| 2026-11-25 13:54 | 결정 | (정정) 바로 위 줄의 기록 시각 13:41은 잘못 기재 — 실제 13:54 | `DOCS/LOGS/PLAN-20261125-01_excel-visible-columns.log.md` |
| 2026-11-25 14:29 | 결정 | 사용자 확정: 스펙 폼·항목 삭제 시 연결된 자산 값도 DB에서 삭제(작업 범위 E 추가). 기존 연결 끊긴 값 0건 확인 → 정리 SQL 불필요. 상태 진행중, 구현 시작 | `DOCS/ACTIVE/PLAN-20261125-01_excel-visible-columns.md` |
| 2026-11-25 14:32 | 롤백 | 사용자 지시(아직 코드 변경 금지)로 착수 중이던 코드 변경(범위 E: `blueprints/ITMA.py` 스펙 값 삭제 헬퍼, `static/js/spec-forms-admin.js` 확인 문구)을 커밋 전 되돌림. 상태 계획으로 환원, 계획 문서 작성만 진행 | `blueprints/ITMA.py`, `static/js/spec-forms-admin.js` |
| 2026-11-25 14:51 | 시작 | 사용자 승인("계획 문서대로 진행, 버전 1.3.0", 재시작 중 수 초 끊김 허용). 상태 진행중, 구현 시작 | `DOCS/ACTIVE/PLAN-20261125-01_excel-visible-columns.md` |
| 2026-11-25 15:00 | 수정 | [E] 스펙 폼 삭제·항목 제거 저장 시 연결된 자산 값 DB 삭제(`_delete_spec_values_for_form_items`), 응답·감사 로그에 건수, 관리자 확인 문구 | `blueprints/ITMA.py`, `static/js/spec-forms-admin.js` |
| 2026-11-25 15:00 | 수정 | [A·B] 다운로드 컬럼 구성(`_resolve_excel_columns`: columns/기본 형식 26), 행 데이터(`_load_excel_asset_rows`), 엑셀 생성(`_build_assets_workbook`: 번호 1..N·연결된 스펙 값·사용자 정의 값·`_columns` 숨김 시트), 다운로드 2종을 `_send_assets_excel`로 교체, 고정 양식 함수 4개 삭제 | `blueprints/ITMA.py` |
| 2026-11-25 15:00 | 수정 | [C] 템플릿 기본 형식 26 고정 명시·헤더 색상 공통 상수 | `blueprints/ITMA.py` |
| 2026-11-25 15:00 | 수정 | [D] 업로드 `_columns`/헤더 이름으로 스펙·사용자 정의 컬럼 인식(`_match_upload_extra_columns`), 카테고리 스펙만·컬럼 관리 권한자만 저장, 결과 메시지에 저장·제외·무시 건수 | `blueprints/ITMA.py` |
| 2026-11-25 15:00 | 수정 | 화면: 엑셀 안내 모달, 다운로드(선택/모든) → 안내창(사용자 지정/기본) → 다운로드, 업로드 버튼 → 안내창 → 업로드 창 | `static/js/itma-handler.js`, `templates/ITMA/sections/itma_page.html`, `static/css/itma.css` |
| 2026-11-25 15:00 | 결정 | 업로드 안내창을 업로드 창 열기 전에 표시(모달 겹침 방지) — 계획 문서 결과에 반영 | `static/js/itma-handler.js` |
| 2026-11-25 15:00 | 이슈 | `itma_page.html`에 기존 BOM 발견 → 제거(내용 변경 없음). 셸 sed로 수정 시 줄바꿈 문자(\n)·CRLF가 바뀌는 문제 2회 발생 → Edit 도구·바이트 단위로 복구 | `templates/ITMA/sections/itma_page.html`, `static/js/spec-forms-admin.js` |
| 2026-11-25 15:00 | 검증 | Python AST, `node --check` itma-handler.js·spec-forms-admin.js 통과. 컨테이너 내부 통합 테스트 23/23 PASS(쓰기 전부 롤백, 감사 로그 비활성) — 롤백 후 테스트 데이터 잔존 0건 확인 | |
| 2026-11-25 15:00 | 수정 | `?v=20261125b`, VERSION 1.3.0, CHANGELOG [1.3.0], AGENTS.md 엑셀 설명. 웹 컨테이너 재시작, `/login` 200 | `VERSION`, `CHANGELOG.md`, `AGENTS.md`, 템플릿 5종 |
| 2026-11-25 15:00 | 완료 | COMPLETE로 이동, v1.3.0 (화면 확인은 사용자 대기) | `DOCS/COMPLETE/PLAN-20261125-01_excel-visible-columns.md` |
