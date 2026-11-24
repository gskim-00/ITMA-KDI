# [PLAN-20261106-02] 이메일 SMTP 설정 초기화

| 항목 | 내용 |
|------|------|
| 상태 | 완료 |
| 작성일 | 2026-11-06 09:55 |
| 완료일 | 2026-11-06 09:57 |
| 요청자 | 강식 |
| 대상 버전 | 현재 1.0.2 → 예정 1.0.3 (PATCH, 스크립트 추가 / 앱 코드 변경 없음) |
| 작업 로그 | `DOCS/LOGS/PLAN-20261106-02_smtp-settings-reset.log.md` |

## 1. 배경 및 목적
- 테스트 데이터 정리(PLAN-20261106-01) 후에도 테스트 때 입력한 SMTP 설정이 남아 있어 초기 상태로 되돌린다

## 2. 작업 범위
- 포함: `email_settings` 초기화, web 재시작으로 기본값 재생성
- 제외: 이메일 템플릿(5개 유지), 보안·시스템 설정, 앱 코드

## 3. 영향 파일 (예상)
| 파일 | 변경 내용 |
|------|----------|
| `tools/cleanup/email_reset.sql`, `email_reset.bat` | 신규 — 설정 행 삭제 → web 재시작 → 결과 확인 |
| DB `email_settings` | 행 삭제 후 `init_db()`가 기본값(.env 비어 있음 → `config.py` 기본값)으로 재생성 |

## 4. 작업 단계
- [x] 1. 계획 문서·로그 작성
- [x] 2. 초기화 스크립트 작성
- [x] 3. DB 백업 (`01_backup.bat`)
- [x] 4. `email_reset.bat` 실행
- [x] 5. 검증
- [x] 6. VERSION / CHANGELOG 갱신, COMPLETE 이동

## 5. DB 변경
- 스키마 변경 없음, `email_settings` 데이터만 초기화

## 6. 위험 요소 및 복구 방법
- 초기화 후 이메일 발송(비밀번호 찾기, 메일 발송) 불가 → 관리자 화면에서 운영 SMTP 정보 재입력 필요
- 복구: 3단계 백업으로 `restore.bat` 실행

## 7. 검증 방법
- [x] `email_settings`가 기본값 1행으로 재생성
- [x] web 정상 기동, 관리자 → 이메일 설정 화면 표시

## 8. 결과 (완료 시 작성)
- 실제 변경 파일: `tools/cleanup/email_reset.bat`, `email_reset.sql`, `VERSION`, `CHANGELOG.md`, DOCS 문서
- 결과: 기존 1행(spamout.jininfra.com:25, gskim@jininfra.com) 삭제 → 기본값 1행(id 2, 서버·계정 빈 값, 포트 587, TLS false) 재생성
- 계획 대비 달라진 점: 없음. 관리자 이메일 설정 화면 확인은 사용자가 진행
- 확정 버전: 1.0.3
- 남은 과제: 운영 SMTP 정보는 관리자 화면에서 입력 / 백업 파일 2개에 이전 SMTP 비밀번호가 평문으로 포함되어 있어 보관 주의 / SMTP 비밀번호가 DB에 평문 저장되는 구조 별도 검토
