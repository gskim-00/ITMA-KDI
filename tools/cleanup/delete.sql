-- ITMA 테스트 데이터 삭제 (PLAN-20261106-01)
-- 유지: admin 계정, 카테고리, 이메일 템플릿/설정, 보안·시스템 설정
\set ON_ERROR_STOP on
\echo '===== 삭제 전 건수 ====='
SELECT 'users' t, COUNT(*) FROM users
UNION ALL SELECT 'permission_groups', COUNT(*) FROM permission_groups
UNION ALL SELECT 'itma_assets', COUNT(*) FROM itma_assets
UNION ALL SELECT 'itma_asset_history', COUNT(*) FROM itma_asset_history
UNION ALL SELECT 'itma_spec_forms', COUNT(*) FROM itma_spec_forms
UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs
UNION ALL SELECT 'access_logs', COUNT(*) FROM access_logs
UNION ALL SELECT 'email_logs', COUNT(*) FROM email_logs;

BEGIN;
-- 1) 자산 및 하위 데이터(상세·변경내역·SW·라이선스·스펙값·사용자정의 값) + 일련번호 초기화
TRUNCATE itma_assets RESTART IDENTITY CASCADE;
-- 2) 자산 변경 이력 (FK 없음 → 별도)
TRUNCATE itma_asset_history RESTART IDENTITY;
-- 3) 스펙 양식 및 항목
TRUNCATE itma_spec_forms RESTART IDENTITY CASCADE;
-- 4) 사용자 정의 컬럼
TRUNCATE itma_custom_columns RESTART IDENTITY CASCADE;
-- 5) 권한 그룹 및 배정
TRUNCATE permission_groups RESTART IDENTITY CASCADE;
-- 6) 로그
TRUNCATE audit_logs, access_logs, email_logs, backup_history, address_book RESTART IDENTITY;
-- 7) 계정: admin만 유지
DELETE FROM users WHERE username <> 'admin';
-- admin이 남아 있지 않으면 전체 롤백
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin') THEN
    RAISE EXCEPTION 'admin 계정이 없어 롤백합니다';
  END IF;
END $$;
COMMIT;

\echo '===== 삭제 후 건수 ====='
SELECT 'users' t, COUNT(*) FROM users
UNION ALL SELECT 'permission_groups', COUNT(*) FROM permission_groups
UNION ALL SELECT 'user_permission_groups', COUNT(*) FROM user_permission_groups
UNION ALL SELECT 'itma_assets', COUNT(*) FROM itma_assets
UNION ALL SELECT 'itma_asset_details', COUNT(*) FROM itma_asset_details
UNION ALL SELECT 'itma_asset_history', COUNT(*) FROM itma_asset_history
UNION ALL SELECT 'itma_spec_forms', COUNT(*) FROM itma_spec_forms
UNION ALL SELECT 'itma_spec_form_items', COUNT(*) FROM itma_spec_form_items
UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs
UNION ALL SELECT 'access_logs', COUNT(*) FROM access_logs
UNION ALL SELECT 'email_logs', COUNT(*) FROM email_logs
UNION ALL SELECT 'itma_categories (유지)', COUNT(*) FROM itma_categories
UNION ALL SELECT 'email_templates (유지)', COUNT(*) FROM email_templates;
SELECT username, role, is_active FROM users;
