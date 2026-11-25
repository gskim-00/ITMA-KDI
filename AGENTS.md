# AGENTS.md

> 문서 버전: v1.0.3 · 최종 갱신: 2026-11-25
> 현재 프로그램 버전은 `VERSION` 파일, 변경 이력은 `CHANGELOG.md`, 작업 계획·로그는 `DOCS/`를 기준으로 합니다.

## 목적
이 문서는 이 저장소에서 작업하는 사람/에이전트가 일관된 방식으로 코드를 수정하고 검증하기 위한 작업 기준입니다.
작업 전 이 문서 → `DOCS/ACTIVE/`(진행 중인 계획) → `CHANGELOG.md` 최신 항목 → 관련 소스 순서로 확인합니다.

## 시스템 개요
- **ONE ITMA**: IT 자산(PC·프린터·SW·라이선스·HW·네트워크·보안·서버·솔루션·클라우드·기타) 관리 웹 서비스
- 구성: Nginx(HTTPS 종단) → Gunicorn(Flask, 워커 4, 타임아웃 120s) → PostgreSQL 15
- 접속 흐름: `/` → `/itma/` (미로그인 시 `/login`, 권한 그룹 미배정 시 `/access-pending`)
- 레거시 경로 `/project/*`는 `/itma/`로 리다이렉트, `/public/calendar/<token>.ics`는 410(서비스 종료) 응답

## 프로젝트 구조
| 경로 | 역할 | 비고 |
|------|------|------|
| `app.py` | 앱 생성, Blueprint 등록, DB 설정 로드, 세션 타임아웃/HTTPS 리다이렉트/CSRF 토큰 주입 | 기동 시 `init_db()` + `system_settings`/`email_settings` 로드 |
| `config.py` | `.env` 기반 설정(`Config`), `email_config` | 업로드 기본 100MB, 허용 확장자 정의 |
| `blueprints/auth.py` | 로그인, 비밀번호 찾기/초기 설정/강제 변경, 프로필, 로그아웃 | IP 필터·비밀번호 정책·CSRF 검증 포함 |
| `blueprints/admin.py` (`/admin`) | 관리자 전 기능 (약 4,000줄) | 아래 "관리자 기능" 참고 |
| `blueprints/ITMA.py` (`/itma`) | 자산관리 핵심 기능 (약 5,100줄) | `_ensure_itma_table()`이 ITMA 테이블 생성/마이그레이션 담당 |
| `models/database.py` | `get_db_connection()`, `init_db()` (공통 테이블·인덱스 생성) | psycopg2 직접 사용 (ORM 미사용) |
| `services/email_service.py` | `send_email()`, `test_email_connection()` | |
| `utils/helpers.py` | `log_audit`, `get_client_ip`, IP 파싱/검증(`parse_ip_entries`, `is_ip_in_entries` 등), `paginate`, `sanitize_filename` | 신규 유틸 작성 전 반드시 확인 |
| `templates/` | `base.html`, `login.html`, `admin.html`, `ITMA/dashboard.html`, `ITMA/index.html`, `ITMA/asset_form.html`, `ITMA/dashboard_live.html` 등 | 화면 조각은 `*/sections/` 하위 |
| `static/css/` | `common.css`, `login.css`, `admin.css`, `itma.css` | |
| `static/js/` | `itma-handler.js`(ITMA 화면 전체, 약 5,000줄), `admin.js` + 기능별 관리자 JS | |
| `migrations/` | 기존 DB 보정용 수동 SQL (`2026-04-24_rbac_legacy_db_backfill.sql`) | 파일명 `YYYY-MM-DD_설명.sql` |
| `infra/nginx/` | Nginx 이미지, HTTPS 템플릿, 인증서 생성 스크립트(`start-nginx.sh`) | `TLS_MODE=internal`이면 내부 CA/서버 인증서 자동 생성 |
| `uploads/`, `backups/` | 업로드 파일, DB 백업 | |
| `DOCS/` | 작업 계획(`ACTIVE`/`COMPLETE`), 작업 로그(`LOGS`), 양식(`TEMPLATES`) | 아래 "작업 문서화 규칙" |
| `VERSION`, `CHANGELOG.md` | 현재 버전, 변경 이력 | 아래 "버전 관리 규칙" |

> 이전 문서에 있던 `blueprints/project.py`, `blueprints/workcalendar.py`는 현재 존재하지 않습니다(ITMA로 이관 완료).

## 주요 기능 맵

### 인증 (`auth_bp`, prefix 없음)
- `/login`, `/logout`, `/forgot_password`, `/access-pending`
- `/password_setup`, `/force_change_password` (세션 `force_password_change` 시 다른 경로 차단 — `app.py`)
- `/profile`, `/profile/update`, `/change_pw`
- 로그인 통과 조건: 전역 IP 필터(`security_settings`) **AND** 계정별 허용 IP(`users.allowed_ip_list`)

### ITMA (`itma_bp`, `/itma`)
- 화면: `/itma/` (자산 현황 대시보드, 데이터 `/dashboard/summary`), `/itma/assets/page` (자산 목록, 읽기 전용), `/itma/assets/new`·`/itma/assets/<id>/edit` (추가/수정 화면 — `itma-asset-form.js`)
- 추가/수정 화면 API: `/assets/form-options`, `/assets/<id>/form-data`, `/assets/save` (기본·장비 정보 + 사용자 정의 컬럼 + 상세 스펙 `spec`·`spec_form_id`)
- 상단 메뉴: '자산 관리'(대시보드/자산 목록/자산 추가)·'관리화면'(관리자 섹션) 드롭다운 — `templates/base.html`
- 카테고리: `/categories` (조회/추가/정렬 `reorder`/삭제)
- 자산: `/assets` 조회, `/assets/new-row`, `/assets/<id>` PATCH, `/assets/batch-update`, `/assets/delete`
- 상세: `/assets/<id>/details` (GET/POST), `/details/field` PATCH, `/spec-items/<form_item_id>` PATCH
- 사용자 정의 컬럼: `/custom-columns` (조회/추가/삭제/정렬/값 수정)
- 스펙 양식: `/spec-forms` (카테고리별 동적 스펙 폼 — `ITMA_DYNAMIC_SPEC_FORM_CATEGORIES`)
- 엑셀: `/assets/upload`, `/assets/template-download`, `/assets/download`, `/assets/download-selected`
  - 기본 형식 26개 고정(`ITMA_UPLOAD_TEMPLATE_COLUMNS`, 기본 정보 17 / 장비 정보 6 / 장비 상세 3) = 템플릿·'기본 항목' 다운로드
  - 다운로드는 `columns=키,...`(목록 표시 항목 = '사용자 지정 항목') 또는 `preset=basic`, 번호는 엑셀 순번, 숨김 시트 `_columns`에 열→컬럼 키
  - 상세 스펙·사용자 정의 컬럼은 현재 서버에 있는 것만, 스펙 값은 폼 항목 연결 값만. 스펙 폼(항목) 삭제 시 연결된 자산 값도 DB에서 삭제
- 이력: `/history`, `/history/<id>/restore`
- 대시보드: `/dashboard/open` → 토큰 발급 → `/dashboard/live?token=…&refresh=5|10|30|60`, 데이터 `/dashboard/data` (**토큰만으로 비로그인 접근 가능**)
- 권한: `_require_itma_role()` + 카테고리별 `can_view`/`can_edit` (`_can_view_category`, `_can_edit_category`)
- 변경 요청(POST/PATCH/DELETE)은 `_enforce_csrf_for_mutating_itma_requests()`로 CSRF 검증

### 관리자 (`admin_bp`, `/admin`)
- 사용자: 추가/일괄등록(엑셀 템플릿)/수정/삭제/일괄삭제/비밀번호 초기화/목록
- 권한 그룹(RBAC): `/permission-groups` (그룹 ↔ 카테고리 조회·편집 권한 ↔ 사용자)
- 보안: `/update_security_settings`, `/get_security_settings`, 세션 관리(`/sessions/*`)
- 로그: 접속 로그(`/access_logs`), 감사 로그(`/audit/logs|statistics|export`)
- 이메일: SMTP 설정/테스트, 템플릿, 주소록, 발송, 최근 발송 이력
- 웹서버: `/web_server/update`, `/web_server/upload_ssl`, 로그인 페이지 문구/로고 설정
- 백업: `/backup/create|list|download|delete|restore|settings|tools` (`pg_dump`/`psql` 사용)
- 시스템: `/system/status|db_test|thresholds`, 스토리지(`/storage/*`)

## 데이터베이스
- 공통 테이블(`models/database.py`): `users`, `access_logs`, `audit_logs`, `email_logs`, `email_settings`, `email_templates`, `address_book`, `security_settings`, `system_settings`, `backup_history`, `permission_groups`, `permission_group_categories`, `user_permission_groups`
- ITMA 테이블(`ITMA.py` `_ensure_itma_table()` 및 일부 `init_db()` 중복 정의): `itma_assets`, `itma_asset_history`, `itma_asset_details`, `itma_asset_detail_changes`, `itma_asset_delivery_changes`, `itma_asset_equipment_changes`, `itma_asset_security_changes`, `itma_asset_software_items`, `itma_asset_license_items`, `itma_custom_columns`, `itma_custom_column_values`, `itma_categories`, `itma_deleted_categories`, `itma_spec_forms`, `itma_spec_form_items`, `itma_asset_spec_items`
- 스키마 변경 원칙
  - `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`로 **기존 DB에서도 재실행 안전**하게 작성
  - 같은 테이블이 `init_db()`와 `_ensure_itma_table()` 양쪽에 있으면 **두 곳을 함께** 수정
  - 기존 운영 DB 보정이 필요하면 `migrations/YYYY-MM-DD_설명.sql` 추가 후 CHANGELOG에 기록
  - 컬럼 삭제(DROP)는 백업 확인 후에만, CHANGELOG에 `⚠️ DB` 표시

## 개발/실행 명령
- `docker compose up -d` / `docker compose up -d --build`: 실행 / 재빌드 후 실행
- `docker compose logs -f web`: 웹 앱 로그
- `docker compose restart web`: 코드 수정 반영(소스가 `.:/app`로 마운트됨)
- `docker compose down`: 종료 (`-v`는 DB 볼륨 삭제이므로 사용 금지)
- 포트: HTTP `30080`(→ HTTPS 301), HTTPS `30443`, DB `5432` (`.env`)
- 로컬(Windows): `python -m venv venv; .\venv\Scripts\activate; pip install -r requirements.txt; python app.py`
- 계정/IP 복구: `README_패스워드 분실&IP변경.md` 참고

## 작업 문서화 규칙 (DOCS) ⭐
모든 작업(기능 추가·수정·버그 수정·설정 변경·DB 변경)은 **코드를 수정하기 전에** 계획 문서를 먼저 작성합니다.
오탈자 1~2줄 수정처럼 아주 작은 변경도 로그는 남기고, 계획 문서는 간단히 작성합니다.

### 폴더 구조
```
DOCS/
├── README.md        # 폴더 설명 + 전체 작업 목록(인덱스)
├── ACTIVE/          # 진행 전·진행 중인 계획 문서 (상태: 계획, 진행중)
├── COMPLETE/        # 실행이 끝난 계획 문서 (상태: 완료, 취소)
├── LOGS/            # 작업별 실행 로그 (계획 문서와 같은 ID)
└── TEMPLATES/       # PLAN_TEMPLATE.md, LOG_TEMPLATE.md
```

### 파일 이름
- 계획: `DOCS/ACTIVE/PLAN-YYYYMMDD-NN_slug.md`
- 로그: `DOCS/LOGS/PLAN-YYYYMMDD-NN_slug.log.md`
- `NN`: 같은 날 두 자리 순번(01부터, ACTIVE·COMPLETE 모두 확인 후 다음 번호), `slug`: 영문 소문자·하이픈
- 모든 문서는 Markdown, UTF-8(BOM 없음)

### 작업 절차
1. **계획 (최초 실행 시)**
   - `DOCS/TEMPLATES/PLAN_TEMPLATE.md`를 복사해 `DOCS/ACTIVE/`에 계획 문서 작성 (상태: `계획`)
   - 목적, 범위, 영향 파일, 작업 단계(체크박스), DB 변경, 위험·복구, 검증 방법, 대상 버전 기재
   - `DOCS/TEMPLATES/LOG_TEMPLATE.md`를 복사해 `DOCS/LOGS/`에 로그 생성, 첫 줄 `시작` 기록
   - `DOCS/README.md` 작업 목록에 행 추가 (상태: 계획)
2. **실행**
   - 계획 문서 상태를 `진행중`으로 변경
   - 단계를 끝낼 때마다 계획 문서 체크박스 체크, 로그에 `일시 | 구분 | 내용 | 관련 파일` 한 줄 추가
   - 계획과 다르게 진행하면 로그에 `결정`으로 이유를 남기고 계획 문서도 수정
   - 오류·문제는 `이슈`, 되돌린 경우 `롤백`으로 기록
3. **완료**
   - 계획 문서 "8. 결과" 작성(실제 변경 파일, 계획 대비 차이, 확정 버전, 남은 과제), 상태 `완료`, 완료일 기입
   - `VERSION` / `CHANGELOG.md` / `?v=` 갱신, CHANGELOG 항목에 계획 ID 표기 (예: `([PLAN-20261104-01])`)
   - 계획 문서를 `DOCS/ACTIVE/` → `DOCS/COMPLETE/`로 **이동**(복사 아님), 로그는 `LOGS/`에 그대로 둠
   - 로그 마지막 줄 `완료` 기록, `DOCS/README.md` 작업 목록 상태·버전·경로 갱신
4. **취소·보류**
   - 취소: 사유를 결과에 적고 상태 `취소`로 `COMPLETE/` 이동, 로그에 `취소` 기록
   - 보류: `ACTIVE/`에 두고 상태는 `진행중` 유지, 로그에 보류 사유 기록

### 원칙
- 하나의 계획 문서 = 하나의 목적 = 하나의 버전 변경
- `ACTIVE/`에 오래 남은 문서가 있으면 새 작업 전에 상태를 먼저 정리
- 로그는 사실만 시간순으로 기록하고 이전 줄은 수정하지 않음(정정은 새 줄로)
- 비밀번호·키 등 민감 정보는 문서와 로그에 기록 금지

## 버전 관리 규칙 ⭐
### 버전 체계 (Semantic Versioning, `MAJOR.MINOR.PATCH`)
| 구분 | 올리는 경우 | 예 |
|------|------------|-----|
| MAJOR | DB 구조 비호환 변경, 기존 데이터/엑셀 양식 호환 깨짐, 대규모 개편 | 1.4.2 → 2.0.0 |
| MINOR | 신규 기능·화면·API 추가, 하위 호환되는 DB 컬럼/테이블 추가 | 1.4.2 → 1.5.0 |
| PATCH | 버그 수정, 문구·스타일 수정, 성능 개선, 문서 수정 | 1.4.2 → 1.4.3 |

### 변경 시 반드시 할 일
0. 작업 문서화 규칙에 따라 `DOCS/ACTIVE/` 계획 문서와 `DOCS/LOGS/` 로그가 있는지 확인
1. `VERSION` 파일의 버전 숫자 갱신 (한 줄, 예: `1.1.0`)
2. `CHANGELOG.md` 최상단에 새 항목 추가 (아래 양식)
3. 수정한 정적 파일(CSS/JS)을 불러오는 템플릿의 `?v=` 쿼리 갱신
   - 형식: `?v=YYYYMMDD` + 같은 날 순번 알파벳 (예: `?v=20261104a`)
   - 위치: `templates/base.html`, `templates/admin.html`, `templates/ITMA/dashboard.html`, `templates/ITMA/index.html`, `templates/ITMA/asset_form.html`, `templates/ITMA/dashboard_live.html`
4. DB 변경이 있으면 CHANGELOG 항목에 `DB` 하위 항목과 마이그레이션 파일명 기록
5. 이 AGENTS.md의 구조/기능 맵이 바뀌었으면 함께 갱신하고 상단 "최종 갱신" 날짜 수정

### CHANGELOG 작성 양식
```markdown
## [1.1.0] - 2026-11-10 ([PLAN-20261110-01])
### 추가
- itma: 자산 상세에 보증기간 필드 추가 (`blueprints/ITMA.py`, `static/js/itma-handler.js`)
### 변경
### 수정
### 삭제
### DB
- `itma_asset_details.warranty_until` 컬럼 추가 (자동 생성, 마이그레이션 불필요)
### 검증
- 자산 상세 저장/조회, 엑셀 다운로드 컬럼 확인
```
- 사용하지 않는 하위 항목은 생략
- 각 줄은 `영역: 내용 (주요 파일)` 형식, 영역은 `auth` / `admin` / `itma` / `db` / `infra` / `docs`

## 코드 스타일
- Python: PEP 8, 4칸 들여쓰기, `snake_case`/`UPPER_CASE`
- Flask Blueprint는 도메인 단위로 분리, 내부 헬퍼는 `_` 접두사
- DB 접근은 `get_db_connection()` + `try/finally`로 `cur.close()`, `conn.close()` 보장, 쿼리는 반드시 파라미터 바인딩(`%s`)
- API 응답 형식: `{"success": bool, "message": "한국어 문구", ...}` + 적절한 HTTP 코드
- 변경 작업은 `log_audit()`으로 감사 로그 기록, 자산 변경은 `_insert_history()`로 이력 기록
- 템플릿/정적 파일 네이밍은 기존 규칙 유지 (`snake_case` 또는 `kebab-case`)
- 큰 기능은 가능하면 `blueprints + services + templates/.../sections (+ static)`를 함께 반영
- CSS/JS는 가능한 인라인보다 별도 파일로 분리하고, 템플릿에는 최소 초기화 코드만 유지

## 에이전트 작업 원칙
- 요청 범위 밖 리팩터링을 임의로 확장하지 않음
- 기존 동작/호환성 우선, 변경이 필요한 경우 이유를 주석 또는 CHANGELOG에 명시
- 에러 메시지/사용자 노출 문구는 한국어 일관성 유지
- 한글 문자는 UTF-8(BOM 없음)로 저장, 저장 후 문법/실행 검증 필수
- 한글 표현 수정 시 문자열 종료/이스케이프/인코딩 깨짐 여부를 반드시 재확인
- 공통 함수명 충돌 주의: 전역 네임스페이스(`window`) 오염 방지
- 신규 함수 작성 전 기존 함수/유틸 존재 여부를 먼저 검색하고, 가능하면 재사용 후 최소 범위로 확장
- 주석은 한글로 작성
- `ITMA.py`, `admin.py`, `itma-handler.js`는 파일이 크므로 수정 전 `rg -n "함수명"`으로 호출 경로 확인

## 수정 전/후 체크리스트
0. `DOCS/ACTIVE/`에 계획 문서 작성, `DOCS/LOGS/`에 로그 생성
1. 관련 파일/호출 경로를 먼저 확인 (`rg` 우선)
2. 기존 함수/유틸/핸들러 중 재사용 가능한 구현이 있는지 확인
3. 최소 변경으로 수정
4. 문법 검사
   - JS: `node --check <file>`
   - Python: `python -m py_compile <file>`
5. 변경 영향 수동 검증
   - 화면 동작(업로드/삭제/탭 전환/엑셀 다운로드 등)
   - 권한별 확인: admin / 편집 권한 그룹 / 조회 전용 그룹 / 그룹 미배정
   - 한글 문구 UI 출력 정상 여부
6. BOM(`&#xFEFF;`) 등 보이지 않는 문자 확인 및 제거
7. **`VERSION`, `CHANGELOG.md`, `?v=` 쿼리 갱신** (버전 관리 규칙 참고)
8. 계획 문서 결과 작성 → `DOCS/COMPLETE/` 이동 → 로그 `완료` 기록 → `DOCS/README.md` 목록 갱신

## 테스트 가이드
- 현재 `tests/` 및 표준 테스트 러너 없음
- 신규 기능은 계획 문서 `7. 검증 방법`과 CHANGELOG `검증` 항목에 수동 검증 절차를 기록, 결과는 로그에 `검증`으로 기록
- 가능하면 `pytest` 테스트 추가 권장 (`tests/test_<feature>.py`)

## 커밋/PR 가이드
- 커밋은 한 가지 논리 변경만 포함
- 제목 형식: `영역: 변경내용` (예: `admin: 세션 만료 처리 수정`), 릴리스 커밋은 `release: v1.1.0`
- PR에 포함: 변경 목적, 주요 파일, 검증 방법, UI 변경 시 스크린샷, 관련 이슈, 버전 변경 여부

## 보안/설정
- 민감 정보 하드코딩 금지 (`.env`, 배포 환경 변수 사용)
- DB/SMTP/기본 계정 비밀번호는 환경별 분리
- 업로드 정책(용량/확장자) 변경 시 `config.py`, 관리자 웹서버 설정(`system_settings.max_file_size`), Nginx `client_max_body_size`(현재 100m)를 함께 검토
- 공개 대시보드 토큰(`system_settings.itma_dashboard_public_token`) 관련 변경 시 노출 범위 주의

## 분석 시 확인된 주의 사항 (2026-11-04 기준, 미수정)
수정 요청이 있을 때 별도 버전으로 처리하고 CHANGELOG에 기록합니다.
1. `app.py`의 `/public/calendar/<token>.ics` 라우트 함수 인자명이 `_token`이라 호출 시 TypeError(500) 발생 가능 → 인자명을 `token`으로 맞춰야 함
2. `Dockerfile`의 `CMD`가 Gunicorn을 직접 실행하므로 `entrypoint.sh`(DB 대기·재시도)는 현재 사용되지 않음
3. 저장소에 `.gitignore` 없음 — `.env`, `infra/nginx/ssl/`(내부 CA 개인키 포함), `uploads/`, `backups/`가 버전관리/공유 시 노출될 수 있음
4. `docker-compose.yml`의 DB 비밀번호 기본값(`netkti00`)과 `.env` 값이 다름 — `.env`가 없으면 다른 비밀번호로 기동
5. `FLASK_ENV` 기본값이 `development`
6. `README.md`의 접속 정보(포트 38008, 초기 비밀번호 표기 2종)가 실제 설정(30080/30443)과 불일치
7. `itma_*` 일부 테이블이 `init_db()`와 `_ensure_itma_table()`에 중복 정의되어 있어 정의가 어긋날 위험

## 금지 사항
- 요청 없는 대규모 포맷팅/전면 개편
- 관련 없는 파일 변경
- 확인되지 않은 추측성 수정
- 버전/CHANGELOG 갱신 없이 기능 변경 완료 처리
- 계획 문서 없이 코드 수정 시작, 로그 없이 작업 종료
- 완료된 계획 문서를 `ACTIVE/`에 방치하거나 `COMPLETE/` 문서를 다시 수정(후속 작업은 새 계획으로)
