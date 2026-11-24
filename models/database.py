# -*- coding: utf-8 -*-
"""Database connection and initialization."""

import time

import psycopg2
from werkzeug.security import generate_password_hash

from config import Config


def get_db_connection():
    """Return PostgreSQL connection with simple retry."""
    retries = 5
    while retries > 0:
        try:
            return psycopg2.connect(Config.DATABASE_URL)
        except psycopg2.OperationalError:
            retries -= 1
            time.sleep(3)
    raise Exception("Failed to connect to database")


def load_email_config():
    """Load email settings from DB."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT smtp_server, smtp_port, smtp_username, smtp_password,
                   sender_email, sender_name, use_tls
            FROM email_settings
            LIMIT 1
            """
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        if not row:
            return None
        return {
            "smtp_server": row[0],
            "smtp_port": row[1],
            "smtp_username": row[2],
            "smtp_password": row[3],
            "sender_email": row[4],
            "sender_name": row[5],
            "use_tls": row[6],
        }
    except Exception:
        return None


def init_db():
    """Initialize tables required by the ITMA-focused application."""
    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            real_name TEXT,
            email TEXT,
            allowed_ip_list TEXT,
            last_login TIMESTAMP,
            is_active BOOLEAN DEFAULT TRUE,
            must_change_password BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS access_logs (
            id SERIAL PRIMARY KEY,
            username TEXT,
            ip_address TEXT,
            login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            logout_time TIMESTAMP
        );
        """
    )

    cur.execute(
        """
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS allowed_ip_list TEXT;
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS email_logs (
            id SERIAL PRIMARY KEY,
            admin_username TEXT,
            recipient TEXT,
            subject VARCHAR(255),
            status VARCHAR(20),
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS email_settings (
            id SERIAL PRIMARY KEY,
            smtp_server VARCHAR(255),
            smtp_port INTEGER,
            smtp_username VARCHAR(255),
            smtp_password VARCHAR(255),
            sender_email VARCHAR(255),
            sender_name VARCHAR(255),
            use_tls BOOLEAN DEFAULT TRUE,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS email_templates (
            id SERIAL PRIMARY KEY,
            template_name VARCHAR(100) NOT NULL,
            template_type VARCHAR(50),
            subject VARCHAR(255) NOT NULL,
            body TEXT NOT NULL,
            created_by VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT TRUE
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS address_book (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(255) NOT NULL,
            department VARCHAR(100),
            position VARCHAR(50),
            notes TEXT,
            created_by VARCHAR(50) REFERENCES users(username) ON DELETE SET NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS itma_assets (
            id SERIAL PRIMARY KEY,
            asset_id VARCHAR(100),
            asset_code VARCHAR(100),
            category VARCHAR(100),
            item_name VARCHAR(255),
            manufacturer VARCHAR(255),
            serial_number VARCHAR(255),
            received_date DATE,
            inbound_note TEXT,
            released_date DATE,
            outbound_note TEXT,
            storage_location VARCHAR(255),
            detail_note TEXT,
            sales_rep VARCHAR(100),
            usage_status VARCHAR(20) DEFAULT '사용',
            site VARCHAR(100),
            manufacture_month DATE,
            input_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now())),
            updated_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now())),
            uploaded_by VARCHAR(50),
            updated_by VARCHAR(50)
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS itma_asset_history (
            id SERIAL PRIMARY KEY,
            asset_id INTEGER,
            action VARCHAR(20) NOT NULL,
            changed_column VARCHAR(100),
            before_value TEXT,
            after_value TEXT,
            snapshot_data TEXT,
            restored_from_history_id INTEGER,
            restored BOOLEAN DEFAULT FALSE,
            restored_at TIMESTAMP,
            restored_by VARCHAR(50),
            actor VARCHAR(50),
            created_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now()))
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS security_settings (
            setting_key VARCHAR(100) PRIMARY KEY,
            setting_value VARCHAR(1000),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS system_settings (
            setting_key VARCHAR(100) PRIMARY KEY,
            setting_value TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS backup_history (
            id SERIAL PRIMARY KEY,
            filename VARCHAR(255) NOT NULL,
            description TEXT,
            file_size BIGINT,
            created_by VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_logs (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50),
            action VARCHAR(50) NOT NULL,
            project_id INTEGER,
            resource VARCHAR(255),
            details TEXT,
            ip_address VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            success BOOLEAN DEFAULT TRUE
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS permission_groups (
            id SERIAL PRIMARY KEY,
            group_name VARCHAR(100) UNIQUE NOT NULL,
            target_role VARCHAR(20) NOT NULL,
            description TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS permission_group_categories (
            id SERIAL PRIMARY KEY,
            group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
            category_key VARCHAR(50) NOT NULL,
            can_view BOOLEAN DEFAULT TRUE,
            can_edit BOOLEAN DEFAULT FALSE,
            UNIQUE(group_id, category_key)
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS user_permission_groups (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
            assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            assigned_by VARCHAR(50),
            UNIQUE(username, group_id)
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS itma_categories (
            category_key VARCHAR(50) PRIMARY KEY,
            display_name VARCHAR(100) NOT NULL,
            supports_spec_forms BOOLEAN NOT NULL DEFAULT TRUE,
            display_order INTEGER NOT NULL DEFAULT 0,
            created_by VARCHAR(50),
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_itma_categories_display_name
        ON itma_categories (LOWER(BTRIM(display_name)));
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS itma_asset_spec_items (
            id SERIAL PRIMARY KEY,
            asset_id INTEGER NOT NULL REFERENCES itma_assets(id) ON DELETE CASCADE,
            spec_label VARCHAR(120) NOT NULL,
            spec_value TEXT NOT NULL,
            display_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_by VARCHAR(50)
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS itma_spec_forms (
            id SERIAL PRIMARY KEY,
            category_key VARCHAR(50) NOT NULL,
            form_name VARCHAR(120) NOT NULL,
            description TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            created_by VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(category_key, form_name)
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS itma_spec_form_items (
            id SERIAL PRIMARY KEY,
            form_id INTEGER NOT NULL REFERENCES itma_spec_forms(id) ON DELETE CASCADE,
            spec_label VARCHAR(120) NOT NULL,
            spec_value TEXT NOT NULL,
            display_order INTEGER NOT NULL DEFAULT 0
        );
        """
    )

    cur.execute(
        """
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        """
    )
    cur.execute(
        """
        UPDATE users
        SET created_at = CURRENT_TIMESTAMP
        WHERE created_at IS NULL;
        """
    )
    cur.execute(
        """
        UPDATE users
        SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
        WHERE updated_at IS NULL;
        """
    )

    cur.execute(
        """
        ALTER TABLE permission_groups
            ADD COLUMN IF NOT EXISTS description TEXT,
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        """
    )
    cur.execute(
        """
        ALTER TABLE permission_group_categories
            ADD COLUMN IF NOT EXISTS can_view BOOLEAN DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS can_edit BOOLEAN DEFAULT FALSE;
        """
    )
    cur.execute(
        """
        ALTER TABLE user_permission_groups
            ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ADD COLUMN IF NOT EXISTS assigned_by VARCHAR(50);
        """
    )
    cur.execute(
        """
        ALTER TABLE itma_asset_spec_items
            ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS source_form_item_id INTEGER REFERENCES itma_spec_form_items(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ADD COLUMN IF NOT EXISTS updated_by VARCHAR(50);
        """
    )
    cur.execute(
        """
        ALTER TABLE itma_spec_forms
            ADD COLUMN IF NOT EXISTS category_key VARCHAR(50),
            ADD COLUMN IF NOT EXISTS description TEXT,
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS created_by VARCHAR(50),
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        """
    )
    cur.execute(
        """
        ALTER TABLE itma_spec_form_items
            ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS show_in_list BOOLEAN NOT NULL DEFAULT FALSE;
        """
    )
    cur.execute(
        """
        UPDATE permission_groups
        SET is_active = TRUE
        WHERE is_active IS NULL;
        """
    )
    cur.execute(
        """
        UPDATE permission_groups
        SET created_at = CURRENT_TIMESTAMP
        WHERE created_at IS NULL;
        """
    )
    cur.execute(
        """
        UPDATE permission_groups
        SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
        WHERE updated_at IS NULL;
        """
    )
    cur.execute(
        """
        UPDATE permission_group_categories
        SET can_view = TRUE
        WHERE can_view IS NULL;
        """
    )
    cur.execute(
        """
        UPDATE permission_group_categories
        SET can_edit = FALSE
        WHERE can_edit IS NULL;
        """
    )
    cur.execute(
        """
        UPDATE user_permission_groups
        SET assigned_at = CURRENT_TIMESTAMP
        WHERE assigned_at IS NULL;
        """
    )
    cur.execute(
        """
        UPDATE itma_spec_forms
        SET category_key = 'other'
        WHERE category_key IS NULL OR TRIM(category_key) = '';
        """
    )
    cur.execute(
        """
        UPDATE itma_spec_forms
        SET is_active = TRUE
        WHERE is_active IS NULL;
        """
    )
    cur.execute(
        """
        UPDATE itma_spec_forms
        SET created_at = CURRENT_TIMESTAMP
        WHERE created_at IS NULL;
        """
    )
    cur.execute(
        """
        UPDATE itma_spec_forms
        SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
        WHERE updated_at IS NULL;
        """
    )
    cur.execute(
        """
        INSERT INTO itma_categories (category_key, display_name, supports_spec_forms, display_order)
        VALUES
            ('pc', 'PC', TRUE, 10), ('printer', '프린터', TRUE, 20),
            ('software', '소프트웨어', FALSE, 30), ('license', '라이선스', FALSE, 40),
            ('hardware', '하드웨어', TRUE, 50), ('network', '네트워크', TRUE, 60),
            ('security', '보안', TRUE, 70), ('server', '서버', TRUE, 80),
            ('solution', '솔루션', TRUE, 90), ('cloud', '클라우드', TRUE, 100),
            ('other', '그외', TRUE, 110)
        ON CONFLICT (category_key) DO NOTHING;
        """
    )
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_itma_asset_spec_source
        ON itma_asset_spec_items(asset_id, source_form_item_id)
        WHERE source_form_item_id IS NOT NULL;
        """
    )
    cur.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'permission_group_categories_group_id_category_key_key'
            ) THEN
                ALTER TABLE permission_group_categories
                ADD CONSTRAINT permission_group_categories_group_id_category_key_key
                UNIQUE (group_id, category_key);
            END IF;
        END $$;
        """
    )
    cur.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'user_permission_groups_username_group_id_key'
            ) THEN
                ALTER TABLE user_permission_groups
                ADD CONSTRAINT user_permission_groups_username_group_id_key
                UNIQUE (username, group_id);
            END IF;
        END $$;
        """
    )

    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_address_book_email ON address_book(email);
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_address_book_name ON address_book(name);
        """
    )
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_itma_assets_asset_id
        ON itma_assets(asset_id)
        WHERE asset_id IS NOT NULL AND asset_id <> '';
        """
    )
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_itma_assets_asset_code
        ON itma_assets(asset_code)
        WHERE asset_code IS NOT NULL AND asset_code <> '';
        """
    )
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_itma_assets_serial_number
        ON itma_assets(serial_number)
        WHERE serial_number IS NOT NULL AND serial_number <> '';
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_itma_asset_history_created_at
        ON itma_asset_history(created_at DESC);
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_itma_asset_history_asset_id
        ON itma_asset_history(asset_id);
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_audit_logs_username ON audit_logs(username);
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_permission_group_categories_group
        ON permission_group_categories(group_id, category_key);
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_permission_groups_username
        ON user_permission_groups(username, group_id);
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_itma_asset_spec_items_asset
        ON itma_asset_spec_items(asset_id, display_order ASC, id ASC);
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_itma_spec_forms_category
        ON itma_spec_forms(category_key, form_name);
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_itma_spec_form_items_form
        ON itma_spec_form_items(form_id, display_order ASC, id ASC);
        """
    )

    admin_hashed_pw = generate_password_hash("Admin123#")
    cur.execute(
        """
        INSERT INTO users (username, password, role, real_name, is_active, updated_at)
        VALUES ('admin', %s, 'admin', '관리자', TRUE, CURRENT_TIMESTAMP)
        ON CONFLICT (username) DO UPDATE
        SET password = EXCLUDED.password,
            role = 'admin',
            is_active = TRUE,
            real_name = COALESCE(NULLIF(users.real_name, ''), EXCLUDED.real_name),
            updated_at = CURRENT_TIMESTAMP;
        """,
        (admin_hashed_pw,),
    )

    cur.execute("SELECT COUNT(*) FROM email_settings")
    if cur.fetchone()[0] == 0:
        cur.execute(
            """
            INSERT INTO email_settings
                (smtp_server, smtp_port, smtp_username, smtp_password,
                 sender_email, sender_name, use_tls)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                Config.SMTP_SERVER,
                Config.SMTP_PORT,
                Config.SMTP_USERNAME,
                Config.SMTP_PASSWORD,
                Config.SENDER_EMAIL,
                Config.SENDER_NAME,
                Config.USE_TLS,
            ),
        )

    templates_to_create = [
        {
            "template_name": "신규 사용자 환영",
            "template_type": "welcome_new_user",
            "subject": "[ONE ITMA] 자산관리 시스템 계정 생성 완료",
            "body": (
                "안녕하세요 {real_name}님.\n"
                "ONE ITMA 자산관리 시스템 계정이 생성되었습니다.\n"
                "사용자 ID : {username}\n"
                "초기 비밀번호 : {password}\n"
                "권한: {role}\n"
                "\n"
                "ONE ITMA 자산 관리 시스템"
            ),
        },
        {
            "template_name": "일반 알림",
            "template_type": "notification",
            "subject": "[ONE ITMA] 자산관리 시스템 알림",
            "body": (
                "안녕하세요 {real_name}님.\n"
                "\n"
                "ONE ITMA 자산 관리 시스템에서 안내드립니다.\n"
                "\n"
                "알림 유형: {event_type}\n"
                "자산명: {asset_name}\n"
                "자산 ID: {asset_id}\n"
                "발생일: {event_date}\n"
                "\n"
                "상세 내용:\n"
                "{details}\n"
                "\n"
                "ONE ITMA 자산 관리 시스템"
            ),
        },
        {
            "template_name": "리마인더",
            "template_type": "reminder",
            "subject": "[ONE ITMA] 자산관리 시스템 리마인더",
            "body": (
                "안녕하세요 {real_name}님.\n\n"
                "확인이 필요한 항목이 있습니다."
                "\n"
                "ONE ITMA 자산 관리 시스템"
            ),
        },
        {
            "template_name": "로그인 실패 경고",
            "template_type": "failed_login_alert",
            "subject": "[ONE ITMA] 로그인 실패 누적 감지 - {username}",
            "body": (
                "[ONE ITMA 자산 관리 시스템 보안 알림]\n\n"
                "설정된 임계치 이상 로그인 실패가 감지되었습니다.\n\n"
                "【 감지 정보 】\n"
                "발생시각: {occurred_at}\n"
                "시도 사용자 ID: {username}\n"
                "접속 IP: {ip_address}\n"
                "누적 실패 횟수: {failure_count}회\n\n"
                "접속 로그 및 감사 로그를 확인해 주세요.\n\n"
                "감사합니다.\n"
                "\n"
                "ONE ITMA 자산 관리 시스템"
            ),
        },
    ]

    cur.execute("SELECT pg_advisory_xact_lock(%s)", (2026042801,))
    for template in templates_to_create:
        cur.execute(
            "SELECT COUNT(*) FROM email_templates WHERE template_type = %s AND is_active = TRUE",
            (template["template_type"],),
        )
        if cur.fetchone()[0] == 0:
            cur.execute(
                """
                INSERT INTO email_templates (template_name, template_type, subject, body, created_by)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    template["template_name"],
                    template["template_type"],
                    template["subject"],
                    template["body"],
                    "system",
                ),
            )
    cur.execute(
        """
        UPDATE email_templates
        SET body = REPLACE(body, %s, CHR(10)),
            updated_at = CURRENT_TIMESTAMP
        WHERE is_active = TRUE
          AND POSITION(%s IN body) > 0;
        """,
        ("\\n", "\\n"),
    )
    cur.execute(
        """
        UPDATE email_templates
        SET subject = %s,
            body = %s,
            updated_at = CURRENT_TIMESTAMP
        WHERE template_type = 'notification'
          AND is_active = TRUE
          AND created_by = 'system'
          AND body LIKE %s;
        """,
        (
            "[ONE ITMA] 자산관리 시스템 알림",
            next(
                template["body"]
                for template in templates_to_create
                if template["template_type"] == "notification"
            ),
            "%{role} 계정 대상 안내 메시지입니다.%",
        ),
    )

    conn.commit()
    cur.close()
    conn.close()

    load_email_config()
