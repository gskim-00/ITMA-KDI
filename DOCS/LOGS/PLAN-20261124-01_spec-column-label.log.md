# [PLAN-20261124-01] 작업 로그

- 계획 문서: `DOCS/ACTIVE/PLAN-20261124-01_spec-column-label.md` (완료 후 `DOCS/COMPLETE/`)

| 일시 | 구분 | 내용 | 관련 파일 |
|------|------|------|----------|
| 2026-11-24 17:44 | 시작 | 계획 문서 작성 (디자인 피드백: 스펙 컬럼명 `하드웨어 / 하드웨어추가 / CPU` → `CPU`) | `DOCS/ACTIVE/PLAN-20261124-01_spec-column-label.md` |
| 2026-11-24 17:45 | 수정 | `_load_visible_spec_columns()` `label`을 항목명만 사용, 항목명이 비면 `카테고리 / 폼명`으로 대체 | `blueprints/ITMA.py` |
| 2026-11-24 17:45 | 검증 | `python -m py_compile blueprints/ITMA.py` 통과, BOM 없음 | `blueprints/ITMA.py` |
| 2026-11-24 17:46 | 결정 | 선행 계획(PLAN-20261112-02 → 1.2.0, PLAN-20261117-01 → 1.2.1)이 진행중이라 기존 방식대로 CHANGELOG `[Unreleased]`에 `1.2.2 예정`으로 기록, `VERSION`은 1.1.0 유지. 정적 파일 변경 없어 `?v=` 갱신 없음 | `CHANGELOG.md` |
| 2026-11-24 17:46 | 완료 | COMPLETE로 이동, v1.2.2 예정 (화면 수동 검증은 사용자 확인 대기) | `DOCS/COMPLETE/PLAN-20261124-01_spec-column-label.md` |
