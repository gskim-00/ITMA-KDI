# CHANGELOG

ONE ITMA 변경 이력입니다. 버전 규칙과 작성 양식은 `AGENTS.md`의 "버전 관리 규칙"을 따릅니다.
최신 버전이 위에 오도록 작성합니다. 현재 버전은 `VERSION` 파일과 같아야 합니다.

## [Unreleased]
- (다음 변경 사항을 여기에 먼저 적고, 배포 시 버전 번호를 붙입니다)

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
