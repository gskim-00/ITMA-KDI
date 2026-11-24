-- SMTP 설정 초기화 (PLAN-20261106-02)
-- 행을 삭제하면 web 재시작 시 init_db()가 .env/config.py 기본값으로 다시 생성한다.
\set ON_ERROR_STOP on
\echo '===== 초기화 전 (비밀번호는 설정 여부만 표시) ====='
SELECT id, smtp_server, smtp_port, smtp_username,
       CASE WHEN COALESCE(smtp_password,'') = '' THEN '(없음)' ELSE '(설정됨)' END AS smtp_password,
       sender_email, sender_name, use_tls, updated_at
FROM email_settings;
BEGIN;
DELETE FROM email_settings;
COMMIT;
\echo '===== 삭제 후 건수 ====='
SELECT COUNT(*) AS email_settings_rows FROM email_settings;
