# [PLAN-20261117-01] 작업 로그

- 계획 문서: `DOCS/ACTIVE/PLAN-20261117-01_navbar-dropdown.md` (완료 후 `DOCS/COMPLETE/`)

| 일시 | 구분 | 내용 | 관련 파일 |
|------|------|------|----------|
| 2026-11-17 11:33 | 시작 | 요청 접수: 상단 메뉴 '자산 관리'·'관리화면'을 드롭다운으로 변경, 추가 UI 정리 항목 제안. 계획 문서 작성, 상태 진행중 | `DOCS/ACTIVE/PLAN-20261117-01_navbar-dropdown.md` |
| 2026-11-17 11:33 | 결정 | PLAN-20261112-02(1.2.0)가 화면 검증·버전 확정 전 상태 → 이번 작업은 1.2.1 예정으로 두고 CHANGELOG `[Unreleased]`에 기록, VERSION 확정은 1.2.0 완료 후 | |
| 2026-11-17 11:34 | 수정 | 상단 메뉴 드롭다운 마크업('자산 관리': 대시보드/자산 목록/자산 추가, '관리화면': 사이드바와 같은 그룹 17항목), '메인화면' 버튼 제거 후 로고를 메인 링크로 | `templates/base.html` |
| 2026-11-17 11:34 | 수정 | 드롭다운 스타일(상단 메뉴 어두운 톤, 현재 화면 강조, 관리화면 메뉴 높이 초과 시 내부 스크롤) | `static/css/common.css` |
| 2026-11-17 11:34 | 수정 | `hashchange` 시 섹션 전환(초기 대시보드 표시 상태 고려), `?v=` 갱신 | `static/js/admin.js`, `templates/admin.html`, `templates/base.html` |
| 2026-11-17 11:35 | 수정 | `templates/admin.html` 파일 앞 BOM 제거(내용 변경 없음) | `templates/admin.html` |
| 2026-11-17 11:35 | 검증 | Jinja 템플릿 파싱 5종 OK, 권한별 메뉴 렌더링 확인 — admin: 자산 추가·관리화면 표시 / 편집 그룹: 자산 추가만 / 조회 전용·권한 정보 없음: 둘 다 미표시 | |
| 2026-11-17 11:35 | 이슈 | 작업 PC에 Node.js 없음 → `node --check admin.js` 미실행 | |
| 2026-11-17 11:35 | 수정 | `docker compose restart web` 반영 | |
| 2026-11-25 09:56 | 검증 | 사용자 확인: 화면 검증 완료 | |
| 2026-11-25 09:57 | 결정 | 예정 1.2.1 → 사용자 요청으로 1.2.0에 통합 확정 | `CHANGELOG.md` |
| 2026-11-25 09:58 | 검증 | `node --check admin.js`(node:20 컨테이너) 통과 — 2026-11-17 미실행 건 해소 | `static/js/admin.js` |
| 2026-11-25 09:58 | 완료 | COMPLETE로 이동, v1.2.0 | `DOCS/COMPLETE/PLAN-20261117-01_navbar-dropdown.md` |
