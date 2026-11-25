# CHANGELOG

ONE ITMA 변경 이력입니다. 버전 규칙과 작성 양식은 `AGENTS.md`의 "버전 관리 규칙"을 따릅니다.
최신 버전이 위에 오도록 작성합니다. 현재 버전은 `VERSION` 파일과 같아야 합니다.

## [Unreleased]
- (다음 변경 사항을 여기에 먼저 적고, 배포 시 버전 번호를 붙입니다)

## [1.3.0] - 2026-11-25 ([PLAN-20261125-01])
### 추가
- itma: 엑셀 다운로드 안내창 — 다운로드 › 선택 항목/모든 항목 선택 후 안내창에서 **사용자 지정 항목**(자산 목록에 표시된 항목·순서 그대로, 관리 버튼 제외) 또는 **기본 항목**(기본 형식 26개) 선택, 들어갈 항목 목록 표시 (`static/js/itma-handler.js` `openExcelNotice`·`downloadAll`·`downloadSelected`, `templates/ITMA/sections/itma_page.html`, `static/css/itma.css`)
- itma: 엑셀 업로드 전 안내창 — 반영 규칙(기본 형식 + 현재 서버의 상세 스펙·사용자 정의 컬럼만, 삭제·알 수 없는 컬럼 무시) 안내 후 업로드 창 표시
- itma: 업로드 시 상세 스펙(자산 카테고리의 스펙 폼 항목만)·사용자 정의 컬럼(컬럼 관리 권한자만) 값 저장. 다운로드 파일의 숨김 시트 `_columns`(열 → 컬럼 키)로 같은 이름 컬럼 구분, 없으면 헤더 이름으로 매칭. 결과 메시지에 저장·제외·무시 건수 (`blueprints/ITMA.py` `_match_upload_extra_columns`, `upload_assets`)
### 변경
- itma: 엑셀 다운로드 컬럼을 고정 양식(기본 16 + 장비 상세 26 + `상세스펙_*`) → `columns`(사용자 지정) 또는 기본 형식 26개로 변경. 헤더·값 형식은 자산 목록과 같게, **번호는 엑셀 안에서 1부터** (`_resolve_excel_columns`, `_load_excel_asset_rows`, `_build_assets_workbook`, `_send_assets_excel`)
- itma: 상세 스펙 컬럼은 현재 활성 스펙 폼 항목만, 값은 폼 항목에 연결된 값만 — 이전 버전·삭제된 폼·직접 입력 스펙 행은 엑셀에 나오지 않음. 사용자 정의 컬럼도 현재 컬럼만
- itma: 업로드 템플릿을 기본 형식 26개로 고정 명시, 헤더 색상 공통화 (`download_template`)
- admin: 스펙 폼 삭제·항목 제거 저장 시 연결된 자산 값도 DB에서 함께 삭제, 확인 문구·결과 메시지에 삭제 건수, 감사 로그 기록 (`blueprints/ITMA.py` `_delete_spec_values_for_form_items`, `static/js/spec-forms-admin.js`)
- `?v=`: `itma-handler.js`·`itma.css`·`spec-forms-admin.js` 20261125b
### 삭제
- itma: 고정 다운로드 양식 함수 `_rows_to_dataframe`, `_load_export_spec_columns`, `_load_export_spec_values`, `_export_spec_header` (새 함수로 대체). 다운로드에서 목록에 없는 장비 상세 17개 항목(장비상태·납품업체·유지보수·구매일시·내구연한·인증 등) 제외
### DB
- 스키마 변경 없음. 데이터: 스펙 폼·항목 삭제 시 연결된 `itma_asset_spec_items` 행 삭제(앱 코드). 기존 연결 끊긴 값 0건 확인 → 마이그레이션 불필요
### 검증
- 컨테이너 내부 통합 테스트 23/23 PASS(전 과정 롤백): 기본 항목 26컬럼·번호 1..N·`_columns` 숨김 시트, 파라미터 없음 = 기본 항목, 사용자 지정 순서·이름(관리·모르는 키 제외), 연결 없는 스펙 행 제외, 사용자 정의 값, 유효 컬럼 없음 400, 다운로드 파일 재업로드(스펙 4·사용자 정의 1 저장, `상세스펙_*` 무시), 이전 양식 업로드, 템플릿 26컬럼, 항목 제거·폼 삭제 시 값 삭제·직접 입력 행 유지·삭제한 폼 컬럼 제외
- Python AST·`node --check`(itma-handler.js, spec-forms-admin.js) 통과

## [1.2.0] - 2026-11-25 ([PLAN-20261112-02], [PLAN-20261117-01], [PLAN-20261124-01], [PLAN-20261124-02], [PLAN-20261124-03])
> 진행 중이던 5개 계획을 사용자 요청에 따라 1.2.0 한 버전으로 묶어 확정 (계획별 예정 버전 1.2.0·1.2.1·1.2.2·1.3.0·1.3.1)
### 추가
- itma: 화면 구성 개편 — `/itma/` = 자산 현황 대시보드(권한 범위 집계, 운영상태·사업장 분포), `/itma/assets/page` = 자산 관리(목록), `/itma/assets/new`·`/itma/assets/<id>/edit` = 자산 추가/수정 전용 화면(저장 버튼으로만 저장). API `form-options`·`form-data`·`save`·`dashboard/summary` 추가 (`blueprints/ITMA.py`, `templates/ITMA/dashboard.html`, `templates/ITMA/asset_form.html`, `static/js/itma-dashboard.js`, `static/js/itma-asset-form.js`) [PLAN-20261112-02]
- itma: 자산 사업장(`site`) 항목 추가 — 목록 사업장 탭 조회, 추가/수정 화면, 엑셀 템플릿·업로드·다운로드, 일괄 수정, 삭제/복원 이력에 반영 [PLAN-20261112-02]
- itma: 자산 추가/수정 화면 `상세 스펙` 영역 — 카테고리의 스펙 폼 중 하나를 선택해 항목 값 입력(저장 값이 있는 폼 자동 선택, 폼이 1개면 자동 선택), 다른 폼으로 바꿔 저장하면 이전 폼 값 삭제·이력 기록. `form-data` 응답 `spec`, `/assets/save`의 `spec`·`spec_form_id` (`blueprints/ITMA.py` `_save_asset_form_spec_values`, `static/js/itma-asset-form.js`) [PLAN-20261124-02, PLAN-20261124-03]
### 변경
- itma: 자산 목록 읽기 전용(칸 직접 수정 제거), 번호 = 조회 결과 기준 순번, 행마다 '상세정보'·'수정/보기' 버튼, 선택형 필터 정확 일치, 대시보드 링크 조건(`?site`, `?status`). 일괄 수정·엑셀 업로드·선택 삭제는 유지, '행 추가' → '자산 추가' (`static/js/itma-handler.js`, `templates/ITMA/index.html`, `templates/ITMA/sections/itma_page.html`) [PLAN-20261112-02]
- itma: 운영상태 O/X → 정상/사용/미사용/교체/폐기 선택식, 장비상태와 같은 값 체계로 동기화 [PLAN-20261112-02]
- itma: 자산 목록 스펙 폼 컬럼명을 `카테고리 / 폼명 / 항목명` 대신 항목명(예: `CPU`)만 표시 (`_load_visible_spec_columns`) [PLAN-20261124-01]
- itma: 상단 메뉴 '자산 관리'를 드롭다운(대시보드/자산 목록/자산 추가)으로 변경, '메인화면' 버튼은 드롭다운으로 흡수하고 로고를 메인 링크로 변경 (`templates/base.html`, `static/css/common.css`) [PLAN-20261117-01]
- admin: 상단 메뉴 '관리화면'을 관리자 사이드바와 같은 그룹 구성의 드롭다운으로 변경, 관리 화면에서도 항상 표시, URL 해시 변경 시 해당 섹션으로 전환 (`templates/base.html`, `static/js/admin.js`) [PLAN-20261117-01]
- `?v=`: `common.css`·`admin.js` 20261117a, `itma-handler.js`·`itma-dashboard.js` 20261112a, `itma.css`·`itma-asset-form.js` 20261124b(`dashboard_live.html` 포함), `base_common.js` 20261125a(신규 부여)
### 수정
- auth: 세션 타임아웃 설정이 반영되지 않던 문제 — 화면 자동 호출(서버시간·시스템상태·세션목록·통계)이 활동시간을 갱신하던 것을 제외, 만료 시 API는 401 JSON·화면은 로그인 페이지로 이동 (`app.py`, `static/js/base_common.js`) [PLAN-20261112-02]
- itma: 삭제 이력 복원 시 자산번호가 다르게 표시·복원되던 문제 — `asset_code`·`asset_id`·입력일 보존(번호 사용 중이면 새 번호+안내), 이력 화면 '번호' → '자산번호' [PLAN-20261112-02]
- itma: user 권한 계정에 사용자 정의 컬럼 입력·삭제가 노출되던 문제 — 컬럼 관리 권한자만 표시·저장 [PLAN-20261112-02]
### DB
- `itma_assets.site VARCHAR(100)` 추가 (`ADD COLUMN IF NOT EXISTS`, 자동)
- `itma_assets.usage_status` VARCHAR(1) → VARCHAR(20), 기본값 '사용', 기존 O→사용·X→미사용 자동 변환 (기동 시 1회성, 재실행 안전)
### 검증
- PLAN-20261112-02: 임시 DB + Flask test client 38/39 PASS, jsdom 화면 점검 34/34 PASS, 사용자 화면 확인
- PLAN-20261117-01: Jinja 템플릿 파싱, 권한별 메뉴 렌더링, 사용자 화면 확인
- PLAN-20261124-01~03: Python·JS 문법 검사, 스펙 API 200, 스펙 저장 헬퍼 롤백 테스트(추가·수정·비우기·폼 변경 시 이전 값 삭제·이력)

## [1.1.0] - 2026-11-12 ([PLAN-20261112-01])
### 변경
- itma: 일괄등록 템플릿을 자산관리 화면 기본 표시 컬럼 25개와 같은 이름·순서로 변경 — 기본 정보 16 / 장비 정보 6 / 장비 상세 3, 그룹별 헤더 색상, 자동 입력 컬럼(번호·수정 일시·수정자) 회색 표시, `작성 안내` 시트 추가 (`blueprints/ITMA.py` `download_template`)
- itma: 업로드 컬럼을 헤더 이름으로만 인식(열 위치 추정 제거), 새 양식 헤더와 이전 양식 헤더(구분/자산ID/시리얼번호/사용여부/상세_*) 모두 인식 (`_normalize_columns`)
- itma: 시리얼 중복 검사 대상을 기본 정보 시리얼 + 장비 상세 Serial Number로 확대 (`upload_assets`)
### 추가
- itma: 업로드 시 장비 정보(그룹·사용자·직급·네트워크 구분·IP/Subnet·Mac address)와 장비 상세(장비명·OS/Version·Serial Number)를 `itma_asset_details`에 저장 (`upload_assets`)
### 수정
- itma: 숫자로 입력된 값(예: 시리얼 333)이 `333.0`으로 저장될 수 있던 문제 방지 (`_clean_excel_text`)
### 검증
- 템플릿 25컬럼·안내 시트, 빈 양식 오류 문구, 새 양식 기본·장비 정보 저장, 자동 입력 컬럼만 있는 행 건너뜀, 중복 3종 건수, 이전 양식 업로드 (모의 DB)

## [1.0.4] - 2026-11-11 ([PLAN-20261111-01])
### 변경
- itma: 엑셀 일괄등록 시 모든 항목 빈칸 허용 — 품명 필수 조건 제거, 모든 칸이 빈 행만 건너뜀 (`blueprints/ITMA.py`)
- itma: 업로드 결과를 "추가 N건 / 자산번호 중복으로 미업로드 N건 / 시리얼번호 중복으로 미업로드 N건"으로 구분 표시, 응답에 `skipped_asset_id_duplicates`·`skipped_serial_duplicates` 추가 (`blueprints/ITMA.py`, `static/js/itma-handler.js`)
- itma: 데이터 행이 없는 파일 메시지를 "업로드 파일에 데이터가 없습니다."로 변경 (`blueprints/ITMA.py`)
### 수정
- itma: 중복 팝업 표 머리글이 실제 컬럼과 다르던 문제 수정 — 행/중복 항목/중복 대상/값/품명 (`templates/ITMA/sections/itma_page.html`)
### 검증
- 품명·자산ID 빈칸 행 업로드, 완전 빈 행 건너뜀, DB·파일 내 자산번호 중복과 시리얼번호 중복 건수 분리, 빈 파일 메시지 (모의 DB)

## [1.0.3] - 2026-11-06 ([PLAN-20261106-02])
### 추가
- tools: `tools/cleanup/email_reset.bat` + `email_reset.sql`(SMTP 설정 초기화 후 web 재시작)
- tools: `tools/cleanup/docker_info.bat`(컨테이너·마운트 정보 조회), `restart_web.bat`(web·nginx 재시작), `README_사용안내.txt`(배치 파일 설명)
### DB (데이터만, 스키마 변경 없음)
- `email_settings` 초기화: 테스트 SMTP 설정(spamout.jininfra.com:25) 삭제 → web 재시작 시 기본값(서버·계정 빈 값, 포트 587, TLS 꺼짐)으로 재생성
- 초기화 전 백업: `backups/before_test_cleanup_20261106_095527.sql`
### 검증
- 재시작 후 `email_settings` 1행(기본값) 확인, Gunicorn 정상 기동, 로그 `Email settings loaded: :587`

## [1.0.2] - 2026-11-06 ([PLAN-20261106-01])
### 추가
- tools: 테스트 데이터 정리 스크립트 `tools/cleanup/` — `01_backup.bat`(DB 백업), `02_inspect.bat`+`inspect.sql`(읽기 전용 조회), `03_delete.bat`+`delete.sql`(단일 트랜잭션 삭제), `restore.bat`(백업 복원)
### DB (데이터만, 스키마 변경 없음)
- 테스트 데이터 삭제: admin 외 계정 7개, 권한 그룹 1개, 자산 4건(하위 데이터 포함), 자산 이력 293건, 스펙 양식 2개, 감사 로그 285건, 접속 로그 72건, 이메일 로그 3건
- 자산·이력·양식·그룹·로그 일련번호(ID) 초기화
- 유지: admin 계정, 카테고리 11개, 이메일 템플릿 5개, 이메일·보안·시스템 설정
- 정리 전 백업: `backups/before_test_cleanup_20261106_092251.sql`
### 검증
- 삭제 전/후 건수 비교(`tools/cleanup/output/delete.txt`), admin 계정 존재 확인

## [1.0.1] - 2026-11-04 ([PLAN-20261104-01])
### 추가
- docs: 작업 문서 관리 폴더 `DOCS/` 신설 — `ACTIVE/`(진행 계획), `COMPLETE/`(완료 계획), `LOGS/`(작업 로그), `TEMPLATES/`(양식), `README.md`(작업 목록)
- docs: 계획·로그 양식 `DOCS/TEMPLATES/PLAN_TEMPLATE.md`, `LOG_TEMPLATE.md`
### 변경
- docs: AGENTS.md에 "작업 문서화 규칙" 추가(계획 작성 → 실행 로그 → 완료 시 COMPLETE 이동), 체크리스트·금지사항·구조표 갱신
### 검증
- 폴더·파일 생성, UTF-8(BOM 없음) 확인, 계획 문서 COMPLETE 이동 확인

## [1.0.0] - 2026-11-04
기준선(Baseline) 버전. 이 시점의 코드를 1.0.0으로 지정하고 이후 변경부터 버전을 기록합니다.

### 현재 기능 구성
- auth: 로그인/로그아웃, 비밀번호 찾기·초기 설정·강제 변경, 프로필, 전역/계정별 IP 필터, 비밀번호 정책
- itma: 카테고리 관리(추가/정렬/삭제), 자산 CRUD·일괄수정, 자산 상세(납품·장비·보안·SW·라이선스 이력), 사용자 정의 컬럼, 카테고리별 스펙 양식, 엑셀 업로드/템플릿/다운로드, 변경 이력·복원, 토큰 기반 실시간 대시보드
- admin: 사용자·일괄등록, 권한 그룹(RBAC, 카테고리별 조회/편집), 보안·세션 정책, 접속/감사 로그, 이메일(SMTP·템플릿·주소록·발송), 웹서버·SSL·로그인 페이지 설정, DB 백업/복원, 시스템 상태·스토리지 관리
- infra: Docker Compose(PostgreSQL 15 + Gunicorn/Flask + Nginx), `TLS_MODE=internal` 내부 CA 자동 발급

### 정적 파일 버전(`?v=`) 현황
- `admin.css` 20261007b, `admin.js` 20261007a, `login-page-settings.js` 20260914a, `user-manager.js` 20260703b, `spec-forms-admin.js` 20261007f
- `itma.css` 20260914a(index) / 20260427a(dashboard_live), `itma-handler.js` 20261007b

### DB
- 마이그레이션: `migrations/2026-04-24_rbac_legacy_db_backfill.sql`

### 문서
- docs: AGENTS.md를 현재 구조 기준으로 갱신(존재하지 않는 `project.py`, `workcalendar.py` 제거, 기능 맵·DB·버전 규칙 추가)
- docs: `VERSION`, `CHANGELOG.md` 신설
- docs: 분석 중 발견한 주의 사항 7건을 AGENTS.md에 기록(코드 미수정)
