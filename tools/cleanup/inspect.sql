-- ITMA 테스트 데이터 조회 (읽기 전용)
\echo '===== 1. 계정 ====='
SELECT username, real_name, role, email, is_active, must_change_password,
       allowed_ip_list, created_at, last_login
FROM users ORDER BY created_at NULLS FIRST, username;

\echo '===== 2. 계정별 권한 그룹 ====='
SELECT upg.username, pg.id AS group_id, pg.group_name, pg.target_role
FROM user_permission_groups upg JOIN permission_groups pg ON pg.id = upg.group_id
ORDER BY upg.username;

\echo '===== 3. 권한 그룹 ====='
SELECT pg.id, pg.group_name, pg.target_role, pg.is_active, pg.created_at,
       (SELECT COUNT(*) FROM user_permission_groups u WHERE u.group_id = pg.id) AS member_cnt
FROM permission_groups pg ORDER BY pg.id;

\echo '===== 4. 카테고리 ====='
SELECT c.category_key, c.display_name, c.display_order, c.created_by, c.created_at,
       (SELECT COUNT(*) FROM itma_assets a WHERE a.category = c.category_key) AS asset_cnt
FROM itma_categories c ORDER BY c.display_order;

\echo '===== 5. 자산 수 (카테고리 / 등록자별) ====='
SELECT category, uploaded_by, COUNT(*) AS cnt, MIN(input_at) AS first_input, MAX(input_at) AS last_input
FROM itma_assets GROUP BY category, uploaded_by ORDER BY category, uploaded_by;

\echo '===== 6. 자산 목록 ====='
SELECT id, category, asset_code, asset_id, manufacturer, item_name, serial_number,
       uploaded_by, input_at
FROM itma_assets ORDER BY id;

\echo '===== 7. 사용자 정의 컬럼 ====='
SELECT column_key, column_label, created_by, created_at FROM itma_custom_columns ORDER BY display_order;

\echo '===== 8. 스펙 양식 ====='
SELECT f.id, f.category_key, f.form_name, f.created_by, f.created_at,
       (SELECT COUNT(*) FROM itma_spec_form_items i WHERE i.form_id = f.id) AS item_cnt
FROM itma_spec_forms f ORDER BY f.id;

\echo '===== 9. 테이블별 건수 ====='
SELECT 'itma_asset_history' AS tbl, COUNT(*) FROM itma_asset_history
UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs
UNION ALL SELECT 'access_logs', COUNT(*) FROM access_logs
UNION ALL SELECT 'email_logs', COUNT(*) FROM email_logs
UNION ALL SELECT 'email_templates', COUNT(*) FROM email_templates
UNION ALL SELECT 'address_book', COUNT(*) FROM address_book
UNION ALL SELECT 'backup_history', COUNT(*) FROM backup_history;
