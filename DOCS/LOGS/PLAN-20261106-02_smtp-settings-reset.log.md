# [PLAN-20261106-02] 작업 로그

- 계획 문서: `DOCS/COMPLETE/PLAN-20261106-02_smtp-settings-reset.md`

| 일시 | 구분 | 내용 | 관련 파일 |
|------|------|------|----------|
| 2026-11-06 09:55 | 시작 | 계획 문서 작성, 상태 진행중 | `DOCS/ACTIVE/PLAN-20261106-02_smtp-settings-reset.md` |
| 2026-11-06 09:55 | 결정 | 행 삭제 + web 재시작 방식 채택 — `init_db()`가 행이 없을 때 config 기본값으로 생성하고, `app.py`가 기동 시 설정을 메모리에 로드하므로 재시작 필수 | `models/database.py`, `app.py` |
| 2026-11-06 09:56 | 수정 | 초기화 스크립트 작성 (비밀번호는 설정 여부만 출력) | `tools/cleanup/email_reset.sql`, `email_reset.bat` |
| 2026-11-06 09:55 | 검증 | 01_backup.bat 실행 성공 — exit 0, 78,954 bytes | `backups/before_test_cleanup_20261106_095527.sql` |
| 2026-11-06 09:55 | 수정 | email_reset.bat 실행 — DELETE 1, COMMIT, web 재시작 | `tools/cleanup/output/email_reset.txt` |
| 2026-11-06 09:56 | 검증 | 재시작 후 `email_settings` 기본값 1행 생성, Gunicorn 정상, `Email settings loaded: :587` | `tools/cleanup/output/email_reset.txt` |
| 2026-11-06 09:56 | 이슈 | 백업 파일 2개에 이전 SMTP 비밀번호 평문 포함, SMTP 비밀번호 DB 평문 저장 구조 — 기록만 | `backups/` |
| 2026-11-06 09:57 | 완료 | VERSION 1.0.3, CHANGELOG 기록, 계획 문서 COMPLETE 이동 | `DOCS/COMPLETE/PLAN-20261106-02_smtp-settings-reset.md` |
