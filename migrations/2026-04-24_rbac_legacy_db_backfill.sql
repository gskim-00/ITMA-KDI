BEGIN;

-- 기존 DB 재사용 시 RBAC 관련 누락 테이블/컬럼/인덱스를 보정한다.
-- PostgreSQL 기준.

CREATE TABLE IF NOT EXISTS permission_groups (
    id SERIAL PRIMARY KEY,
    group_name VARCHAR(100) UNIQUE NOT NULL,
    target_role VARCHAR(20) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permission_group_categories (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
    category_key VARCHAR(50) NOT NULL,
    can_view BOOLEAN DEFAULT TRUE,
    can_edit BOOLEAN DEFAULT FALSE,
    UNIQUE(group_id, category_key)
);

CREATE TABLE IF NOT EXISTS user_permission_groups (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_by VARCHAR(50),
    UNIQUE(username, group_id)
);

ALTER TABLE permission_groups
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE permission_group_categories
    ADD COLUMN IF NOT EXISTS can_view BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS can_edit BOOLEAN DEFAULT FALSE;

ALTER TABLE user_permission_groups
    ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS assigned_by VARCHAR(50);

UPDATE permission_groups
SET is_active = TRUE
WHERE is_active IS NULL;

UPDATE permission_groups
SET created_at = CURRENT_TIMESTAMP
WHERE created_at IS NULL;

UPDATE permission_groups
SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
WHERE updated_at IS NULL;

UPDATE permission_group_categories
SET can_view = TRUE
WHERE can_view IS NULL;

UPDATE permission_group_categories
SET can_edit = FALSE
WHERE can_edit IS NULL;

UPDATE user_permission_groups
SET assigned_at = CURRENT_TIMESTAMP
WHERE assigned_at IS NULL;

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

CREATE INDEX IF NOT EXISTS idx_permission_group_categories_group
ON permission_group_categories(group_id, category_key);

CREATE INDEX IF NOT EXISTS idx_user_permission_groups_username
ON user_permission_groups(username, group_id);

COMMIT;
