# [PLAN-20261106-01] 작업 로그

- 계획 문서: `DOCS/COMPLETE/PLAN-20261106-01_test-data-cleanup.md`

| 일시 | 구분 | 내용 | 관련 파일 |
|------|------|------|----------|
| 2026-11-06 09:21 | 시작 | 계획 문서 작성, 상태 진행중 | `DOCS/ACTIVE/PLAN-20261106-01_test-data-cleanup.md` |
| 2026-11-06 09:21 | 결정 | DB 직접 접속 불가 → .bat 스크립트를 탐색기에서 실행하고 결과 파일을 읽는 방식으로 진행 (터미널은 컴퓨터 사용 입력 불가) | |
| 2026-11-06 09:21 | 결정 | Dockge 배포 가능성을 고려해 `docker compose` 대신 컨테이너명 `flask_ITMA_db`로 `docker exec` 사용 | `tools/cleanup/*.bat` |
| 2026-11-06 09:22 | 수정 | 백업·조회 스크립트 작성 | `tools/cleanup/01_backup.bat`, `02_inspect.bat`, `inspect.sql` |
| 2026-11-06 09:22 | 결정 | 컴퓨터 사용 접근 승인: 파일 탐색기(click), Docker Desktop(full) | |
| 2026-11-06 09:22 | 검증 | 01_backup.bat 실행 성공 — exit 0, 289,151 bytes, 테이블 29개 COPY 포함 | `backups/before_test_cleanup_20261106_092251.sql` |
| 2026-11-06 09:23 | 검증 | 02_inspect.bat 실행 성공 — 계정 8, 권한그룹 1, 자산 4, 스펙양식 2, 이력 293, 감사로그 285, 접속로그 72 | `tools/cleanup/output/inspect.txt` |
| 2026-11-06 09:23 | 이슈 | `itma_assets.category`에 카테고리 키(pc) 대신 표시명(PC, 하드웨어)이 저장되어 있음 — 정리 범위 밖, 기록만 | |
| 2026-11-06 09:25 | 결정 | 사용자 확정: admin 외 계정 전부, 권한그룹, 자산·이력, 스펙양식, 사용자정의 컬럼, 감사·접속·이메일 로그 삭제 / 카테고리·이메일 템플릿·설정은 유지 | |
| 2026-11-06 09:26 | 수정 | 삭제·복원 스크립트 작성 (단일 트랜잭션, admin 미존재 시 롤백, 일련번호 초기화) | `tools/cleanup/03_delete.bat`, `delete.sql`, `restore.bat` |
| 2026-11-06 09:26 | 수정 | 03_delete.bat 실행 — exit 0, COMMIT, DELETE 7(계정) | `tools/cleanup/output/delete.txt` |
| 2026-11-06 09:27 | 검증 | 삭제 후 건수: 계정 1(admin), 자산·이력·양식·그룹·로그 0, 카테고리 11·이메일 템플릿 5 유지 | `tools/cleanup/output/delete.txt` |
| 2026-11-06 09:28 | 완료 | VERSION 1.0.2, CHANGELOG 기록, 계획 문서 COMPLETE 이동 | `DOCS/COMPLETE/PLAN-20261106-01_test-data-cleanup.md` |
| 2026-11-06 09:31 | 검증 | (완료 후 후속) 실행 중 컨테이너가 이 폴더의 compose·소스(`/app` 마운트)로 동작함을 확인 | `tools/cleanup/docker_info.bat`, `output/docker_info.txt` |
| 2026-11-06 09:32 | 수정 | (완료 후 후속) web·nginx 컨테이너 재시작, exit 0, Gunicorn 정상 기동 / DB 미변경 | `tools/cleanup/restart_web.bat`, `output/restart.txt` |
