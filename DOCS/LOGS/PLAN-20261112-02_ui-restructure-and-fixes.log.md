# [PLAN-20261112-02] 작업 로그

- 계획 문서: `DOCS/ACTIVE/PLAN-20261112-02_ui-restructure-and-fixes.md` (완료 후 `DOCS/COMPLETE/`)

| 일시 | 구분 | 내용 | 관련 파일 |
|------|------|------|----------|
| 2026-11-12 17:48 | 시작 | 요청 접수(화면 구성·추가/수정 페이지·사업장 조회·목록 개선 3·버그 3) | |
| 2026-11-12 17:51 | 결정 | 작업 대상 폴더를 `Project_flask_ITMA_V1.1`(v1.1.0)로 변경 — 사용자 지시 | |
| 2026-11-12 17:58 | 결정 | 사용자 확정: 사업장 항목 신규 추가 / 운영상태 5종(정상·사용·미사용·교체·폐기) / 목록 일괄 수정·업로드·삭제 유지 / 추가·수정 페이지 = 기본+장비 정보 | |
| 2026-11-12 18:00 | 시작 | 계획 문서 작성, 상태 진행중 | `DOCS/ACTIVE/PLAN-20261112-02_ui-restructure-and-fixes.md` |
| 2026-11-12 18:02 | 수정 | 작업 전 코드 압축 백업 | `RELEASES/ITMA_v1.1.0_code_20261112.zip` |
| 2026-11-12 18:10 | 수정 | [버그] 세션 타임아웃: 원인 = 화면 자동 호출(서버시간 30초, 시스템상태 30초, 세션목록·통계 60초)이 활동시간을 계속 갱신. 해당 4개 endpoint는 활동시간 갱신 제외, 만료 시 API는 401 JSON, 화면은 401/로그인 리다이렉트 감지 시 로그인 페이지로 이동 | `app.py`, `static/js/base_common.js` |
| 2026-11-12 18:20 | 수정 | [버그] 삭제 이력 복원: 원인 = 복원 시 자산번호(asset_code)·자산ID·입력일을 되살리지 않고, 이력 화면은 화면 순번/DB 내부 id를 표시. 복원 시 asset_code·asset_id·input_at 보존(번호 사용 중이면 새 번호+안내), 이력 조회에 asset_code 포함, 이력 화면 '번호'→'자산번호' | `blueprints/ITMA.py`, `static/js/itma-handler.js`, `templates/ITMA/index.html` |
| 2026-11-12 18:22 | 결정 | 줄바꿈이 섞여 있던 `itma-handler.js`, `index.html`을 다수 형식(CRLF)으로 통일 — 내용 변경 없음 | |
| 2026-11-12 18:25 | 수정 | [버그] 사용자 정의 컬럼: 서버는 권한 검사 중이나 화면이 입력 칸·삭제 버튼을 모두에게 표시. 삭제 버튼·추가·서버 순서 저장을 컬럼 관리 권한자에게만 허용(값 입력 칸은 목록 읽기 전용 전환 시 함께 처리) | `static/js/itma-handler.js` |
| 2026-11-12 18:40 | 수정 | [운영상태] O/X → 정상/사용/미사용/교체/폐기. 컬럼 VARCHAR(1)→VARCHAR(20), 기본값 '사용', 기존 O→사용·X→미사용 자동 변환, 이전 값(O/X/Y/N) 입력도 인식. 장비상태와 같은 값 체계로 동기화 | `blueprints/ITMA.py`, `models/database.py` |
| 2026-11-12 18:45 | 수정 | [사업장] `itma_assets.site` 추가, 목록·검색·엑셀 템플릿/업로드/다운로드·단건/일괄 수정·삭제/복원 이력에 반영 | `blueprints/ITMA.py` |
| 2026-11-12 18:55 | 수정 | [화면 구성] `/itma/` = 대시보드(권한 범위 집계, 운영상태 5종·사업장 분포), `/itma/assets/page` = 자산 관리, `/itma/assets/new`·`/<id>/edit` = 추가/수정, API `form-options`·`form-data`·`save`·`dashboard/summary` 추가 | `blueprints/ITMA.py`, `templates/ITMA/dashboard.html`, `templates/ITMA/asset_form.html`, `static/js/itma-dashboard.js`, `static/js/itma-asset-form.js` |
| 2026-11-12 19:05 | 수정 | [목록] 읽기 전용 렌더링, 번호 = 조회 결과 기준 순번, 관리 컬럼(상세정보·수정/보기), 사업장 탭, 선택형 필터 정확 일치, 대시보드 링크 조건(?site, ?status), 상단 메뉴에 '자산 관리' | `static/js/itma-handler.js`, `templates/ITMA/index.html`, `templates/ITMA/sections/itma_page.html`, `templates/base.html`, `static/css/itma.css` |
| 2026-11-12 19:10 | 결정 | 목록의 일괄 수정·엑셀 업로드·선택 삭제는 유지(사용자 확정). '행 추가'는 '자산 추가'(추가 화면 이동)로 변경 | |
| 2026-11-12 19:15 | 이슈 | 문법 검사 중 `py_compile`이 프로젝트 폴더에 `__pycache__`를 생성함(앱 동작 영향 없음, Docker는 PYTHONDONTWRITEBYTECODE=1). 이후 점검은 `python -B`로 실행 | `__pycache__/` |
| 2026-11-12 19:30 | 검증 | 실제 DB 백업(`backup_20261112_133456.sql`)을 복원한 임시 PostgreSQL + Flask test client 점검 38/39 PASS(1건은 점검 스크립트 문구 기준 오류, 동작 정상) — 화면·저장·중복·권한·이력·복원·세션·엑셀 | 임시 환경(작업 PC 내부) |
| 2026-11-12 19:40 | 검증 | jsdom 화면 점검 34/34 PASS — 대시보드, 목록(읽기 전용·순번·관리 버튼·사업장 탭·정확 일치 필터·상세정보 버튼·URL 조건), user 권한 화면, 추가/수정 저장 | 임시 환경 |
| 2026-11-13 08:57 | 이슈 | 반영 전 확인용 `docker_info.bat` 실행 시 Windows 보안 경고(게시자 확인 불가) 표시 — 보안 확인은 사용자가 직접 승인하도록 요청하고 대기. 기존 결과 파일(11-11)상 Docker는 `Project_flask_ITMA` 폴더 기준으로 실행 중이었음 → 최신 실행 위치 재확인 필요 | `tools/cleanup/docker_info.bat` |
| 2026-11-17 11:33 | 결정 | 보류 유지(화면 검증·버전 확정 대기). 후속 요청 상단 메뉴 드롭다운은 별도 계획 PLAN-20261117-01로 진행 | |
| 2026-11-25 09:56 | 검증 | 사용자 확인: 화면 검증 완료("진행된 상태") | |
| 2026-11-25 09:57 | 결정 | 사용자 요청으로 PLAN-20261112-02·20261117-01·20261124-01~03을 1.2.0 한 버전으로 확정(계획별 예정 1.2.0~1.3.1 통합) | `CHANGELOG.md`, `VERSION` |
| 2026-11-25 09:57 | 수정 | `VERSION` 1.2.0, CHANGELOG `[1.2.0]` 작성, `base_common.js` `?v=20261125a` 신규 부여, `dashboard_live.html` `itma.css` `?v=20261124b`, AGENTS.md 기능 맵·`?v=` 위치 갱신 | `VERSION`, `CHANGELOG.md`, `templates/base.html`, `templates/ITMA/dashboard_live.html`, `AGENTS.md` |
| 2026-11-25 09:58 | 검증 | `node --check`(node:20 컨테이너) admin.js·itma-handler.js·itma-dashboard.js·base_common.js·itma-asset-form.js, Python AST app.py·ITMA.py·database.py 통과 | |
| 2026-11-25 09:58 | 완료 | COMPLETE로 이동, v1.2.0 | `DOCS/COMPLETE/PLAN-20261112-02_ui-restructure-and-fixes.md` |
