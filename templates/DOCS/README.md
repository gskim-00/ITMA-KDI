# DOCS — 작업 문서 관리

모든 개발 작업은 **계획 → 실행(로그) → 완료** 순서로 이 폴더에 기록합니다. 상세 규칙은 루트 `AGENTS.md`의 "작업 문서화 규칙"을 따릅니다.

| 폴더 | 용도 |
|------|------|
| `ACTIVE/` | 작성됐지만 아직 끝나지 않은 계획 문서 (상태: 계획·진행중) |
| `COMPLETE/` | 실행이 끝난 계획 문서 (상태: 완료·취소) |
| `LOGS/` | 작업별 실행 로그 (계획 문서와 같은 ID) |
| `TEMPLATES/` | 계획·로그 양식 |

## 파일 이름
- 계획: `PLAN-YYYYMMDD-NN_slug.md` (예: `PLAN-20261104-01_docs-structure.md`)
- 로그: `PLAN-YYYYMMDD-NN_slug.log.md`
- `NN`은 같은 날 두 자리 순번, `slug`는 영문 소문자·하이픈

## 작업 목록
| ID | 제목 | 상태 | 버전 | 계획 문서 |
|----|------|------|------|----------|
| PLAN-20261104-01 | 작업 문서 관리 체계(DOCS) 도입 | 완료 | 1.0.1 | [COMPLETE/PLAN-20261104-01_docs-structure.md](COMPLETE/PLAN-20261104-01_docs-structure.md) |
| PLAN-20261106-01 | 테스트 데이터 정리 | 완료 | 1.0.2 | [COMPLETE/PLAN-20261106-01_test-data-cleanup.md](COMPLETE/PLAN-20261106-01_test-data-cleanup.md) |
| PLAN-20261106-02 | 이메일 SMTP 설정 초기화 | 완료 | 1.0.3 | [COMPLETE/PLAN-20261106-02_smtp-settings-reset.md](COMPLETE/PLAN-20261106-02_smtp-settings-reset.md) |
| PLAN-20261111-01 | 자산 엑셀 일괄등록 규칙 변경 (빈칸 허용, 중복 건수 구분) | 완료 | 1.0.4 | [COMPLETE/PLAN-20261111-01_asset-upload-rules.md](COMPLETE/PLAN-20261111-01_asset-upload-rules.md) |
| PLAN-20261112-01 | 엑셀 일괄등록 양식을 자산관리 화면 컬럼과 동일하게 변경 | 완료 | 1.1.0 | [COMPLETE/PLAN-20261112-01_upload-template-columns.md](COMPLETE/PLAN-20261112-01_upload-template-columns.md) |
