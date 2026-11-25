"""
ITMA Blueprint
Office asset management: list, Excel upload, inline update, downloads.
"""

from datetime import date, datetime
from io import BytesIO
import hmac
import json
import re
import secrets
import traceback
from datetime import timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pandas as pd
from flask import Blueprint, flash, jsonify, redirect, render_template, request, send_file, session, url_for

from models import get_db_connection
from utils import log_audit


itma_bp = Blueprint("itma", __name__, url_prefix="/itma")
ITMA_DASHBOARD_TOKEN_KEY = "itma_dashboard_public_token"
DEFAULT_CATEGORY_PERMISSION_KEYS = (
    "pc",
    "printer",
    "software",
    "license",
    "hardware",
    "network",
    "security",
    "server",
    "solution",
    "cloud",
    "other",
)
ITMA_DYNAMIC_SPEC_FORM_CATEGORIES = {
    "pc",
    "printer",
    "hardware",
    "network",
    "security",
    "server",
    "solution",
    "cloud",
    "other",
}


def _validate_csrf_token():
    session_token = session.get('csrf_token')
    token = (
        request.form.get('csrf_token')
        or request.headers.get('X-CSRF-Token')
        or ((request.get_json(silent=True) or {}).get('csrf_token') if request.is_json else None)
    )
    if not session_token or not token:
        return False
    return hmac.compare_digest(session_token, token)


def _normalize_category_key(value):
    raw = str(value or "").strip().lower()
    if not raw:
        return "other"
    if raw in {"software", "sw", "소프트웨어"} or "소프트" in raw:
        return "software"
    if raw in {"license", "라이선스"} or "라이선" in raw:
        return "license"
    if raw in {"hardware", "hw", "하드웨어"} or "하드웨어" in raw:
        return "hardware"
    if raw in {"network", "nw", "네트워크", "l2", "l3", "l4", "l7"} or "네트워크" in raw:
        return "network"
    if raw in {"security", "se", "보안"} or "보안" in raw:
        return "security"
    if raw in {"server", "서버"} or "서버" in raw:
        return "server"
    if raw in {"solution", "솔루션"} or "솔루션" in raw:
        return "solution"
    if raw in {"cloud", "클라우드"} or "클라우드" in raw:
        return "cloud"
    if raw in {"printer", "프린터"} or "프린터" in raw:
        return "printer"
    if raw in {"pc", "컴퓨터", "노트북"} or "pc" in raw:
        return "pc"
    if raw in {"other", "기타", "그외"} or "그외" in raw or "기타" in raw:
        return "other"
    fallback = re.sub(r"[^\w-]+", "_", raw, flags=re.UNICODE).strip("_")
    return fallback or "other"


def _supports_dynamic_spec_forms(category_key):
    return _normalize_category_key(category_key) not in {"software", "license"}


def _normalize_spec_items(payload, allow_empty_value=True):
    rows = payload if isinstance(payload, list) else []
    normalized_rows = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        label = _clean_text(row.get("label") or row.get("spec_label")) or ""
        value = _clean_text(row.get("value") or row.get("spec_value")) or ""
        if not label:
            continue
        if not allow_empty_value and not value:
            continue
        order_raw = _clean_text(row.get("display_order"))
        try:
            display_order = int(order_raw) if order_raw not in (None, "") else index
        except Exception:
            display_order = index
        normalized_rows.append(
            {
                "id": row.get("id"),
                "label": label,
                "value": value,
                "display_order": max(0, display_order),
                "show_in_list": row.get("show_in_list") is True,
                "source_form_item_id": row.get("source_form_item_id"),
            }
        )
    normalized_rows.sort(key=lambda x: (x["display_order"], x["label"], x["value"]))
    for index, row in enumerate(normalized_rows):
        row["display_order"] = index
    return normalized_rows


def _legacy_spec_items_from_payload(payload_like):
    source = payload_like or {}
    mapping = [
        ("CPU", source.get("cpu_spec")),
        ("MEM", source.get("mem_spec")),
        ("HDD", source.get("hdd_spec")),
        ("NW_Port", source.get("nw_port")),
    ]
    items = []
    for index, (label, value) in enumerate(mapping):
        text = _clean_text(value) or ""
        if not text:
            continue
        items.append({"label": label, "value": text, "display_order": index})
    return items


def _load_asset_spec_items(cur, asset_id):
    cur.execute(
        """
        SELECT spec_label, spec_value, display_order, source_form_item_id
        FROM itma_asset_spec_items
        WHERE asset_id = %s
        ORDER BY display_order ASC, id ASC
        """,
        (asset_id,),
    )
    return [
        {
            "label": row[0] or "",
            "value": row[1] or "",
            "display_order": int(row[2]) if row[2] is not None else 0,
            "source_form_item_id": row[3],
        }
        for row in cur.fetchall()
        if (row[0] or "").strip()
    ]


def _delete_spec_values_for_form_items(cur, form_item_ids):
    """삭제되는 스펙 폼 항목에 연결된 자산 스펙 값을 함께 삭제하고 삭제 건수를 반환 (직접 입력 행은 대상 아님)"""
    ids = [int(item_id) for item_id in (form_item_ids or [])]
    if not ids:
        return 0
    cur.execute("DELETE FROM itma_asset_spec_items WHERE source_form_item_id = ANY(%s::int[])", (ids,))
    return cur.rowcount or 0


def _serialize_spec_form_row(cur, row):
    form_id = int(row[0])
    cur.execute(
        """
        SELECT id, spec_label, spec_value, display_order, show_in_list
        FROM itma_spec_form_items
        WHERE form_id = %s
        ORDER BY display_order ASC, id ASC
        """,
        (form_id,),
    )
    items = [
        {
            "id": item_row[0],
            "label": item_row[1] or "",
            "value": item_row[2] or "",
            "display_order": int(item_row[3]) if item_row[3] is not None else 0,
            "show_in_list": bool(item_row[4]),
        }
        for item_row in cur.fetchall()
        if (item_row[1] or "").strip()
    ]
    return {
        "id": form_id,
        "category_key": _normalize_category_key(row[1]),
        "form_name": row[2] or "",
        "description": row[3] or "",
        "is_active": bool(row[4]),
        "created_by": row[5] or "",
        "created_at": row[6].strftime("%Y-%m-%d %H:%M:%S") if row[6] else "",
        "updated_at": row[7].strftime("%Y-%m-%d %H:%M:%S") if row[7] else "",
        "items": items,
        "items_count": len(items),
    }


def _load_user_category_permissions(username, role):
    role_name = str(role or "").strip().lower()
    if role_name == "admin":
        return {
            "role": role_name,
            "allowed_categories": list(DEFAULT_CATEGORY_PERMISSION_KEYS),
            "view_categories": list(DEFAULT_CATEGORY_PERMISSION_KEYS),
            "edit_categories": list(DEFAULT_CATEGORY_PERMISSION_KEYS),
            "can_edit_all": True,
            "can_manage_columns": True,
        }

    username = str(username or "").strip()
    if not username:
        return {
            "role": role_name,
            "allowed_categories": [],
            "view_categories": [],
            "edit_categories": [],
            "can_edit_all": False,
            "can_manage_columns": False,
        }

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT pgc.category_key, pgc.can_view, pgc.can_edit
            FROM user_permission_groups upg
            JOIN permission_groups pg ON pg.id = upg.group_id
            JOIN permission_group_categories pgc ON pgc.group_id = pg.id
            WHERE upg.username = %s
              AND pg.is_active = TRUE
              AND pg.target_role = %s
            """,
            (username, role_name),
        )
        view_categories = set()
        edit_categories = set()
        for category_key, can_view, can_edit in cur.fetchall():
            normalized = _normalize_category_key(category_key)
            if can_view:
                view_categories.add(normalized)
            if role_name == "manager" and can_edit and can_view:
                edit_categories.add(normalized)
        return {
            "role": role_name,
            "allowed_categories": sorted(view_categories),
            "view_categories": sorted(view_categories),
            "edit_categories": sorted(edit_categories),
            "can_edit_all": False,
            "can_manage_columns": role_name == "manager" and bool(edit_categories),
        }
    except Exception:
        return {
            "role": role_name,
            "allowed_categories": [],
            "view_categories": [],
            "edit_categories": [],
            "can_edit_all": False,
            "can_manage_columns": False,
        }
    finally:
        cur.close()
        conn.close()


def _get_session_itma_permissions():
    return _load_user_category_permissions(session.get("username"), session.get("role"))


def _can_view_category(permissions, category_key):
    if permissions.get("can_edit_all"):
        return True
    return _normalize_category_key(category_key) in set(permissions.get("view_categories") or [])


def _can_edit_category(permissions, category_key):
    if permissions.get("can_edit_all"):
        return True
    return _normalize_category_key(category_key) in set(permissions.get("edit_categories") or [])


@itma_bp.before_request
def _enforce_csrf_for_mutating_itma_requests():
    if request.method not in ("POST", "PUT", "PATCH", "DELETE"):
        return None
    if "username" not in session:
        return None
    if not _validate_csrf_token():
        is_api_request = (
            request.is_json
            or request.headers.get("X-Requested-With") == "XMLHttpRequest"
            or "application/json" in (request.headers.get("Accept") or "")
        )
        if is_api_request:
            return jsonify({"success": False, "message": "잘못된 요청입니다."}), 400
        return redirect(url_for("itma.page"))
    return None


ITMA_TEMPLATE_COLUMNS = [
    ("category", "구분"),
    ("site", "사업장"),
    ("asset_id", "자산ID"),
    ("manufacturer", "제조사"),
    ("item_name", "품명"),
    ("serial_number", "시리얼번호"),
    ("received_date", "입고일"),
    ("inbound_note", "입고메모"),
    ("released_date", "출고일"),
    ("outbound_note", "출고메모"),
    ("storage_location", "보관위치"),
    ("detail_note", "상세메모"),
    ("sales_rep", "담당자"),
    ("usage_status", "사용여부"),
    ("usage_status_changed_month", "사용여부_변경월"),
    ("manufacture_month", "제조년월"),
]

DISPLAY_HEADERS = [label for _, label in ITMA_TEMPLATE_COLUMNS]

ITMA_DETAIL_TEMPLATE_COLUMNS = [
    ("used_group", "상세_사용그룹"),
    ("used_user", "상세_사용자"),
    ("user_position", "상세_직급"),
    ("hostname", "상세_HOSTNAME"),
    ("ip_address", "상세_IP"),
    ("os_version", "상세_OS/Version"),
    ("network_type", "상세_네트워크구분"),
    ("mac_address", "상세_Mac address"),
    ("serial_number", "상세_Serial Number"),
    ("equipment_status", "상세_장비상태"),
    ("equipment_status_date", "상세_상태일자"),
    ("vendor_name", "상세_납품업체"),
    ("vendor_contact", "상세_담당자"),
    ("vendor_phone", "상세_연락처"),
    ("vendor_mail", "상세_메일"),
    ("maintenance_start_date", "상세_유지보수_시작일"),
    ("maintenance_months", "상세_유지보수_개월"),
    ("maintenance_end_date", "상세_유지보수_종료일"),
    ("purchase_datetime", "상세_구매일시"),
    ("delivery_month", "상세_납품년월"),
    ("durability_years", "상세_내구연한(년)"),
    ("pre_auth_type", "상세_사전인증유형"),
    ("auth_completion_status", "상세_인증완료여부"),
    ("auth_number", "상세_발급(인증)번호"),
    ("auth_date", "상세_발급(인증)일"),
    ("crypto_verification_number", "상세_암호화검증번호"),
]

DETAIL_DISPLAY_HEADERS = [label for _, label in ITMA_DETAIL_TEMPLATE_COLUMNS]

ITMA_DETAIL_STATUS_OPTIONS = {"정상", "폐기", "교체", "사용", "미사용"}
ITMA_DETAIL_PREAUTH_OPTIONS = {"보안기능확인서", "국내CC인증서", "국외CC인증서", "성능평가", "취약점확인서", "기타", "없음"}
ITMA_DETAIL_AUTH_OPTIONS = {"인증조건 없음", "시험진행중", "발급(인증) 완료"}


try:
    KST = ZoneInfo("Asia/Seoul")
except ZoneInfoNotFoundError:
    KST = timezone.utc


def _now_local():
    return datetime.now(KST)


def _to_db_timestamp(dt):
    return dt.replace(tzinfo=None)


def _get_itma_dashboard_public_token(force_create=True):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT setting_value FROM system_settings WHERE setting_key = %s",
            (ITMA_DASHBOARD_TOKEN_KEY,),
        )
        row = cur.fetchone()
        token = (row[0] or "").strip() if row else ""
        if token:
            return token
        if not force_create:
            return ""

        token = secrets.token_urlsafe(32)
        cur.execute(
            """
            INSERT INTO system_settings (setting_key, setting_value, updated_at)
            VALUES (%s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (setting_key)
            DO UPDATE SET
                setting_value = EXCLUDED.setting_value,
                updated_at = CURRENT_TIMESTAMP
            """,
            (ITMA_DASHBOARD_TOKEN_KEY, token),
        )
        conn.commit()
        return token
    except Exception:
        conn.rollback()
        return ""
    finally:
        cur.close()
        conn.close()


def _is_valid_itma_dashboard_token(token):
    request_token = (token or "").strip()
    if not request_token:
        return False
    saved_token = _get_itma_dashboard_public_token(force_create=False)
    if not saved_token:
        return False
    return hmac.compare_digest(saved_token, request_token)


def _build_itma_dashboard_snapshot(cur, permissions=None):
    cur.execute(
        """
        SELECT category, manufacturer, storage_location, usage_status,
               asset_id, serial_number, updated_at, input_at, site
        FROM itma_assets
        """
    )
    rows = cur.fetchall()
    # 로그인 대시보드는 조회 권한이 있는 카테고리만 집계 (공개 토큰 대시보드는 전체)
    if permissions is not None:
        rows = [row for row in rows if _can_view_category(permissions, row[0] or "")]

    total = len(rows)

    def normalize(value, fallback="??"):
        text = str(value or "").strip()
        return text if text else fallback

    def aggregate(index):
        counter = {}
        for row in rows:
            key = normalize(row[index])
            counter[key] = counter.get(key, 0) + 1
        items = sorted(counter.items(), key=lambda x: (-x[1], x[0]))
        return [{"name": name, "count": count} for name, count in items]

    category_rows = aggregate(0)
    manufacturer_rows = aggregate(1)
    storage_rows = aggregate(2)

    status_counts = {status: 0 for status in ITMA_USAGE_STATUS_OPTIONS}
    status_counts["미지정"] = 0
    for row in rows:
        status = _normalize_usage_status(row[3]) or "미지정"
        status_counts[status] = status_counts.get(status, 0) + 1
    usage_in_use = status_counts.get("사용", 0) + status_counts.get("정상", 0)
    usage_not_in_use = status_counts.get("미사용", 0)
    site_rows = aggregate(8) if rows else []
    for site_row in site_rows:
        if site_row["name"] == "??":
            site_row["name"] = "미지정"

    def fill_rate(index):
        if total == 0:
            return 0.0
        filled = 0
        for row in rows:
            value = row[index]
            if value is None:
                continue
            if isinstance(value, str):
                if value.strip():
                    filled += 1
            else:
                filled += 1
        return round((filled / total) * 100, 1)

    category_rate = fill_rate(0)
    manufacturer_rate = fill_rate(1)
    storage_rate = fill_rate(2)
    serial_rate = fill_rate(5)
    asset_id_rate = fill_rate(4)
    quality_score = round((category_rate + manufacturer_rate + storage_rate + serial_rate + asset_id_rate) / 5, 1)

    now_naive = _to_db_timestamp(_now_local())
    updated_30d = 0
    for row in rows:
        updated_at = row[6]
        if not updated_at:
            continue
        try:
            if (now_naive - updated_at).days <= 30:
                updated_30d += 1
        except Exception:
            continue

    return {
        "kpi": {
            "category_count": len(category_rows),
            "manufacturer_count": len(manufacturer_rows),
            "storage_count": len(storage_rows),
            "total_count": total,
            "in_use_count": usage_in_use,
            "unused_count": usage_not_in_use,
            "updated_30d_count": updated_30d,
            "quality_score": quality_score,
        },
        "progress": {
            "category": category_rate,
            "manufacturer": manufacturer_rate,
            "storage": storage_rate,
            "serial": serial_rate,
            "asset_id": asset_id_rate,
        },
        "distribution": {
            "category": category_rows,
            "manufacturer": manufacturer_rows,
            "storage": storage_rows,
            "site": site_rows,
            "status": [{"name": name, "count": count} for name, count in status_counts.items() if count or name != "미지정"],
        },
    }


def _ensure_itma_table():
    conn = get_db_connection()
    cur = conn.cursor()
    try:
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
                input_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now())),
                updated_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now())),
                uploaded_by VARCHAR(50),
                updated_by VARCHAR(50)
            );
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_assets
            ADD COLUMN IF NOT EXISTS asset_id VARCHAR(100)
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_assets
            ADD COLUMN IF NOT EXISTS asset_code VARCHAR(100)
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_assets
            ADD COLUMN IF NOT EXISTS updated_by VARCHAR(50)
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_assets
            ADD COLUMN IF NOT EXISTS usage_status VARCHAR(20) DEFAULT '사용'
            """
        )
        # 운영상태: 토글(O/X) → 선택식(정상/사용/미사용/교체/폐기) 전환 (재실행 안전)
        cur.execute("ALTER TABLE itma_assets ALTER COLUMN usage_status TYPE VARCHAR(20)")
        cur.execute("ALTER TABLE itma_assets ALTER COLUMN usage_status SET DEFAULT '사용'")
        cur.execute("UPDATE itma_assets SET usage_status = '사용' WHERE usage_status = 'O'")
        cur.execute("UPDATE itma_assets SET usage_status = '미사용' WHERE usage_status = 'X'")
        # 사업장 (대전, 연구소, 구미 등)
        cur.execute("ALTER TABLE itma_assets ADD COLUMN IF NOT EXISTS site VARCHAR(100)")
        cur.execute(
            """
            ALTER TABLE itma_assets
            ADD COLUMN IF NOT EXISTS manufacture_month DATE
            """
        )
        cur.execute(
            """
            UPDATE itma_assets
            SET updated_by = uploaded_by
            WHERE updated_by IS NULL
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
            CREATE UNIQUE INDEX IF NOT EXISTS uq_itma_assets_serial
            ON itma_assets(serial_number)
            WHERE serial_number IS NOT NULL AND serial_number <> '';
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
            CREATE TABLE IF NOT EXISTS itma_asset_details (
                asset_id INTEGER PRIMARY KEY REFERENCES itma_assets(id) ON DELETE CASCADE,
                hostname VARCHAR(255),
                ip_address VARCHAR(100),
                os_version VARCHAR(255),
                mac_address VARCHAR(100),
                serial_number VARCHAR(255),
                cpu_spec VARCHAR(255),
                mem_spec VARCHAR(255),
                hdd_spec VARCHAR(255),
                nw_port VARCHAR(100),
                equipment_status VARCHAR(20),
                setting_change BOOLEAN DEFAULT FALSE,
                config_change BOOLEAN DEFAULT FALSE,
                firmware_change BOOLEAN DEFAULT FALSE,
                vendor_name VARCHAR(255),
                network_type VARCHAR(100),
                maintenance_period VARCHAR(255),
                maintenance_start_date DATE,
                maintenance_months INTEGER,
                maintenance_end_date DATE,
                vendor_contact VARCHAR(255),
                vendor_phone VARCHAR(255),
                vendor_mail VARCHAR(255),
                pre_auth_type VARCHAR(100),
                auth_completion_status VARCHAR(100),
                auth_number VARCHAR(255),
                auth_date DATE,
                crypto_verification_number VARCHAR(255),
                equipment_status_date DATE,
                used_user VARCHAR(255),
                used_group VARCHAR(255),
                user_position VARCHAR(100),
                purchase_datetime TIMESTAMP,
                delivery_month DATE,
                durability_years INTEGER,
                updated_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now())),
                updated_by VARCHAR(50)
            );
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_details
            ADD COLUMN IF NOT EXISTS network_type VARCHAR(100)
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_details
            ADD COLUMN IF NOT EXISTS mac_address VARCHAR(100)
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_details
            ADD COLUMN IF NOT EXISTS serial_number VARCHAR(255)
            """
        )
        cur.execute(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'itma_asset_details'
                      AND column_name = 'network_serial_number'
                ) THEN
                    UPDATE itma_asset_details
                    SET serial_number = network_serial_number
                    WHERE COALESCE(TRIM(serial_number), '') = ''
                      AND COALESCE(TRIM(network_serial_number), '') <> '';
                    ALTER TABLE itma_asset_details
                    DROP COLUMN network_serial_number;
                END IF;
            END $$;
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_details
            ADD COLUMN IF NOT EXISTS user_position VARCHAR(100)
            """
        )
        cur.execute(
            """
            INSERT INTO itma_asset_details (asset_id, serial_number)
            SELECT a.id, a.serial_number
            FROM itma_assets AS a
            WHERE COALESCE(TRIM(a.serial_number), '') <> ''
            ON CONFLICT (asset_id) DO UPDATE
            SET serial_number = EXCLUDED.serial_number
            WHERE COALESCE(TRIM(itma_asset_details.serial_number), '') = ''
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_details
            ADD COLUMN IF NOT EXISTS maintenance_start_date DATE
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_details
            ADD COLUMN IF NOT EXISTS maintenance_months INTEGER
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_details
            ADD COLUMN IF NOT EXISTS maintenance_end_date DATE
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_details
            ADD COLUMN IF NOT EXISTS equipment_status_date DATE
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_details
            ADD COLUMN IF NOT EXISTS vendor_phone VARCHAR(255)
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_details
            ADD COLUMN IF NOT EXISTS used_user VARCHAR(255)
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_details
            ADD COLUMN IF NOT EXISTS used_group VARCHAR(255)
            """
        )
        cur.execute(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'itma_asset_details'
                      AND column_name = 'pc_' || 'user'
                ) THEN
                    EXECUTE format(
                        'UPDATE itma_asset_details SET used_user = COALESCE(NULLIF(used_user, ''''), %I) WHERE used_user IS NULL OR used_user = ''''',
                        'pc_' || 'user'
                    );
                    EXECUTE format(
                        'ALTER TABLE itma_asset_details DROP COLUMN IF EXISTS %I',
                        'pc_' || 'user'
                    );
                END IF;

                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'itma_asset_details'
                      AND column_name = 'printer_' || 'group'
                ) THEN
                    EXECUTE format(
                        'UPDATE itma_asset_details SET used_group = COALESCE(NULLIF(used_group, ''''), %I) WHERE used_group IS NULL OR used_group = ''''',
                        'printer_' || 'group'
                    );
                    EXECUTE format(
                        'ALTER TABLE itma_asset_details DROP COLUMN IF EXISTS %I',
                        'printer_' || 'group'
                    );
                END IF;
            END $$;
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_details
            ADD COLUMN IF NOT EXISTS purchase_datetime TIMESTAMP
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_details
            ADD COLUMN IF NOT EXISTS delivery_month DATE
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_details
            ADD COLUMN IF NOT EXISTS durability_years INTEGER
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS itma_asset_detail_changes (
                id SERIAL PRIMARY KEY,
                asset_id INTEGER NOT NULL REFERENCES itma_assets(id) ON DELETE CASCADE,
                change_date DATE,
                change_type VARCHAR(100),
                change_note TEXT,
                created_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now())),
                created_by VARCHAR(50)
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_itma_asset_detail_changes_asset_id
            ON itma_asset_detail_changes(asset_id, change_date DESC, id DESC);
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS itma_asset_delivery_changes (
                id SERIAL PRIMARY KEY,
                asset_id INTEGER NOT NULL REFERENCES itma_assets(id) ON DELETE CASCADE,
                change_date DATE,
                vendor_name VARCHAR(255),
                maintenance_start_date DATE,
                maintenance_months INTEGER,
                maintenance_end_date DATE,
                vendor_contact VARCHAR(255),
                vendor_phone VARCHAR(255),
                vendor_mail VARCHAR(255),
                change_note TEXT,
                created_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now())),
                created_by VARCHAR(50)
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_itma_asset_delivery_changes_asset_id
            ON itma_asset_delivery_changes(asset_id, change_date DESC, id DESC);
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS itma_asset_equipment_changes (
                id SERIAL PRIMARY KEY,
                asset_id INTEGER NOT NULL REFERENCES itma_assets(id) ON DELETE CASCADE,
                status_date DATE,
                equipment_status VARCHAR(20),
                created_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now())),
                created_by VARCHAR(50)
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_itma_asset_equipment_changes_asset_id
            ON itma_asset_equipment_changes(asset_id, status_date DESC, id DESC);
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS itma_asset_security_changes (
                id SERIAL PRIMARY KEY,
                asset_id INTEGER NOT NULL REFERENCES itma_assets(id) ON DELETE CASCADE,
                change_date DATE,
                pre_auth_type VARCHAR(100),
                auth_completion_status VARCHAR(100),
                auth_number VARCHAR(255),
                auth_date DATE,
                crypto_verification_number VARCHAR(255),
                created_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now())),
                created_by VARCHAR(50)
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_itma_asset_security_changes_asset_id
            ON itma_asset_security_changes(asset_id, change_date DESC, id DESC);
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS itma_asset_software_items (
                id SERIAL PRIMARY KEY,
                asset_id INTEGER NOT NULL REFERENCES itma_assets(id) ON DELETE CASCADE,
                software_name VARCHAR(255),
                version VARCHAR(120),
                install_date DATE,
                expiry_date DATE,
                installed_quantity INTEGER,
                deployment_target VARCHAR(255),
                network_type VARCHAR(100),
                status VARCHAR(100),
                change_note TEXT,
                created_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now())),
                created_by VARCHAR(50)
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_itma_asset_software_items_asset_id
            ON itma_asset_software_items(asset_id, install_date DESC, id DESC);
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS itma_asset_license_items (
                id SERIAL PRIMARY KEY,
                asset_id INTEGER NOT NULL REFERENCES itma_assets(id) ON DELETE CASCADE,
                license_name VARCHAR(255),
                version VARCHAR(120),
                install_date DATE,
                license_quantity INTEGER,
                expiry_date DATE,
                network_type VARCHAR(100),
                compliance_status VARCHAR(100),
                change_note TEXT,
                created_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now())),
                created_by VARCHAR(50)
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_itma_asset_license_items_asset_id
            ON itma_asset_license_items(asset_id, expiry_date DESC, id DESC);
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS itma_custom_columns (
                id SERIAL PRIMARY KEY,
                column_key VARCHAR(100) UNIQUE NOT NULL,
                column_label VARCHAR(120) NOT NULL,
                display_order INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now())),
                created_by VARCHAR(50),
                updated_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now())),
                updated_by VARCHAR(50)
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_itma_custom_columns_order
            ON itma_custom_columns(display_order ASC, id ASC);
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS itma_custom_column_values (
                id SERIAL PRIMARY KEY,
                asset_id INTEGER NOT NULL REFERENCES itma_assets(id) ON DELETE CASCADE,
                column_key VARCHAR(100) NOT NULL REFERENCES itma_custom_columns(column_key) ON DELETE CASCADE,
                column_value TEXT,
                updated_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now())),
                updated_by VARCHAR(50),
                UNIQUE(asset_id, column_key)
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
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS itma_deleted_categories (
                category_key VARCHAR(50) PRIMARY KEY
            )
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
                created_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now())),
                updated_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now())),
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
                created_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now())),
                updated_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now())),
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
            ALTER TABLE itma_asset_spec_items
            ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_spec_items
            ADD COLUMN IF NOT EXISTS source_form_item_id INTEGER REFERENCES itma_spec_form_items(id) ON DELETE SET NULL
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_spec_items
            ADD COLUMN IF NOT EXISTS updated_by VARCHAR(50)
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_spec_forms
            ADD COLUMN IF NOT EXISTS category_key VARCHAR(50)
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_spec_forms
            ADD COLUMN IF NOT EXISTS description TEXT
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_spec_forms
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_spec_forms
            ADD COLUMN IF NOT EXISTS created_by VARCHAR(50)
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_spec_forms
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT (timezone('Asia/Seoul', now()))
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_spec_form_items
            ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS show_in_list BOOLEAN NOT NULL DEFAULT FALSE
            """
        )
        cur.execute(
            """
            INSERT INTO itma_categories (category_key, display_name, supports_spec_forms, display_order)
            SELECT defaults.* FROM (VALUES
                ('pc', 'PC', TRUE, 10), ('printer', '프린터', TRUE, 20),
                ('software', '소프트웨어', FALSE, 30), ('license', '라이선스', FALSE, 40),
                ('hardware', '하드웨어', TRUE, 50), ('network', '네트워크', TRUE, 60),
                ('security', '보안', TRUE, 70), ('server', '서버', TRUE, 80),
                ('solution', '솔루션', TRUE, 90), ('cloud', '클라우드', TRUE, 100),
                ('other', '그외', TRUE, 110)
            ) AS defaults(category_key, display_name, supports_spec_forms, display_order)
            WHERE NOT EXISTS (
                SELECT 1 FROM itma_deleted_categories deleted
                WHERE deleted.category_key = defaults.category_key
            )
            ON CONFLICT (category_key) DO NOTHING
            """
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_itma_asset_spec_source
            ON itma_asset_spec_items(asset_id, source_form_item_id)
            WHERE source_form_item_id IS NOT NULL
            """
        )
        cur.execute(
            """
            UPDATE itma_spec_forms
            SET category_key = 'other'
            WHERE category_key IS NULL OR TRIM(category_key) = ''
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_itma_asset_spec_items_asset
            ON itma_asset_spec_items(asset_id, display_order ASC, id ASC)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_itma_spec_forms_category
            ON itma_spec_forms(category_key, form_name)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_itma_spec_form_items_form
            ON itma_spec_form_items(form_id, display_order ASC, id ASC)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_itma_custom_column_values_asset
            ON itma_custom_column_values(asset_id, column_key);
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_delivery_changes
            ADD COLUMN IF NOT EXISTS vendor_phone VARCHAR(255)
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_details
            ADD COLUMN IF NOT EXISTS vendor_mail VARCHAR(255)
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_delivery_changes
            ADD COLUMN IF NOT EXISTS vendor_mail VARCHAR(255)
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_software_items
            ADD COLUMN IF NOT EXISTS expiry_date DATE
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_software_items
            ADD COLUMN IF NOT EXISTS network_type VARCHAR(100)
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_license_items
            ADD COLUMN IF NOT EXISTS version VARCHAR(120)
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_license_items
            ADD COLUMN IF NOT EXISTS install_date DATE
            """
        )
        cur.execute(
            """
            ALTER TABLE itma_asset_license_items
            ADD COLUMN IF NOT EXISTS network_type VARCHAR(100)
            """
        )
        conn.commit()
    finally:
        cur.close()
        conn.close()


def _require_itma_role():
    if "username" not in session:
        return jsonify({"success": False, "message": "로그인이 필요합니다."}), 401
    if session.get("role") not in ["admin", "manager", "user"]:
        return jsonify({"success": False, "message": "권한이 없습니다."}), 403
    permissions = _get_session_itma_permissions()
    if session.get("role") != "admin" and not permissions.get("view_categories"):
        return jsonify({
            "success": False,
            "message": "현재 계정에 그룹/권한이 배정되지 않았습니다. 관리자에게 그룹/권한 설정을 요청하세요.",
            "error": "permission_group_required",
        }), 403
    return permissions


def _get_itma_actor_name():
    user_id = _clean_text(session.get("username")) or ""
    if not user_id:
        return ""
    cached_name = _clean_text(session.get("real_name")) or ""
    if cached_name:
        return cached_name
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT real_name FROM users WHERE username = %s", (user_id,))
        row = cur.fetchone()
        real_name = _clean_text(row[0]) if row and row[0] is not None else ""
        actor_name = real_name or user_id
        session["real_name"] = actor_name
        return actor_name
    except Exception:
        return user_id
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def _clean_text(value):
    if value is None:
        return None
    text = str(value).strip()
    if text == "" or text.lower() == "nan":
        return None
    return text


def _to_date(value):
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value
    dt = pd.to_datetime(value, errors="coerce")
    if pd.isna(dt):
        return None
    return dt.date()


def _to_datetime(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    dt = pd.to_datetime(value, errors="coerce")
    if pd.isna(dt):
        return None
    if hasattr(dt, "to_pydatetime"):
        return dt.to_pydatetime().replace(tzinfo=None)
    return None




def _parse_month_date(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return date(value.year, value.month, 1)
    if isinstance(value, date):
        return date(value.year, value.month, 1)

    text = str(value).strip()
    if not text:
        return None
    text = text.replace(".", "-").replace("/", "-")
    m = re.match(r"^(\d{4})-(\d{1,2})$", text)
    if m:
        return date(int(m.group(1)), int(m.group(2)), 1)

    dt = pd.to_datetime(text, errors="coerce")
    if pd.isna(dt):
        return None
    return date(int(dt.year), int(dt.month), 1)


def _to_bool(value):
    if isinstance(value, bool):
        return value
    text = (_clean_text(value) or "").strip().lower()
    return text in {"1", "true", "y", "yes", "o"}


def _normalize_detail_choice(value, allowed):
    text = _clean_text(value)
    if not text:
        return ""
    return text if text in allowed else ""


def _add_months(base_date, months):
    if not base_date or months is None:
        return None
    total = base_date.year * 12 + (base_date.month - 1) + int(months)
    year = total // 12
    month = total % 12 + 1
    return date(year, month, 1)


def _empty_asset_details():
    return {
        "hostname": "",
        "ip_address": "",
        "os_version": "",
        "mac_address": "",
        "serial_number": "",
        "spec_items": [],
        "cpu_spec": "",
        "mem_spec": "",
        "hdd_spec": "",
        "nw_port": "",
        "equipment_status": "",
        "setting_change": False,
        "config_change": False,
        "firmware_change": False,
        "vendor_name": "",
        "network_type": "",
        "maintenance_period": "",
        "maintenance_start_date": "",
        "maintenance_months": "",
        "maintenance_end_date": "",
        "vendor_contact": "",
        "vendor_phone": "",
        "vendor_mail": "",
        "pre_auth_type": "",
        "auth_completion_status": "",
        "auth_number": "",
        "auth_date": "",
        "crypto_verification_number": "",
        "equipment_status_date": "",
        "used_group": "",
        "used_user": "",
        "user_position": "",
        "purchase_datetime": "",
        "delivery_month": "",
        "durability_years": "",
        "equipment_changes": [],
        "security_changes": [],
        "detail_changes": [],
        "delivery_changes": [],
        "software_items": [],
        "license_items": [],
        "updated_at": "",
        "updated_by": "",
    }


def _asset_details_row_to_item(
    row,
    detail_changes=None,
    delivery_changes=None,
    equipment_changes=None,
    security_changes=None,
    software_items=None,
    license_items=None,
    spec_items=None,
):
    base = _empty_asset_details()
    if not row:
        if detail_changes is not None:
            base["detail_changes"] = detail_changes
        if delivery_changes is not None:
            base["delivery_changes"] = delivery_changes
        if equipment_changes is not None:
            base["equipment_changes"] = equipment_changes
        if security_changes is not None:
            base["security_changes"] = security_changes
        if software_items is not None:
            base["software_items"] = software_items
        if license_items is not None:
            base["license_items"] = license_items
        if spec_items is not None:
            base["spec_items"] = spec_items
        return base
    item = {
        "hostname": row[0] or "",
        "ip_address": row[1] or "",
        "os_version": row[2] or "",
        "mac_address": row[34] or "" if len(row) > 34 else "",
        "serial_number": row[35] or "" if len(row) > 35 else "",
        "spec_items": [],
        "cpu_spec": row[3] or "",
        "mem_spec": row[4] or "",
        "hdd_spec": row[5] or "",
        "nw_port": row[6] or "",
        "equipment_status": row[7] or "",
        "setting_change": bool(row[8]),
        "config_change": bool(row[9]),
        "firmware_change": bool(row[10]),
        "vendor_name": row[11] or "",
        "network_type": row[32] or "" if len(row) > 32 else "",
        "maintenance_period": row[12] or "",
        "maintenance_start_date": row[13].strftime("%Y-%m-%d") if row[13] else "",
        "maintenance_months": str(row[14]) if row[14] is not None else "",
        "maintenance_end_date": row[15].strftime("%Y-%m-%d") if row[15] else "",
        "vendor_contact": row[16] or "",
        "vendor_phone": row[17] or "",
        "vendor_mail": row[18] or "",
        "pre_auth_type": row[19] or "",
        "auth_completion_status": row[20] or "",
        "auth_number": row[21] or "",
        "auth_date": row[22].strftime("%Y-%m-%d") if row[22] else "",
        "crypto_verification_number": row[23] or "",
        "equipment_status_date": row[24].strftime("%Y-%m-%d") if row[24] else "",
        "used_user": row[25] or "",
        "used_group": row[26] or "",
        "user_position": row[33] or "" if len(row) > 33 else "",
        "purchase_datetime": row[27].strftime("%Y-%m-%d %H:%M") if row[27] else "",
        "delivery_month": row[28].strftime("%Y-%m") if row[28] else "",
        "durability_years": str(row[29]) if row[29] is not None else "",
        "equipment_changes": equipment_changes or [],
        "security_changes": security_changes or [],
        "updated_at": row[30].strftime("%Y-%m-%d %H:%M:%S") if row[30] else "",
        "updated_by": row[31] or "",
        "detail_changes": detail_changes or [],
        "delivery_changes": delivery_changes or [],
        "software_items": software_items or [],
        "license_items": license_items or [],
        "spec_items": spec_items or [],
    }
    return item


def _normalize_detail_changes(payload):
    rows = payload if isinstance(payload, list) else []
    normalized_rows = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        change_date = _to_date(row.get("change_date"))
        change_type = _clean_text(row.get("change_type")) or ""
        change_note = _clean_text(row.get("change_note")) or ""
        if not change_date and not change_type and not change_note:
            continue
        normalized_rows.append(
            {
                "change_date": change_date,
                "change_type": change_type,
                "change_note": change_note,
            }
        )
    normalized_rows.sort(key=lambda x: (x["change_date"] or date(1900, 1, 1), x["change_type"], x["change_note"]))
    return normalized_rows


def _normalize_equipment_changes(payload):
    rows = payload if isinstance(payload, list) else []
    normalized_rows = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        status_date = _to_date(row.get("status_date"))
        equipment_status = _normalize_detail_choice(row.get("equipment_status"), ITMA_DETAIL_STATUS_OPTIONS)
        if not status_date and not equipment_status:
            continue
        normalized_rows.append(
            {
                "status_date": status_date,
                "equipment_status": equipment_status,
            }
        )
    normalized_rows.sort(key=lambda x: (x["status_date"] or date(1900, 1, 1), x["equipment_status"]))
    return normalized_rows


def _normalize_delivery_changes(payload):
    rows = payload if isinstance(payload, list) else []
    normalized_rows = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        change_date = _to_date(row.get("change_date"))
        vendor_name = _clean_text(row.get("vendor_name")) or ""
        maintenance_start_date = _to_date(row.get("maintenance_start_date"))
        maintenance_months_raw = _clean_text(row.get("maintenance_months"))
        maintenance_months = None
        if maintenance_months_raw not in (None, ""):
            try:
                maintenance_months = max(0, int(maintenance_months_raw))
            except Exception:
                maintenance_months = None
        maintenance_end_date = _to_date(row.get("maintenance_end_date")) or _add_months(maintenance_start_date, maintenance_months)
        vendor_contact = _clean_text(row.get("vendor_contact")) or ""
        vendor_phone = _clean_text(row.get("vendor_phone")) or ""
        vendor_mail = _clean_text(row.get("vendor_mail")) or ""
        change_note = _clean_text(row.get("change_note")) or ""

        if not (change_date or vendor_name or vendor_contact or vendor_phone or vendor_mail or change_note or maintenance_start_date or maintenance_months is not None):
            continue

        normalized_rows.append(
            {
                "change_date": change_date,
                "vendor_name": vendor_name,
                "maintenance_start_date": maintenance_start_date,
                "maintenance_months": maintenance_months,
                "maintenance_end_date": maintenance_end_date,
                "vendor_contact": vendor_contact,
                "vendor_phone": vendor_phone,
                "vendor_mail": vendor_mail,
                "change_note": change_note,
            }
        )
    normalized_rows.sort(key=lambda x: (x["change_date"] or date(1900, 1, 1), x["vendor_name"], x["vendor_contact"], x["vendor_phone"], x["vendor_mail"]))
    return normalized_rows


def _normalize_security_changes(payload):
    rows = payload if isinstance(payload, list) else []
    normalized_rows = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        change_date = _to_date(row.get("change_date"))
        pre_auth_type = _normalize_detail_choice(row.get("pre_auth_type"), ITMA_DETAIL_PREAUTH_OPTIONS)
        auth_completion_status = _normalize_detail_choice(row.get("auth_completion_status"), ITMA_DETAIL_AUTH_OPTIONS)
        auth_number = _clean_text(row.get("auth_number")) or ""
        auth_date = _to_date(row.get("auth_date"))
        crypto_verification_number = _clean_text(row.get("crypto_verification_number")) or ""
        if not (change_date or pre_auth_type or auth_completion_status or auth_number or auth_date or crypto_verification_number):
            continue
        normalized_rows.append(
            {
                "change_date": change_date,
                "pre_auth_type": pre_auth_type,
                "auth_completion_status": auth_completion_status,
                "auth_number": auth_number,
                "auth_date": auth_date,
                "crypto_verification_number": crypto_verification_number,
            }
        )
    normalized_rows.sort(
        key=lambda x: (
            x["change_date"] or date(1900, 1, 1),
            x["pre_auth_type"],
            x["auth_completion_status"],
            x["auth_number"],
        )
    )
    return normalized_rows


def _normalize_software_items(payload):
    rows = payload if isinstance(payload, list) else []
    normalized_rows = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        software_name = _clean_text(row.get("software_name")) or ""
        version = _clean_text(row.get("version")) or ""
        install_date = _to_date(row.get("install_date"))
        expiry_date = _to_date(row.get("expiry_date"))
        installed_quantity_raw = _clean_text(row.get("installed_quantity") or row.get("quantity"))
        installed_quantity = None
        if installed_quantity_raw not in (None, ""):
            try:
                installed_quantity = max(0, int(installed_quantity_raw))
            except Exception:
                installed_quantity = None
        deployment_target = _clean_text(row.get("deployment_target") or row.get("network_type")) or ""
        status = _clean_text(row.get("status")) or ""
        change_note = _clean_text(row.get("change_note") or row.get("note")) or ""
        if not (software_name or version or install_date or expiry_date or installed_quantity is not None or deployment_target or status or change_note):
            continue
        normalized_rows.append(
            {
                "software_name": software_name,
                "version": version,
                "install_date": install_date,
                "expiry_date": expiry_date,
                "installed_quantity": installed_quantity,
                "deployment_target": deployment_target,
                "network_type": deployment_target,
                "status": status,
                "change_note": change_note,
                "note": change_note,
                "quantity": installed_quantity,
            }
        )
    normalized_rows.sort(
        key=lambda x: (
            x["install_date"] or date(1900, 1, 1),
            x["software_name"],
            x["version"],
        )
    )
    return normalized_rows


def _normalize_license_items(payload):
    rows = payload if isinstance(payload, list) else []
    normalized_rows = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        license_name = _clean_text(row.get("license_name")) or ""
        version = _clean_text(row.get("version")) or ""
        install_date = _to_date(row.get("install_date"))
        license_quantity_raw = _clean_text(row.get("license_quantity") or row.get("quantity"))
        license_quantity = None
        if license_quantity_raw not in (None, ""):
            try:
                license_quantity = max(0, int(license_quantity_raw))
            except Exception:
                license_quantity = None
        expiry_date = _to_date(row.get("expiry_date"))
        network_type = _clean_text(row.get("network_type") or row.get("deployment_target")) or ""
        change_note = _clean_text(row.get("change_note") or row.get("note")) or ""
        if not (license_name or version or install_date or license_quantity is not None or expiry_date or network_type or change_note):
            continue
        normalized_rows.append(
            {
                "license_name": license_name,
                "version": version,
                "install_date": install_date,
                "license_quantity": license_quantity,
                "expiry_date": expiry_date,
                "network_type": network_type,
                "vendor_name": network_type,
                "compliance_status": "",
                "change_note": change_note,
                "note": change_note,
                "quantity": license_quantity,
            }
        )
    normalized_rows.sort(
        key=lambda x: (
            x["expiry_date"] or date(1900, 1, 1),
            x["license_name"],
            x["version"],
        )
    )
    return normalized_rows


def _normalize_asset_details_payload(payload):
    data = payload or {}
    equipment_changes = _normalize_equipment_changes(data.get("equipment_changes"))
    latest_equipment = equipment_changes[-1] if equipment_changes else {}
    delivery_changes = _normalize_delivery_changes(data.get("delivery_changes"))
    latest_delivery = delivery_changes[-1] if delivery_changes else {}
    security_changes = _normalize_security_changes(data.get("security_changes"))
    latest_security = security_changes[-1] if security_changes else {}
    software_items = _normalize_software_items(data.get("software_items"))
    license_items = _normalize_license_items(data.get("license_items"))
    spec_items = _normalize_spec_items(data.get("spec_items"))

    return {
        "hostname": _clean_text(data.get("hostname")) or "",
        "ip_address": _clean_text(data.get("ip_address")) or "",
        "os_version": _clean_text(data.get("os_version")) or "",
        "mac_address": _clean_text(data.get("mac_address")) or "",
        "serial_number": _clean_text(data.get("serial_number")) or "",
        "cpu_spec": _clean_text(data.get("cpu_spec")) or "",
        "mem_spec": _clean_text(data.get("mem_spec")) or "",
        "hdd_spec": _clean_text(data.get("hdd_spec")) or "",
        "nw_port": _clean_text(data.get("nw_port")) or "",
        "equipment_status": latest_equipment.get("equipment_status") or _normalize_detail_choice(data.get("equipment_status"), ITMA_DETAIL_STATUS_OPTIONS),
        "setting_change": _to_bool(data.get("setting_change")),
        "config_change": _to_bool(data.get("config_change")),
        "firmware_change": _to_bool(data.get("firmware_change")),
        "vendor_name": latest_delivery.get("vendor_name", ""),
        "network_type": _clean_text(data.get("network_type")) or "",
        "maintenance_period": _clean_text(data.get("maintenance_period")) or "",
        "maintenance_start_date": latest_delivery.get("maintenance_start_date"),
        "maintenance_months": latest_delivery.get("maintenance_months"),
        "maintenance_end_date": latest_delivery.get("maintenance_end_date"),
        "vendor_contact": latest_delivery.get("vendor_contact", ""),
        "vendor_phone": latest_delivery.get("vendor_phone", ""),
        "vendor_mail": latest_delivery.get("vendor_mail", ""),
        "pre_auth_type": latest_security.get("pre_auth_type") or _normalize_detail_choice(data.get("pre_auth_type"), ITMA_DETAIL_PREAUTH_OPTIONS),
        "auth_completion_status": latest_security.get("auth_completion_status") or _normalize_detail_choice(data.get("auth_completion_status"), ITMA_DETAIL_AUTH_OPTIONS),
        "auth_number": latest_security.get("auth_number") or _clean_text(data.get("auth_number")) or "",
        "auth_date": latest_security.get("auth_date") or _to_date(data.get("auth_date")),
        "crypto_verification_number": latest_security.get("crypto_verification_number") or _clean_text(data.get("crypto_verification_number")) or "",
        "equipment_status_date": latest_equipment.get("status_date") or _to_date(data.get("equipment_status_date")),
        "used_user": _clean_text(data.get("used_user")) or "",
        "used_group": _clean_text(data.get("used_group")) or "",
        "user_position": _clean_text(data.get("user_position")) or "",
        "purchase_datetime": _to_datetime(data.get("purchase_datetime")),
        "delivery_month": _parse_month_date(data.get("delivery_month")),
        "durability_years": max(1, int(_clean_text(data.get("durability_years")))) if (_clean_text(data.get("durability_years")) or "").isdigit() and int(_clean_text(data.get("durability_years"))) > 0 else None,
        "equipment_changes": equipment_changes,
        "security_changes": security_changes,
        "detail_changes": _normalize_detail_changes(data.get("detail_changes")),
        "delivery_changes": delivery_changes,
        "software_items": software_items,
        "license_items": license_items,
        "spec_items": spec_items,
    }


def _asset_detail_history_summary(payload_like):
    return {
        "equipment_status": payload_like.get("equipment_status") or "",
        "equipment_status_date": (
            payload_like.get("equipment_status_date").strftime("%Y-%m-%d")
            if isinstance(payload_like.get("equipment_status_date"), date)
            else (payload_like.get("equipment_status_date") or "")
        ),
        "vendor_name": payload_like.get("vendor_name") or "",
        "maintenance_start_date": (
            payload_like.get("maintenance_start_date").strftime("%Y-%m-%d")
            if isinstance(payload_like.get("maintenance_start_date"), date)
            else (payload_like.get("maintenance_start_date") or "")
        ),
        "maintenance_months": (
            str(payload_like.get("maintenance_months"))
            if payload_like.get("maintenance_months") is not None
            else ""
        ),
        "maintenance_end_date": (
            payload_like.get("maintenance_end_date").strftime("%Y-%m-%d")
            if isinstance(payload_like.get("maintenance_end_date"), date)
            else (payload_like.get("maintenance_end_date") or "")
        ),
        "pre_auth_type": payload_like.get("pre_auth_type") or "",
        "auth_completion_status": payload_like.get("auth_completion_status") or "",
        "auth_number": payload_like.get("auth_number") or "",
        "auth_date": (
            payload_like.get("auth_date").strftime("%Y-%m-%d")
            if isinstance(payload_like.get("auth_date"), date)
            else (payload_like.get("auth_date") or "")
        ),
        "used_group": payload_like.get("used_group") or "",
        "used_user": payload_like.get("used_user") or "",
        "purchase_datetime": (
            payload_like.get("purchase_datetime").strftime("%Y-%m-%d %H:%M")
            if isinstance(payload_like.get("purchase_datetime"), datetime)
            else (payload_like.get("purchase_datetime") or "")
        ),
        "delivery_month": (
            payload_like.get("delivery_month").strftime("%Y-%m")
            if isinstance(payload_like.get("delivery_month"), date)
            else (payload_like.get("delivery_month") or "")
        ),
        "durability_years": (
            str(payload_like.get("durability_years"))
            if payload_like.get("durability_years") is not None
            else ""
        ),
        "detail_changes_count": len(payload_like.get("detail_changes") or []),
        "equipment_changes_count": len(payload_like.get("equipment_changes") or []),
        "delivery_changes_count": len(payload_like.get("delivery_changes") or []),
        "security_changes_count": len(payload_like.get("security_changes") or []),
        "software_items_count": len(payload_like.get("software_items") or []),
        "license_items_count": len(payload_like.get("license_items") or []),
        "spec_items_count": len(payload_like.get("spec_items") or []),
    }


# 운영상태 선택지 (장비상태와 같은 값 체계). 이전 O/X 값은 사용/미사용으로 해석한다.
ITMA_USAGE_STATUS_OPTIONS = ("정상", "사용", "미사용", "교체", "폐기")


def _normalize_usage_status(value):
    text = re.sub(r"\s+", "", _clean_text(value) or "")
    if not text:
        return ""
    if text in ITMA_USAGE_STATUS_OPTIONS:
        return text
    upper = text.upper()
    if upper in {"X", "N", "NO", "FALSE", "0"}:
        return "미사용"
    if upper in {"O", "Y", "YES", "TRUE", "1"}:
        return "사용"
    return ""


def _normalize_equipment_status_to_usage(value):
    return _normalize_usage_status(value)


def _usage_to_equipment_status(value):
    return _normalize_usage_status(value)


def _latest_usage_from_equipment_changes(rows):
    if not isinstance(rows, list):
        return ""
    for row in reversed(rows):
        if not isinstance(row, dict):
            continue
        mapped = _normalize_equipment_status_to_usage(row.get("equipment_status"))
        if mapped:
            return mapped
    return ""

def _normalize_serial(value):
    text = _clean_text(value)
    if not text:
        return ""
    return re.sub(r"[\s\-_]+", "", text).upper()


def _normalize_asset_seed(value):
    text = _clean_text(value)
    if not text:
        return ""
    text = re.sub(r"[^0-9A-Za-z_-]+", "-", text).strip("-_")
    return text.upper()


def _make_generated_asset_code(seed, seq):
    return f"{seed}-{int(seq):04d}"


def _next_asset_code(cur, seed="ITMA"):
    normalized_seed = _normalize_asset_seed(seed) or "ITMA"
    cur.execute(
        """
        SELECT asset_code
        FROM itma_assets
        WHERE asset_code IS NOT NULL AND asset_code <> ''
        """
    )
    max_seq = 0
    pattern = re.compile(rf"^{re.escape(normalized_seed)}-(\d+)$")
    for row in cur.fetchall():
        if not row:
            continue
        code = _clean_text(row[0])
        if not code:
            continue
        matched = pattern.match(code)
        if matched:
            max_seq = max(max_seq, int(matched.group(1)))
    return _make_generated_asset_code(normalized_seed, max_seq + 1)


def _value_to_history_text(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    return str(value)


def _asset_row_to_item(row):
    item = {
        "id": row[0],
        "category": row[1] or "",
        "manufacturer": row[2] or "",
        "item_name": row[3] or "",
        "serial_number": row[4] or "",
        "received_date": row[5].strftime("%Y-%m-%d") if row[5] else "",
        "inbound_note": row[6] or "",
        "released_date": row[7].strftime("%Y-%m-%d") if row[7] else "",
        "outbound_note": row[8] or "",
        "storage_location": row[9] or "",
        "detail_note": row[10] or "",
        "sales_rep": row[11] or "",
        "usage_status": row[12] or "",
        "manufacture_month": row[13].strftime("%Y-%m") if row[13] else "",
        "input_at": row[14].strftime("%Y-%m-%d %H:%M:%S") if row[14] else "",
        "updated_at": row[15].strftime("%Y-%m-%d %H:%M:%S") if row[15] else "",
        "updated_by": row[16] or "",
        "asset_id": row[17] or "",
        "asset_code": row[18] or "",
    }
    if len(row) > 19:
        item["row_no"] = int(row[19]) if row[19] is not None else None
    if len(row) > 20:
        item["delivery_month"] = row[20].strftime("%Y-%m") if row[20] else ""
    else:
        item["delivery_month"] = ""
    if len(row) > 21:
        item["durability_years"] = str(row[21]) if row[21] is not None else ""
    else:
        item["durability_years"] = ""
    item["site"] = (row[22] or "") if len(row) > 22 else ""
    return item


def _attach_site(cur, item):
    """자산 dict에 사업장(site) 값을 붙인다. (19컬럼 공통 조회 결과에는 site가 없음)"""
    if not item or item.get("id") is None:
        return item
    cur.execute("SELECT site FROM itma_assets WHERE id = %s", (item["id"],))
    row = cur.fetchone()
    item["site"] = (row[0] or "") if row else item.get("site", "")
    return item


def _normalize_custom_column_label(value):
    text = _clean_text(value) or ""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > 120:
        text = text[:120].strip()
    return text


def _make_custom_column_key(label, fallback_seed):
    seed = _clean_text(label) or fallback_seed
    safe = re.sub(r"[^A-Za-z0-9가-힣_]+", "_", seed).strip("_").lower()
    if not safe:
        safe = f"custom_{fallback_seed}"
    if not safe.startswith("custom_"):
        safe = f"custom_{safe}"
    return safe[:96]


def _load_custom_columns(cur):
    cur.execute(
        """
        SELECT column_key, column_label, display_order
        FROM itma_custom_columns
        ORDER BY display_order ASC, id ASC
        """
    )
    rows = cur.fetchall()
    return [
        {
            "key": row[0] or "",
            "label": row[1] or "",
            "display_order": int(row[2]) if row[2] is not None else 0,
        }
        for row in rows
        if (row[0] or "").strip()
    ]


def _load_custom_column_values(cur, asset_ids):
    parsed_ids = []
    for value in asset_ids or []:
        try:
            parsed_ids.append(int(value))
        except (TypeError, ValueError):
            continue
    parsed_ids = sorted(set(parsed_ids))
    if not parsed_ids:
        return {}

    cur.execute(
        """
        SELECT asset_id, column_key, column_value
        FROM itma_custom_column_values
        WHERE asset_id = ANY(%s)
        """,
        (parsed_ids,),
    )
    rows = cur.fetchall()
    result = {}
    for row in rows:
        asset_id = str(row[0]) if row and row[0] is not None else ""
        column_key = _clean_text(row[1]) or ""
        if not asset_id or not column_key:
            continue
        if asset_id not in result:
            result[asset_id] = {}
        result[asset_id][column_key] = row[2] if row[2] is not None else ""
    return result


DETAIL_COLUMN_DEFINITIONS = (
    ("detail_used_group", "그룹", "equipment", "user", "used_group"),
    ("detail_used_user", "사용자", "equipment", "user", "used_user"),
    ("detail_user_position", "직급", "equipment", "user", "user_position"),
    ("detail_network_type", "네트워크 구분", "equipment", "network", "network_type"),
    ("detail_ip_address", "IP/Subnet", "equipment", "network", "ip_address"),
    ("detail_mac_address", "Mac address", "equipment", "network", "mac_address"),
    ("detail_hostname", "장비명", "device", "device", "hostname"),
    ("detail_os_version", "OS/Version", "device", "device", "os_version"),
    ("detail_serial_number", "Serial Number", "device", "device", "serial_number"),
)
EDITABLE_DETAIL_FIELDS = {definition[4] for definition in DETAIL_COLUMN_DEFINITIONS}


def _load_detail_column_values(cur, asset_ids):
    ids = sorted({int(value) for value in asset_ids or [] if str(value).isdigit()})
    if not ids:
        return {}
    cur.execute(
        """
        SELECT asset_id, used_group, used_user, user_position, network_type, ip_address, mac_address,
               hostname, os_version, serial_number
        FROM itma_asset_details WHERE asset_id = ANY(%s)
        """,
        (ids,),
    )
    fields = [row[4] for row in DETAIL_COLUMN_DEFINITIONS]
    return {
        str(row[0]): {f"detail_{field}": row[index + 1] or "" for index, field in enumerate(fields)}
        for row in cur.fetchall()
    }


def _load_visible_spec_columns(cur, permissions):
    cur.execute(
        """
        SELECT sfi.id, sf.category_key, sf.id, sf.form_name, sfi.spec_label, sfi.display_order,
               COALESCE(ic.display_name, sf.category_key)
        FROM itma_spec_form_items sfi
        JOIN itma_spec_forms sf ON sf.id = sfi.form_id
        LEFT JOIN itma_categories ic ON ic.category_key = sf.category_key
        WHERE sf.is_active = TRUE AND sfi.show_in_list = TRUE
        ORDER BY COALESCE(ic.display_order, 9999), sf.id, sfi.display_order, sfi.id
        """
    )
    columns = []
    for row in cur.fetchall():
        if not _can_view_category(permissions, row[1]):
            continue
        columns.append({
            # 컬럼명은 스펙 폼에서 입력한 항목명만 표시 (카테고리·폼명은 category_name/form_name으로 유지)
            "key": f"spec_{row[0]}", "label": str(row[4] or "").strip() or f"{row[6]} / {row[3]}",
            "group_key": "spec", "category_key": row[1], "category_name": row[6],
            "form_id": row[2], "form_name": row[3], "form_item_id": row[0],
            "display_order": row[5] or 0, "readonly": True, "default_visible": True,
        })
    return columns


def _load_spec_column_values(cur, asset_ids, columns):
    ids = sorted({int(value) for value in asset_ids or [] if str(value).isdigit()})
    form_item_ids = [column["form_item_id"] for column in columns]
    if not ids or not form_item_ids:
        return {}
    cur.execute(
        """
        SELECT asi.asset_id, asi.source_form_item_id, asi.spec_value
        FROM itma_asset_spec_items asi
        WHERE asi.asset_id = ANY(%s) AND asi.source_form_item_id = ANY(%s)
        """,
        (ids, form_item_ids),
    )
    values = {}
    for asset_id, form_item_id, value in cur.fetchall():
        values.setdefault(str(asset_id), {})[f"spec_{form_item_id}"] = value or ""
    return values


def _insert_history(
    cur,
    asset_id,
    action,
    actor,
    changed_column=None,
    before_value=None,
    after_value=None,
    snapshot=None,
    restored_from_history_id=None,
):
    cur.execute(
        """
        INSERT INTO itma_asset_history (
            asset_id, action, changed_column, before_value, after_value,
            snapshot_data, restored_from_history_id, actor, created_at
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            asset_id,
            action,
            changed_column,
            _value_to_history_text(before_value),
            _value_to_history_text(after_value),
            json.dumps(snapshot, ensure_ascii=False) if snapshot is not None else None,
            restored_from_history_id,
            actor,
            _to_db_timestamp(_now_local()),
        ),
    )


def _parse_value_by_column(column, value):
    if column == "category":
        return _normalize_category(value)
    if column in {"received_date", "released_date"}:
        return _to_date(value)
    if column == "manufacture_month":
        return _parse_month_date(value)
    if column == "usage_status":
        return _normalize_usage_status(value)
    return _clean_text(value)


def _normalize_category(value):
    text = (_clean_text(value) or "").strip()
    if not text:
        return ""
    lowered = text.lower().replace(" ", "")
    if lowered in {"pc"} or "컴퓨터" in text or "노트북" in text:
        return "PC"
    if lowered in {"printer"} or "프린터" in text:
        return "프린터"
    if lowered in {"software", "sw"} or "소프트" in text:
        return "소프트웨어"
    if lowered in {"license", "licence"} or "라이선" in text:
        return "라이선스"
    return text


# 엑셀 기본 형식 26개: 업로드 템플릿·'기본 항목' 다운로드 공통 (기본 정보 17 / 장비 정보 6 / 장비 상세 3)
# (키, 헤더, 그룹, 종류) — 종류: base=itma_assets, detail=itma_asset_details, auto=자동 입력(업로드 시 무시)
ITMA_UPLOAD_TEMPLATE_COLUMNS = [
    ("row_no", "번호", "기본 정보", "auto"),
    ("category", "카테고리", "기본 정보", "base"),
    ("site", "사업장", "기본 정보", "base"),
    ("asset_id", "자산번호", "기본 정보", "base"),
    ("manufacturer", "제조사", "기본 정보", "base"),
    ("item_name", "품명", "기본 정보", "base"),
    ("received_date", "입고일", "기본 정보", "base"),
    ("inbound_note", "입고 메모", "기본 정보", "base"),
    ("released_date", "출고일", "기본 정보", "base"),
    ("outbound_note", "출고 메모", "기본 정보", "base"),
    ("storage_location", "보관 위치", "기본 정보", "base"),
    ("detail_note", "상세 메모", "기본 정보", "base"),
    ("sales_rep", "담당자", "기본 정보", "base"),
    ("usage_status", "운영상태", "기본 정보", "base"),
    ("manufacture_month", "제조년월", "기본 정보", "base"),
    ("updated_at", "수정 일시", "기본 정보", "auto"),
    ("updated_by", "수정자", "기본 정보", "auto"),
    ("used_group", "그룹", "장비 정보", "detail"),
    ("used_user", "사용자", "장비 정보", "detail"),
    ("user_position", "직급", "장비 정보", "detail"),
    ("network_type", "네트워크 구분", "장비 정보", "detail"),
    ("ip_address", "IP/Subnet", "장비 정보", "detail"),
    ("mac_address", "Mac address", "장비 정보", "detail"),
    ("hostname", "장비명", "장비 상세", "detail"),
    ("os_version", "OS/Version", "장비 상세", "detail"),
    ("serial_number", "Serial Number", "장비 상세", "detail"),
]

# 업로드 시 인식하는 헤더 별칭 (새 양식 + 이전 양식/전체 다운로드 파일 호환)
ITMA_UPLOAD_COLUMN_ALIASES = {
    "category": ["카테고리", "구분", "category"],
    "site": ["사업장", "site"],
    "asset_id": ["자산번호", "자산ID", "asset_id", "assetid"],
    "manufacturer": ["제조사", "manufacturer"],
    "item_name": ["품명", "item_name", "itemname"],
    "received_date": ["입고일", "received_date", "receiveddate"],
    "inbound_note": ["입고 메모", "입고메모", "inbound_note", "inboundnote"],
    "released_date": ["출고일", "released_date", "releaseddate"],
    "outbound_note": ["출고 메모", "출고메모", "outbound_note", "outboundnote"],
    "storage_location": ["보관 위치", "보관위치", "storage_location", "storagelocation"],
    "detail_note": ["상세 메모", "상세메모", "detail_note", "detailnote"],
    "sales_rep": ["담당자", "sales_rep", "salesrep"],
    "usage_status": ["운영상태", "사용 상태", "사용여부", "usage_status", "usagestatus"],
    "manufacture_month": ["제조년월", "manufacture_month", "manufacturemonth"],
    "used_group": ["그룹", "상세_사용그룹", "used_group"],
    "used_user": ["사용자", "상세_사용자", "used_user"],
    "user_position": ["직급", "상세_직급", "user_position"],
    "network_type": ["네트워크 구분", "상세_네트워크구분", "network_type"],
    "ip_address": ["IP/Subnet", "IP", "상세_IP", "ip_address"],
    "mac_address": ["Mac address", "MAC", "상세_Mac address", "mac_address"],
    "hostname": ["장비명", "HOSTNAME", "상세_HOSTNAME", "hostname"],
    "os_version": ["OS/Version", "상세_OS/Version", "os_version"],
    # 시리얼: 새 양식(Serial Number) 우선, 이전 양식(시리얼번호) 호환
    "serial_number": ["Serial Number", "상세_Serial Number", "시리얼번호", "serial_number", "serialnumber"],
}

ITMA_UPLOAD_DETAIL_FIELDS = [key for key, _, _, kind in ITMA_UPLOAD_TEMPLATE_COLUMNS if kind == "detail" and key != "serial_number"]


def _normalize_columns(df):
    """엑셀 헤더를 업로드 필드 키에 매핑 (공백·대소문자 무시, 위치 기반 추정 없음)"""
    df.columns = [str(col).strip() for col in df.columns]
    normalized_to_actual = {}
    for col in df.columns:
        normalized_to_actual.setdefault(re.sub(r"\s+", "", str(col)).lower(), col)

    def pick_all(aliases):
        found = []
        for alias in aliases:
            actual = normalized_to_actual.get(re.sub(r"\s+", "", str(alias)).lower())
            if actual is not None and actual not in found:
                found.append(actual)
        return found

    col_map = {}
    for key, aliases in ITMA_UPLOAD_COLUMN_ALIASES.items():
        found = pick_all(aliases)
        col_map[key] = found[0] if found else None
    # 시리얼은 여러 컬럼(새/이전 양식)이 함께 있으면 첫 번째 값이 있는 컬럼을 사용
    col_map["serial_number_candidates"] = pick_all(ITMA_UPLOAD_COLUMN_ALIASES["serial_number"])
    return col_map


def _clean_excel_text(value):
    """엑셀 셀 값을 문자열로 정리 (숫자 333이 333.0으로 바뀌는 문제 방지)"""
    if isinstance(value, float) and not pd.isna(value) and value.is_integer():
        value = int(value)
    return _clean_text(value)


# 엑셀 그룹별 헤더 색상 (템플릿·다운로드 공통)
ITMA_EXCEL_GROUP_FILLS = {
    "기본 정보": "DBEAFE",
    "장비 정보": "DCFCE7",
    "장비 상세": "FEF3C7",
    "상세 스펙": "CFFAFE",
    "사용자 정의": "EDE9FE",
}
ITMA_EXCEL_AUTO_FILL = "E5E7EB"
# 엑셀 컬럼 키 매핑 숨김 시트 이름 (같은 이름의 스펙 컬럼 구분용)
ITMA_EXCEL_COLUMN_MAP_SHEET = "_columns"
# 자산 목록 장비 컬럼 키(detail_*) → 엑셀 기본 형식 키
ITMA_EXCEL_LIST_DETAIL_PREFIX = "detail_"


def _excel_basic_columns():
    """기본 형식 26개 (업로드 템플릿·'기본 항목' 다운로드 공통)"""
    return [
        {"key": key, "label": label, "group": group, "kind": kind}
        for key, label, group, kind in ITMA_UPLOAD_TEMPLATE_COLUMNS
    ]


def _load_excel_spec_items(cur, permissions=None):
    """현재 활성 스펙 폼 항목 (엑셀 컬럼 키: spec_<항목 id>). permissions가 있으면 조회 가능한 카테고리만"""
    cur.execute(
        """
        SELECT sfi.id, sfi.spec_label, sf.category_key, sf.form_name, sfi.display_order
        FROM itma_spec_form_items sfi
        JOIN itma_spec_forms sf ON sf.id = sfi.form_id
        LEFT JOIN itma_categories ic ON ic.category_key = sf.category_key
        WHERE sf.is_active = TRUE AND TRIM(COALESCE(sfi.spec_label, '')) <> ''
        ORDER BY COALESCE(ic.display_order, 9999), sf.id, sfi.display_order, sfi.id
        """
    )
    items = []
    for row in cur.fetchall():
        category_key = _normalize_category_key(row[2])
        if permissions is not None and not _can_view_category(permissions, category_key):
            continue
        items.append({
            "key": f"spec_{row[0]}", "label": str(row[1]).strip(), "group": "상세 스펙", "kind": "spec",
            "form_item_id": row[0], "category_key": category_key, "form_name": row[3] or "", "display_order": row[4] or 0,
        })
    return items


def _resolve_excel_columns(cur, permissions, column_keys=None):
    """다운로드 컬럼 구성. column_keys가 None이면 기본 형식 26개, 있으면 허용된 키만 목록 순서대로"""
    basic = _excel_basic_columns()
    if column_keys is None:
        return basic
    basic_by_key = {column["key"]: column for column in basic}
    spec_by_key = {item["key"]: item for item in _load_excel_spec_items(cur, permissions)}
    custom_by_key = {
        column["key"]: {"key": column["key"], "label": column["label"] or column["key"], "group": "사용자 정의", "kind": "custom"}
        for column in _load_custom_columns(cur)
    }
    resolved, seen = [], set()
    for raw_key in column_keys:
        key = str(raw_key or "").strip()
        if key.startswith(ITMA_EXCEL_LIST_DETAIL_PREFIX) and key[len(ITMA_EXCEL_LIST_DETAIL_PREFIX):] in basic_by_key:
            key = key[len(ITMA_EXCEL_LIST_DETAIL_PREFIX):]
        column = basic_by_key.get(key) or spec_by_key.get(key) or custom_by_key.get(key)
        # 모르는 키·삭제된 컬럼·화면 전용 컬럼(관리 버튼)은 무시
        if not column or key in seen:
            continue
        seen.add(key)
        resolved.append(column)
    return resolved


def _excel_cell_text(key, value):
    """자산 목록과 같은 값 형식"""
    if value is None:
        return ""
    if key == "usage_status":
        return _normalize_usage_status(value) or str(value)
    if key == "updated_at" and hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d %H:%M")
    return _form_value_text(key, value)


def _load_excel_asset_rows(cur, permissions, asset_ids=None):
    """엑셀 행 데이터: 기본 정보 + 장비 정보·장비 상세 (조회 권한 범위)"""
    base_fields = [key for key, _l, _g, kind in ITMA_UPLOAD_TEMPLATE_COLUMNS if kind in {"base", "auto"} and key != "row_no"]
    detail_fields = [key for key, _l, _g, kind in ITMA_UPLOAD_TEMPLATE_COLUMNS if kind == "detail"]
    select_detail = [
        "COALESCE(NULLIF(d.serial_number, ''), a.serial_number)" if field == "serial_number" else f"d.{field}"
        for field in detail_fields
    ]
    where = ""
    params = ()
    if asset_ids is not None:
        where = "WHERE a.id = ANY(%s::int[])"
        params = ([int(asset_id) for asset_id in asset_ids],)
    cur.execute(
        f"""
        SELECT a.id, {", ".join(f"a.{field}" for field in base_fields)}, {", ".join(select_detail)}
        FROM itma_assets a
        LEFT JOIN itma_asset_details d ON d.asset_id = a.id
        {where}
        ORDER BY a.input_at DESC, a.id DESC
        """,
        params,
    )
    rows = []
    fields = base_fields + detail_fields
    for row in cur.fetchall():
        item = {"id": row[0]}
        for idx, field in enumerate(fields, start=1):
            item[field] = _excel_cell_text(field, row[idx])
        if _can_view_category(permissions, item.get("category") or ""):
            rows.append(item)
    return rows


def _build_assets_workbook(cur, columns, rows, sheet_name):
    """엑셀 파일 생성 — 번호는 엑셀 행 순서대로 1부터, 스펙은 폼 항목에 연결된 값만"""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    asset_ids = [row["id"] for row in rows]
    spec_columns = [column for column in columns if column["kind"] == "spec"]
    spec_values = _load_spec_column_values(cur, asset_ids, spec_columns) if spec_columns else {}
    custom_values = _load_custom_column_values(cur, asset_ids) if any(column["kind"] == "custom" for column in columns) else {}

    thin = Side(style="thin", color="9CA3AF")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_name
    for col_idx, column in enumerate(columns, start=1):
        header = ws.cell(row=1, column=col_idx, value=column["label"])
        is_auto = column["kind"] == "auto"
        header.font = Font(bold=True, color="6B7280" if is_auto else "111827")
        header.fill = PatternFill("solid", fgColor=ITMA_EXCEL_AUTO_FILL if is_auto else ITMA_EXCEL_GROUP_FILLS.get(column["group"], "F3F4F6"))
        header.alignment = Alignment(horizontal="center", vertical="center")
        header.border = border
        ws.column_dimensions[header.column_letter].width = max(12, len(column["label"]) * 2 + 4)
    for row_no, item in enumerate(rows, start=1):
        asset_key = str(item["id"])
        values = []
        for column in columns:
            key, kind = column["key"], column["kind"]
            if key == "row_no":
                values.append(row_no)
            elif kind == "spec":
                values.append(spec_values.get(asset_key, {}).get(key, ""))
            elif kind == "custom":
                values.append(custom_values.get(asset_key, {}).get(key, ""))
            else:
                values.append(item.get(key, ""))
        ws.append(values)
    ws.freeze_panes = "A2"

    # 열 위치 → 컬럼 키 매핑 (업로드 시 같은 이름의 스펙 컬럼 구분)
    map_ws = wb.create_sheet(ITMA_EXCEL_COLUMN_MAP_SHEET)
    map_ws.append(["열", "컬럼 키", "컬럼 이름"])
    for col_idx, column in enumerate(columns, start=1):
        map_ws.append([col_idx, column["key"], column["label"]])
    map_ws.sheet_state = "hidden"

    output = BytesIO()
    wb.save(output)
    output.seek(0)
    return output


def _send_assets_excel(permissions, asset_ids, sheet_name, download_name, scope_text):
    """선택/전체 다운로드 공통: columns(사용자 지정 항목) 또는 기본 항목(preset=basic, 파라미터 없음)"""
    columns_raw = request.args.get("columns")
    column_keys = None
    if columns_raw is not None and (request.args.get("preset") or "").strip() != "basic":
        column_keys = [token for token in columns_raw.split(",") if token.strip()]
    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        columns = _resolve_excel_columns(cur, permissions, column_keys)
        if not columns:
            return jsonify({"success": False, "message": "다운로드할 항목이 없습니다. 자산 목록에서 표시할 항목을 선택해주세요."}), 400
        rows = _load_excel_asset_rows(cur, permissions, asset_ids)
        if asset_ids is not None and not rows:
            return jsonify({"success": False, "message": "다운로드할 대상 데이터가 없습니다."}), 404
        output = _build_assets_workbook(cur, columns, rows, sheet_name)
        mode_text = "사용자 지정 항목" if column_keys is not None else "기본 항목"
        log_audit(
            session.get("username"),
            "download",
            resource="ITMA",
            details=f"자산 {scope_text} 다운로드({mode_text} {len(columns)}개): {len(rows)}건",
        )
        return send_file(
            output,
            as_attachment=True,
            download_name=download_name,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


def _page_permissions_or_redirect():
    """화면(페이지) 접근 공통 검사: 통과하면 권한 dict, 아니면 redirect 응답"""
    if "username" not in session:
        return redirect(url_for("auth.login"))
    if session.get("role") not in ["admin", "manager", "user"]:
        return redirect(url_for("auth.login"))
    permissions = _get_session_itma_permissions()
    if session.get("role") != "admin" and not permissions.get("view_categories"):
        return redirect(url_for("auth.access_pending"))
    return permissions


@itma_bp.route("/", methods=["GET"])
def page():
    """메인 화면: 자산 현황 대시보드"""
    permissions = _page_permissions_or_redirect()
    if not isinstance(permissions, dict):
        return permissions
    return render_template("ITMA/dashboard.html", itma_permissions=permissions)


@itma_bp.route("/assets/page", methods=["GET"])
def assets_page():
    """자산 관리(목록) 화면 — 읽기 전용, 수정은 추가/수정 화면에서만"""
    permissions = _page_permissions_or_redirect()
    if not isinstance(permissions, dict):
        return permissions
    return render_template("ITMA/index.html", itma_permissions=permissions)


@itma_bp.route("/assets/new", methods=["GET"])
def asset_new_page():
    permissions = _page_permissions_or_redirect()
    if not isinstance(permissions, dict):
        return permissions
    if not permissions.get("can_edit_all") and not permissions.get("edit_categories"):
        flash("자산 추가 권한이 없습니다.", "warning")
        return redirect(url_for("itma.assets_page"))
    return render_template("ITMA/asset_form.html", itma_permissions=permissions, asset_pk=None)


@itma_bp.route("/assets/<int:asset_id>/edit", methods=["GET"])
def asset_edit_page(asset_id):
    permissions = _page_permissions_or_redirect()
    if not isinstance(permissions, dict):
        return permissions
    return render_template("ITMA/asset_form.html", itma_permissions=permissions, asset_pk=asset_id)


@itma_bp.route("/dashboard/summary", methods=["GET"])
def dashboard_summary():
    """메인 대시보드 데이터 (로그인 사용자 조회 권한 범위)"""
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        snapshot = _build_itma_dashboard_snapshot(cur, permissions)
        snapshot["success"] = True
        snapshot["server_time"] = _now_local().strftime("%Y-%m-%d %H:%M:%S")
        return jsonify(snapshot)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


# 추가/수정 화면에서 다루는 항목
ITMA_FORM_BASE_FIELDS = (
    "category", "site", "asset_id", "manufacturer", "item_name",
    "received_date", "inbound_note", "released_date", "outbound_note",
    "storage_location", "detail_note", "sales_rep", "usage_status", "manufacture_month",
)
ITMA_FORM_DETAIL_FIELDS = (
    "used_group", "used_user", "user_position", "network_type", "ip_address", "mac_address",
    "hostname", "os_version", "serial_number",
)


def _form_value_text(column, value):
    if value is None:
        return ""
    if column in {"received_date", "released_date"} and hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    if column == "manufacture_month" and hasattr(value, "strftime"):
        return value.strftime("%Y-%m")
    return str(value)


def _save_asset_form_spec_values(cur, asset_id, category, spec_in, now_ts, actor_name, spec_form_id=None):
    """추가/수정 화면의 스펙 값 저장. 현재 카테고리의 활성 스펙 폼 항목만 반영하고 변경 여부를 반환

    spec_form_id가 있으면 그 폼의 항목만 저장하고, 이 자산에 저장된 다른 스펙 폼 연결 값은 삭제한다.
    """
    if not isinstance(spec_in, dict) or not _supports_dynamic_spec_forms(category):
        return False
    try:
        spec_form_id = int(spec_form_id) if spec_form_id not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        spec_form_id = None
    cur.execute(
        """
        SELECT sfi.id, sfi.spec_label, sfi.display_order, sfi.form_id
        FROM itma_spec_form_items sfi
        JOIN itma_spec_forms sf ON sf.id = sfi.form_id
        WHERE sf.category_key = %s AND sf.is_active = TRUE
        """,
        (_normalize_category_key(category),),
    )
    category_items = cur.fetchall()
    if spec_form_id is not None and not any(row[3] == spec_form_id for row in category_items):
        # 다른 카테고리이거나 비활성인 폼은 선택하지 않은 것으로 처리
        spec_form_id = None
    form_items = {
        row[0]: (row[1] or "", row[2] or 0)
        for row in category_items
        if spec_form_id is None or row[3] == spec_form_id
    }
    before_summary, after_summary = {}, {}
    if spec_form_id is not None:
        # 선택한 폼 외의 스펙 폼 연결 값 삭제 (자유 입력 스펙 행은 유지)
        cur.execute(
            """
            DELETE FROM itma_asset_spec_items
            WHERE asset_id = %s AND source_form_item_id IS NOT NULL
              AND NOT (source_form_item_id = ANY(%s::int[]))
            RETURNING spec_label, spec_value
            """,
            (asset_id, list(form_items)),
        )
        for label, value in cur.fetchall():
            if value:
                before_summary[label or ""] = value
                after_summary[label or ""] = ""
    cur.execute(
        """
        SELECT source_form_item_id, spec_value FROM itma_asset_spec_items
        WHERE asset_id = %s AND source_form_item_id = ANY(%s::int[])
        """,
        (asset_id, list(form_items)),
    )
    old_values = {row[0]: row[1] or "" for row in cur.fetchall()}
    for raw_key, raw_value in (spec_in.items() if form_items else []):
        try:
            form_item_id = int(raw_key)
        except (TypeError, ValueError):
            continue
        if form_item_id not in form_items:
            continue
        value = _clean_text(raw_value) or ""
        old_value = old_values.get(form_item_id, "")
        if value == old_value:
            continue
        label, display_order = form_items[form_item_id]
        before_summary[label] = old_value
        after_summary[label] = value
        if value == "":
            cur.execute(
                "DELETE FROM itma_asset_spec_items WHERE asset_id = %s AND source_form_item_id = %s",
                (asset_id, form_item_id),
            )
            continue
        cur.execute(
            """
            INSERT INTO itma_asset_spec_items
                (asset_id, spec_label, spec_value, display_order, source_form_item_id, updated_at, updated_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (asset_id, source_form_item_id) WHERE source_form_item_id IS NOT NULL
            DO UPDATE SET spec_label = EXCLUDED.spec_label, spec_value = EXCLUDED.spec_value,
                updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
            """,
            (asset_id, label, value, display_order, form_item_id, now_ts, actor_name),
        )
    if not after_summary:
        return False
    # 이력 컬럼명은 고정값(asset_details)만 사용 — 스펙 항목명은 값(JSON)에만 기록
    _insert_history(
        cur,
        asset_id=asset_id,
        action="update",
        actor=actor_name,
        changed_column="asset_details",
        before_value=json.dumps({"상세 스펙": before_summary}, ensure_ascii=False),
        after_value=json.dumps({"상세 스펙": after_summary}, ensure_ascii=False),
    )
    cur.execute("UPDATE itma_assets SET updated_at = %s, updated_by = %s WHERE id = %s", (now_ts, actor_name, asset_id))
    return True


@itma_bp.route("/assets/<int:asset_id>/form-data", methods=["GET"])
def get_asset_form_data(asset_id):
    """추가/수정 화면용 단건 조회 (기본 정보 + 장비 정보 + 사용자 정의 컬럼)"""
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            f"""
            SELECT id, asset_code, input_at, updated_at, updated_by, {", ".join(ITMA_FORM_BASE_FIELDS)}
            FROM itma_assets WHERE id = %s
            """,
            (asset_id,),
        )
        row = cur.fetchone()
        if not row:
            return jsonify({"success": False, "message": "대상 자산을 찾을 수 없습니다."}), 404
        base = {column: _form_value_text(column, row[5 + idx]) for idx, column in enumerate(ITMA_FORM_BASE_FIELDS)}
        if not _can_view_category(permissions, base.get("category") or ""):
            return jsonify({"success": False, "message": "해당 카테고리 조회 권한이 없습니다."}), 403
        base["usage_status"] = _normalize_usage_status(base.get("usage_status"))
        cur.execute(
            f"SELECT {', '.join(ITMA_FORM_DETAIL_FIELDS)} FROM itma_asset_details WHERE asset_id = %s",
            (asset_id,),
        )
        detail_row = cur.fetchone()
        details = {field: (_form_value_text(field, detail_row[idx]) if detail_row else "") for idx, field in enumerate(ITMA_FORM_DETAIL_FIELDS)}
        if not details.get("serial_number"):
            cur.execute("SELECT serial_number FROM itma_assets WHERE id = %s", (asset_id,))
            serial_row = cur.fetchone()
            details["serial_number"] = (serial_row[0] or "") if serial_row else ""
        custom_values = _load_custom_column_values(cur, [asset_id]).get(str(asset_id), {})
        # 스펙 폼 항목에 연결된 값만 반환 (키: 스펙 폼 항목 id)
        cur.execute(
            """
            SELECT source_form_item_id, spec_value FROM itma_asset_spec_items
            WHERE asset_id = %s AND source_form_item_id IS NOT NULL
            """,
            (asset_id,),
        )
        spec_values = {str(spec_row[0]): spec_row[1] or "" for spec_row in cur.fetchall()}
        return jsonify(
            {
                "success": True,
                "item": {
                    "id": row[0],
                    "asset_code": row[1] or "",
                    "input_at": row[2].strftime("%Y-%m-%d %H:%M:%S") if row[2] else "",
                    "updated_at": row[3].strftime("%Y-%m-%d %H:%M:%S") if row[3] else "",
                    "updated_by": row[4] or "",
                    "base": base,
                    "details": details,
                    "custom": custom_values,
                    "spec": spec_values,
                },
                "can_edit": _can_edit_category(permissions, base.get("category") or ""),
            }
        )
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/assets/form-options", methods=["GET"])
def get_asset_form_options():
    """추가/수정 화면 선택지: 편집 가능한 카테고리, 운영상태, 사업장·자동완성 후보, 사용자 정의 컬럼"""
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT category_key, display_name FROM itma_categories ORDER BY display_order, display_name")
        categories = [
            {"category_key": row[0], "display_name": row[1], "can_edit": _can_edit_category(permissions, row[0])}
            for row in cur.fetchall()
            if _can_view_category(permissions, row[0])
        ]
        suggestions = {}
        for column in ("site", "manufacturer", "item_name", "storage_location", "sales_rep"):
            cur.execute(
                f"""
                SELECT DISTINCT {column} FROM itma_assets
                WHERE {column} IS NOT NULL AND {column} <> ''
                ORDER BY {column} LIMIT 300
                """
            )
            suggestions[column] = [r[0] for r in cur.fetchall()]
        return jsonify(
            {
                "success": True,
                "categories": categories,
                "usage_status_options": list(ITMA_USAGE_STATUS_OPTIONS),
                "suggestions": suggestions,
                "custom_columns": _load_custom_columns(cur),
                "permissions": permissions,
            }
        )
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/assets/save", methods=["POST"])
def save_asset_form():
    """추가/수정 화면 저장 (신규 등록 또는 기존 자산 수정, 한 번에 저장)"""
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    if not permissions.get("can_edit_all") and not permissions.get("edit_categories"):
        return jsonify({"success": False, "message": "자산 수정 권한이 없습니다."}), 403

    data = request.get_json() or {}
    asset_pk = data.get("id")
    try:
        asset_pk = int(asset_pk) if asset_pk not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "유효하지 않은 자산입니다."}), 400
    base_in = data.get("base") or {}
    details_in = data.get("details") or {}
    custom_in = data.get("custom") or {}
    spec_in = data.get("spec") or {}

    usage_raw = _clean_text(base_in.get("usage_status")) or ""
    if usage_raw and not _normalize_usage_status(usage_raw):
        return jsonify({"success": False, "message": "운영상태는 정상/사용/미사용/교체/폐기 중에서 선택해주세요.", "field": "usage_status"}), 400

    _ensure_itma_table()
    user_id = session.get("username")
    actor_name = _get_itma_actor_name()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # 카테고리 (필수, 편집 권한 필요)
        category_input = _clean_text(base_in.get("category")) or ""
        if not category_input:
            return jsonify({"success": False, "message": "카테고리를 선택해주세요.", "field": "category"}), 400
        cur.execute(
            "SELECT display_name FROM itma_categories WHERE category_key = %s OR display_name = %s LIMIT 1",
            (_normalize_category_key(category_input), category_input),
        )
        category_row = cur.fetchone()
        if not category_row:
            return jsonify({"success": False, "message": "등록된 카테고리를 선택해주세요.", "field": "category"}), 400
        if not _can_edit_category(permissions, category_row[0]):
            return jsonify({"success": False, "message": "선택한 카테고리 수정 권한이 없습니다.", "field": "category"}), 403

        new_base = {column: _parse_value_by_column(column, base_in.get(column)) for column in ITMA_FORM_BASE_FIELDS}
        new_base["category"] = category_row[0]
        new_details = {field: (_clean_text(details_in.get(field)) or "") for field in ITMA_FORM_DETAIL_FIELDS}
        serial_value = new_details.get("serial_number") or ""

        old_item = None
        old_details = {}
        if asset_pk:
            cur.execute(
                """
                SELECT id, category, manufacturer, item_name, serial_number, received_date,
                       inbound_note, released_date, outbound_note, storage_location,
                       detail_note, sales_rep, usage_status, manufacture_month, input_at, updated_at, updated_by, asset_id, asset_code
                FROM itma_assets WHERE id = %s FOR UPDATE
                """,
                (asset_pk,),
            )
            existing_row = cur.fetchone()
            if not existing_row:
                conn.rollback()
                return jsonify({"success": False, "message": "대상 자산을 찾을 수 없습니다."}), 404
            old_item = _attach_site(cur, _asset_row_to_item(existing_row))
            if not _can_edit_category(permissions, old_item.get("category") or ""):
                conn.rollback()
                return jsonify({"success": False, "message": "해당 카테고리 수정 권한이 없습니다."}), 403
            cur.execute(
                f"SELECT {', '.join(ITMA_FORM_DETAIL_FIELDS)} FROM itma_asset_details WHERE asset_id = %s",
                (asset_pk,),
            )
            detail_row = cur.fetchone()
            old_details = {field: ((detail_row[idx] or "") if detail_row else "") for idx, field in enumerate(ITMA_FORM_DETAIL_FIELDS)}

        # 중복 검사: 자산번호(asset_id), 시리얼(기본·장비 상세)
        exclude_id = asset_pk or 0
        if new_base.get("asset_id"):
            cur.execute("SELECT 1 FROM itma_assets WHERE id <> %s AND asset_id = %s LIMIT 1", (exclude_id, new_base["asset_id"]))
            if cur.fetchone():
                conn.rollback()
                return jsonify({"success": False, "message": "이미 등록된 자산번호입니다.", "field": "asset_id"}), 400
        serial_key = _normalize_serial(serial_value)
        if serial_key:
            cur.execute(
                """
                SELECT 1 FROM itma_assets a
                LEFT JOIN itma_asset_details d ON d.asset_id = a.id
                WHERE a.id <> %s
                  AND (
                    regexp_replace(upper(COALESCE(a.serial_number, '')), '[[:space:]_-]+', '', 'g') = %s
                    OR regexp_replace(upper(COALESCE(d.serial_number, '')), '[[:space:]_-]+', '', 'g') = %s
                  )
                LIMIT 1
                """,
                (exclude_id, serial_key, serial_key),
            )
            if cur.fetchone():
                conn.rollback()
                return jsonify({"success": False, "message": "이미 등록된 시리얼번호입니다.", "field": "serial_number"}), 400

        now_ts = _to_db_timestamp(_now_local())
        base_columns = list(ITMA_FORM_BASE_FIELDS) + ["serial_number"]
        base_values = [new_base[column] for column in ITMA_FORM_BASE_FIELDS] + [serial_value or None]

        if not asset_pk:
            asset_code = _next_asset_code(cur, "ITMA")
            cur.execute(
                f"""
                INSERT INTO itma_assets ({", ".join(base_columns)}, asset_code, input_at, updated_at, uploaded_by, updated_by)
                VALUES ({", ".join(["%s"] * (len(base_columns) + 5))})
                RETURNING id
                """,
                tuple(base_values) + (asset_code, now_ts, now_ts, actor_name, actor_name),
            )
            asset_pk = cur.fetchone()[0]
            action_label = "create"
        else:
            action_label = "update"
            changes = []
            for column, value in zip(base_columns, base_values):
                old_value = old_item.get(column)
                if _value_to_history_text(old_value) != _value_to_history_text(_form_value_text(column, value)):
                    changes.append((column, old_value, value))
            if changes:
                cur.execute(
                    f"""
                    UPDATE itma_assets
                    SET {", ".join(f"{column} = %s" for column, _old, _new in changes)}, updated_at = %s, updated_by = %s
                    WHERE id = %s
                    RETURNING id, category, manufacturer, item_name, serial_number, received_date,
                              inbound_note, released_date, outbound_note, storage_location,
                              detail_note, sales_rep, usage_status, manufacture_month, input_at, updated_at, updated_by, asset_id, asset_code
                    """,
                    tuple(new for _column, _old, new in changes) + (now_ts, actor_name, asset_pk),
                )
                updated_item = _attach_site(cur, _asset_row_to_item(cur.fetchone()))
                for column, old_value, _new in changes:
                    _insert_history(
                        cur,
                        asset_id=asset_pk,
                        action="update",
                        actor=actor_name,
                        changed_column=column,
                        before_value=old_value,
                        after_value=updated_item.get(column),
                        snapshot=updated_item,
                    )
                if any(column == "usage_status" for column, _o, _n in changes) and new_base.get("usage_status"):
                    status_date = now_ts.date()
                    cur.execute(
                        """
                        INSERT INTO itma_asset_details (asset_id, equipment_status, equipment_status_date, updated_at, updated_by)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (asset_id) DO UPDATE
                        SET equipment_status = EXCLUDED.equipment_status,
                            equipment_status_date = EXCLUDED.equipment_status_date,
                            updated_at = EXCLUDED.updated_at,
                            updated_by = EXCLUDED.updated_by
                        """,
                        (asset_pk, new_base["usage_status"], status_date, now_ts, actor_name),
                    )
                    cur.execute(
                        "INSERT INTO itma_asset_equipment_changes (asset_id, status_date, equipment_status, created_by) VALUES (%s, %s, %s, %s)",
                        (asset_pk, status_date, new_base["usage_status"], actor_name),
                    )

        # 장비 정보·장비 상세
        if any(new_details.get(field, "") != (old_details.get(field) or "") for field in ITMA_FORM_DETAIL_FIELDS):
            cur.execute(
                f"""
                INSERT INTO itma_asset_details (asset_id, {", ".join(ITMA_FORM_DETAIL_FIELDS)}, updated_at, updated_by)
                VALUES ({", ".join(["%s"] * (len(ITMA_FORM_DETAIL_FIELDS) + 3))})
                ON CONFLICT (asset_id) DO UPDATE SET
                    {", ".join(f"{field} = EXCLUDED.{field}" for field in ITMA_FORM_DETAIL_FIELDS)},
                    updated_at = EXCLUDED.updated_at,
                    updated_by = EXCLUDED.updated_by
                """,
                (asset_pk,) + tuple(new_details[field] or None for field in ITMA_FORM_DETAIL_FIELDS) + (now_ts, actor_name),
            )
            cur.execute("UPDATE itma_assets SET updated_at = %s, updated_by = %s WHERE id = %s", (now_ts, actor_name, asset_pk))

        # 사용자 정의 컬럼 (컬럼 관리 권한자만)
        if isinstance(custom_in, dict) and custom_in:
            valid_keys = {column["key"] for column in _load_custom_columns(cur)}
            old_custom = _load_custom_column_values(cur, [asset_pk]).get(str(asset_pk), {})
            custom_changes = {
                key: (str(value).strip() if value is not None else "")
                for key, value in custom_in.items()
                if key in valid_keys and (str(value).strip() if value is not None else "") != str(old_custom.get(key, "") or "")
            }
            if custom_changes and not permissions.get("can_manage_columns"):
                conn.rollback()
                return jsonify({"success": False, "message": "사용자 정의 컬럼 수정 권한이 없습니다."}), 403
            for key, value in custom_changes.items():
                if value == "":
                    cur.execute("DELETE FROM itma_custom_column_values WHERE asset_id = %s AND column_key = %s", (asset_pk, key))
                else:
                    cur.execute(
                        """
                        INSERT INTO itma_custom_column_values (asset_id, column_key, column_value, updated_at, updated_by)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (asset_id, column_key) DO UPDATE SET
                            column_value = EXCLUDED.column_value,
                            updated_at = EXCLUDED.updated_at,
                            updated_by = EXCLUDED.updated_by
                        """,
                        (asset_pk, key, value, now_ts, actor_name),
                    )

        # 상세 스펙 폼 값 (선택한 카테고리의 스펙 폼 항목)
        _save_asset_form_spec_values(
            cur, asset_pk, new_base["category"], spec_in, now_ts, actor_name, spec_form_id=data.get("spec_form_id")
        )

        conn.commit()
        cur.execute("SELECT asset_code FROM itma_assets WHERE id = %s", (asset_pk,))
        code_row = cur.fetchone()
        asset_code_text = (code_row[0] or "") if code_row else ""
        log_audit(
            user_id,
            action_label,
            resource="ITMA",
            details=f"자산 {'등록' if action_label == 'create' else '수정'}(추가/수정 화면): {asset_code_text or asset_pk}",
        )
        return jsonify(
            {
                "success": True,
                "id": asset_pk,
                "asset_code": asset_code_text,
                "created": action_label == "create",
                "message": f"{asset_code_text} 자산을 {'등록' if action_label == 'create' else '저장'}했습니다.",
            }
        )
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/dashboard/open", methods=["GET"])
def open_dashboard_live():
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    token = _get_itma_dashboard_public_token(force_create=True)
    if not token:
        return redirect(url_for("itma.page"))
    refresh = (request.args.get("refresh") or "5").strip()
    if refresh not in {"5", "10", "30", "60"}:
        refresh = "5"
    return redirect(url_for("itma.dashboard_live", token=token, refresh=refresh))


@itma_bp.route("/dashboard/live", methods=["GET"])
def dashboard_live():
    token = (request.args.get("token") or "").strip()
    if not _is_valid_itma_dashboard_token(token):
        return "유효하지 않은 대시보드 접근 토큰입니다.", 403
    refresh = (request.args.get("refresh") or "5").strip()
    if refresh not in {"5", "10", "30", "60"}:
        refresh = "5"
    return render_template("ITMA/dashboard_live.html", token=token, refresh_minutes=refresh)


@itma_bp.route("/dashboard/data", methods=["GET"])
def dashboard_data():
    token = (request.args.get("token") or "").strip()
    if not _is_valid_itma_dashboard_token(token):
        return jsonify({"success": False, "message": "유효하지 않은 접근 토큰입니다."}), 403

    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        snapshot = _build_itma_dashboard_snapshot(cur)
        return jsonify(
            {
                "success": True,
                "server_time": _now_local().strftime("%Y-%m-%d %H:%M:%S"),
                **snapshot,
            }
        )
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/categories", methods=["GET"])
def get_categories():
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT category_key, display_name, supports_spec_forms, display_order
            FROM itma_categories ORDER BY display_order, display_name
            """
        )
        categories = [
            {"category_key": row[0], "display_name": row[1], "supports_spec_forms": bool(row[2]), "display_order": row[3], "is_default": row[0] in DEFAULT_CATEGORY_PERMISSION_KEYS}
            for row in cur.fetchall()
            if permissions.get("can_edit_all") or _can_view_category(permissions, row[0])
        ]
        return jsonify({"success": True, "categories": categories})
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/categories", methods=["POST"])
def create_category():
    if session.get("role") != "admin":
        return jsonify({"success": False, "message": "카테고리 추가 권한이 없습니다."}), 403
    payload = request.get_json(silent=True) or {}
    display_name = re.sub(r"\s+", " ", str(payload.get("display_name") or "").strip())
    if not display_name:
        return jsonify({"success": False, "message": "카테고리명을 입력해주세요."}), 400
    if len(display_name) > 100:
        return jsonify({"success": False, "message": "카테고리명은 100자 이내로 입력해주세요."}), 400
    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        category_key = _normalize_category_key(display_name)
        cur.execute("SELECT COALESCE(MAX(display_order), 0) + 10 FROM itma_categories")
        display_order = cur.fetchone()[0]
        cur.execute(
            """
            INSERT INTO itma_categories (category_key, display_name, supports_spec_forms, display_order, created_by)
            VALUES (%s, %s, TRUE, %s, %s)
            RETURNING category_key, display_name, supports_spec_forms, display_order
            """,
            (category_key, display_name, display_order, session.get("username")),
        )
        row = cur.fetchone()
        cur.execute("DELETE FROM itma_deleted_categories WHERE category_key = %s", (category_key,))
        conn.commit()
        log_audit(session.get("username"), "create", resource="ITMA", details=f"카테고리 추가: {display_name}")
        return jsonify({"success": True, "category": {"category_key": row[0], "display_name": row[1], "supports_spec_forms": bool(row[2]), "display_order": row[3]}}), 201
    except Exception as error:
        conn.rollback()
        if "uq_itma_categories_display_name" in str(error) or "itma_categories_pkey" in str(error):
            return jsonify({"success": False, "message": "이미 등록된 카테고리입니다."}), 409
        traceback.print_exc()
        return jsonify({"success": False, "message": "카테고리 저장 중 오류가 발생했습니다."}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/categories/reorder", methods=["POST"])
def reorder_categories():
    if session.get("role") != "admin":
        return jsonify({"success": False, "message": "카테고리 순서 변경 권한이 없습니다."}), 403
    order = (request.get_json(silent=True) or {}).get("order")
    if not isinstance(order, list) or any(not isinstance(key, str) or not key for key in order) or len(order) != len(set(order)):
        return jsonify({"success": False, "message": "카테고리 순서 정보가 올바르지 않습니다."}), 400
    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # 생성·삭제와 순서 저장이 동시에 실행되어 목록이 달라지는 것을 방지합니다.
        cur.execute("LOCK TABLE itma_categories IN SHARE ROW EXCLUSIVE MODE")
        cur.execute("SELECT category_key FROM itma_categories")
        current_keys = {row[0] for row in cur.fetchall()}
        if set(order) != current_keys:
            return jsonify({"success": False, "message": "카테고리 목록이 변경되었습니다. 새로고침 후 다시 시도해주세요."}), 409
        for index, category_key in enumerate(order):
            cur.execute("UPDATE itma_categories SET display_order = %s WHERE category_key = %s", ((index + 1) * 10, category_key))
        conn.commit()
        log_audit(session.get("username"), "update", resource="ITMA", details="카테고리 순서 변경")
        return jsonify({"success": True})
    except Exception:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "message": "카테고리 순서 저장 중 오류가 발생했습니다."}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/categories/<string:category_key>", methods=["DELETE"])
def delete_category(category_key):
    if session.get("role") != "admin":
        return jsonify({"success": False, "message": "카테고리 삭제 권한이 없습니다."}), 403
    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # 삭제 검사 중 자산이나 폼이 새로 연결되는 것을 방지합니다.
        cur.execute("LOCK TABLE itma_assets, itma_spec_forms IN SHARE ROW EXCLUSIVE MODE")
        cur.execute("SELECT display_name FROM itma_categories WHERE category_key = %s FOR UPDATE", (category_key,))
        category = cur.fetchone()
        if not category:
            return jsonify({"success": False, "message": "카테고리를 찾을 수 없습니다."}), 404
        cur.execute("SELECT EXISTS (SELECT 1 FROM itma_assets WHERE LOWER(TRIM(category)) = %s)", (category_key,))
        if cur.fetchone()[0]:
            return jsonify({"success": False, "message": "자산이 연결된 카테고리입니다. 자산의 카테고리를 변경한 후 삭제해주세요."}), 409
        cur.execute("SELECT EXISTS (SELECT 1 FROM itma_spec_forms WHERE category_key = %s)", (category_key,))
        if cur.fetchone()[0]:
            return jsonify({"success": False, "message": "스펙 폼이 연결된 카테고리입니다. 스펙 폼을 삭제한 후 다시 시도해주세요."}), 409
        cur.execute("DELETE FROM itma_categories WHERE category_key = %s", (category_key,))
        cur.execute(
            "INSERT INTO itma_deleted_categories (category_key) VALUES (%s) ON CONFLICT DO NOTHING",
            (category_key,),
        )
        conn.commit()
        log_audit(session.get("username"), "delete", resource="ITMA", details=f"카테고리 삭제: {category[0]}")
        return jsonify({"success": True})
    except Exception:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "message": "카테고리 삭제 중 오류가 발생했습니다."}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/assets", methods=["GET"])
def get_assets():
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions

    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    search_keyword = (request.args.get("q") or "").strip()
    try:
        base_query = """
            SELECT itma_assets.id, itma_assets.category, itma_assets.manufacturer, itma_assets.item_name, itma_assets.serial_number, itma_assets.received_date,
                   itma_assets.inbound_note, itma_assets.released_date, itma_assets.outbound_note, itma_assets.storage_location,
                   itma_assets.detail_note, itma_assets.sales_rep, itma_assets.usage_status, itma_assets.manufacture_month, itma_assets.input_at, itma_assets.updated_at, itma_assets.updated_by, itma_assets.asset_id, itma_assets.asset_code,
                   itma_assets.row_no, d.delivery_month, d.durability_years, itma_assets.site
            FROM (
                SELECT
                    id, category, manufacturer, item_name, serial_number, received_date,
                    inbound_note, released_date, outbound_note, storage_location,
                    detail_note, sales_rep, usage_status, manufacture_month, input_at, updated_at, updated_by, asset_id, asset_code, site,
                    ROW_NUMBER() OVER (ORDER BY input_at DESC, id DESC) AS row_no
                FROM itma_assets
            ) itma_assets
            LEFT JOIN itma_asset_details d ON d.asset_id = itma_assets.id
        """
        if search_keyword:
            like_keyword = f"%{search_keyword}%"
            cur.execute(
                base_query
                + """
                WHERE COALESCE(itma_assets.asset_id, '') ILIKE %s
                   OR COALESCE(itma_assets.asset_code, '') ILIKE %s
                   OR COALESCE(itma_assets.category, '') ILIKE %s
                   OR COALESCE(itma_assets.manufacturer, '') ILIKE %s
                   OR COALESCE(itma_assets.item_name, '') ILIKE %s
                   OR COALESCE(itma_assets.serial_number, '') ILIKE %s
                   OR COALESCE(itma_assets.inbound_note, '') ILIKE %s
                   OR COALESCE(itma_assets.outbound_note, '') ILIKE %s
                   OR COALESCE(itma_assets.storage_location, '') ILIKE %s
                   OR COALESCE(itma_assets.detail_note, '') ILIKE %s
                   OR COALESCE(itma_assets.sales_rep, '') ILIKE %s
                   OR COALESCE(itma_assets.updated_by, '') ILIKE %s
                   OR COALESCE(itma_assets.usage_status, '') ILIKE %s
                   OR COALESCE(itma_assets.site, '') ILIKE %s
                   OR TO_CHAR(itma_assets.received_date, 'YYYY-MM-DD') ILIKE %s
                   OR TO_CHAR(itma_assets.released_date, 'YYYY-MM-DD') ILIKE %s
                   OR TO_CHAR(itma_assets.manufacture_month, 'YYYY-MM') ILIKE %s
                   OR TO_CHAR(itma_assets.input_at, 'YYYY-MM-DD HH24:MI:SS') ILIKE %s
                   OR TO_CHAR(itma_assets.updated_at, 'YYYY-MM-DD HH24:MI:SS') ILIKE %s
                   OR COALESCE(d.hostname, '') ILIKE %s
                   OR COALESCE(d.ip_address, '') ILIKE %s
                   OR COALESCE(d.os_version, '') ILIKE %s
                   OR COALESCE(d.network_type, '') ILIKE %s
                   OR COALESCE(d.mac_address, '') ILIKE %s
                   OR COALESCE(d.serial_number, '') ILIKE %s
                   OR COALESCE(d.used_group, '') ILIKE %s
                   OR COALESCE(d.used_user, '') ILIKE %s
                   OR COALESCE(d.user_position, '') ILIKE %s
                   OR COALESCE(d.cpu_spec, '') ILIKE %s
                   OR COALESCE(d.mem_spec, '') ILIKE %s
                   OR COALESCE(d.hdd_spec, '') ILIKE %s
                   OR COALESCE(d.nw_port, '') ILIKE %s
                   OR COALESCE(d.equipment_status, '') ILIKE %s
                   OR COALESCE(d.vendor_name, '') ILIKE %s
                   OR COALESCE(d.maintenance_period, '') ILIKE %s
                   OR COALESCE(d.vendor_contact, '') ILIKE %s
                   OR COALESCE(d.vendor_phone, '') ILIKE %s
                   OR COALESCE(d.vendor_mail, '') ILIKE %s
                   OR COALESCE(d.pre_auth_type, '') ILIKE %s
                   OR COALESCE(d.auth_completion_status, '') ILIKE %s
                   OR COALESCE(d.auth_number, '') ILIKE %s
                   OR COALESCE(d.crypto_verification_number, '') ILIKE %s
                   OR COALESCE(d.updated_by, '') ILIKE %s
                   OR COALESCE(d.setting_change::text, '') ILIKE %s
                   OR COALESCE(d.config_change::text, '') ILIKE %s
                   OR COALESCE(d.firmware_change::text, '') ILIKE %s
                   OR COALESCE(d.maintenance_months::text, '') ILIKE %s
                   OR TO_CHAR(d.maintenance_start_date, 'YYYY-MM-DD') ILIKE %s
                   OR TO_CHAR(d.maintenance_end_date, 'YYYY-MM-DD') ILIKE %s
                   OR TO_CHAR(d.equipment_status_date, 'YYYY-MM-DD') ILIKE %s
                   OR TO_CHAR(d.auth_date, 'YYYY-MM-DD') ILIKE %s
                   OR TO_CHAR(d.updated_at, 'YYYY-MM-DD HH24:MI:SS') ILIKE %s
                   OR EXISTS (
                       SELECT 1
                       FROM itma_asset_spec_items asi
                       WHERE asi.asset_id = itma_assets.id
                         AND (
                             COALESCE(asi.spec_label, '') ILIKE %s
                             OR COALESCE(asi.spec_value, '') ILIKE %s
                         )
                   )
                ORDER BY itma_assets.row_no
                """,
                (like_keyword,) * 54,
            )
        else:
            cur.execute(
                base_query
                + """
                ORDER BY itma_assets.row_no
                """
            )
        rows = cur.fetchall()
        items = [
            _asset_row_to_item(row)
            for row in rows
            if _can_view_category(permissions, row[1] or "")
        ]
        custom_columns = _load_custom_columns(cur)
        custom_column_values = _load_custom_column_values(cur, [item.get("id") for item in items])
        detail_columns = [
            {"key": key, "label": label, "group_key": group, "subgroup_key": subgroup, "readonly": True, "default_visible": False}
            for key, label, group, subgroup, _field in DETAIL_COLUMN_DEFINITIONS
        ]
        detail_column_values = _load_detail_column_values(cur, [item.get("id") for item in items])
        spec_columns = _load_visible_spec_columns(cur, permissions)
        spec_column_values = _load_spec_column_values(cur, [item.get("id") for item in items], spec_columns)
        latest_updated_at = max((row[15] for row in rows if row[15]), default=None)
        latest_input_at = max((row[14] for row in rows if row[14]), default=None)
        return jsonify(
            {
                "success": True,
                "items": items,
                "custom_columns": custom_columns,
                "custom_column_values": custom_column_values,
                "detail_columns": detail_columns,
                "detail_column_values": detail_column_values,
                "spec_columns": spec_columns,
                "spec_column_values": spec_column_values,
                "latest_updated_at": latest_updated_at.strftime("%Y-%m-%d %H:%M:%S") if latest_updated_at else "",
                "latest_input_at": latest_input_at.strftime("%Y-%m-%d %H:%M:%S") if latest_input_at else "",
                "server_time": _now_local().strftime("%Y-%m-%d %H:%M:%S"),
                "permissions": permissions,
            }
        )
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


def _match_upload_extra_columns(cur, df, col_map, column_map_df=None):
    """업로드 파일의 상세 스펙·사용자 정의 컬럼 인식 (현재 서버에 있는 항목만). 반환: (인식 컬럼 목록, 무시한 헤더 목록)

    다운로드 파일의 `_columns` 시트가 있으면 열 위치 → 컬럼 키로 인식, 없으면 헤더 이름으로 매칭
    """
    used_columns = {value for key, value in col_map.items() if key != "serial_number_candidates" and value}
    used_columns.update(col_map.get("serial_number_candidates") or [])
    spec_items = _load_excel_spec_items(cur)
    spec_by_key = {item["key"]: item for item in spec_items}
    spec_by_label = {}
    for item in spec_items:
        spec_by_label.setdefault(item["label"].casefold(), []).append(item)
    custom_columns = _load_custom_columns(cur)
    custom_by_key = {column["key"]: column for column in custom_columns}
    custom_by_label = {str(column["label"] or "").strip().casefold(): column for column in custom_columns if column["label"]}
    key_by_position = {}
    if column_map_df is not None and not column_map_df.empty and len(column_map_df.columns) >= 2:
        for _, map_row in column_map_df.iterrows():
            try:
                key_by_position[int(map_row.iloc[0])] = str(map_row.iloc[1]).strip()
            except (TypeError, ValueError):
                continue
    auto_headers = {re.sub(r"\s+", "", label).lower() for _key, label, _group, kind in ITMA_UPLOAD_TEMPLATE_COLUMNS if kind == "auto"}

    extras, ignored = [], []
    for position, column in enumerate(df.columns, start=1):
        if column in used_columns:
            continue
        # pandas가 같은 이름 헤더에 붙이는 접미사(.1, .2) 제거
        header = re.sub(r"\.\d+$", "", str(column)).strip()
        if not header or header.startswith("Unnamed:") or re.sub(r"\s+", "", header).lower() in auto_headers:
            continue
        mapped_key = key_by_position.get(position)
        if mapped_key:
            if mapped_key in spec_by_key:
                extras.append({"column": column, "kind": "spec", "items": [spec_by_key[mapped_key]]})
            elif mapped_key in custom_by_key:
                extras.append({"column": column, "kind": "custom", "key": mapped_key})
            else:
                # 다운로드 이후 삭제된 컬럼
                ignored.append(header)
            continue
        folded = header.casefold()
        if folded in spec_by_label:
            extras.append({"column": column, "kind": "spec", "items": spec_by_label[folded]})
        elif folded in custom_by_label:
            extras.append({"column": column, "kind": "custom", "key": custom_by_label[folded]["key"]})
        else:
            # 삭제된 컬럼·이전 버전 컬럼(상세스펙_* 등)·알 수 없는 컬럼
            ignored.append(header)
    return extras, ignored


@itma_bp.route("/assets/upload", methods=["POST"])
def upload_assets():
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    if not permissions.get("can_edit_all") and not permissions.get("edit_categories"):
        return jsonify({"success": False, "message": "업로드 권한이 없습니다."}), 403

    file = request.files.get("file")
    if not file:
        return jsonify({"success": False, "message": "파일이 선택되지 않았습니다."}), 400

    filename = file.filename or ""
    if not filename.lower().endswith((".xlsx", ".xls")):
        return jsonify({"success": False, "message": "지원하지 않는 파일 형식입니다. (.xlsx, .xls)"}), 400


    asset_code_seed = _normalize_asset_seed(request.form.get("asset_code_seed")) or "ITMA"
    _ensure_itma_table()
    try:
        sheets = pd.read_excel(file, sheet_name=None)
    except Exception as e:
        return jsonify({"success": False, "message": f"파일 읽기 오류: {str(e)}"}), 400
    # 첫 번째 시트가 자산 데이터, `_columns` 숨김 시트는 다운로드 파일의 컬럼 키 매핑
    data_sheets = [frame for name, frame in sheets.items() if name != ITMA_EXCEL_COLUMN_MAP_SHEET]
    if not data_sheets:
        return jsonify({"success": False, "message": "업로드 파일에 데이터가 없습니다."}), 400
    df = data_sheets[0]
    column_map_df = sheets.get(ITMA_EXCEL_COLUMN_MAP_SHEET)

    if df.empty:
        return jsonify({"success": False, "message": "업로드 파일에 데이터가 없습니다."}), 400

    # 필수 항목 없음: 모든 항목이 빈칸이어도 업로드 허용 (자산번호·시리얼번호 중복만 차단)
    col_map = _normalize_columns(df)
    data_columns = [col_map[key] for key in ITMA_UPLOAD_COLUMN_ALIASES if col_map.get(key)]
    data_columns += [col for col in col_map["serial_number_candidates"] if col not in data_columns]

    def cell(row, key):
        column = col_map.get(key)
        return row.get(column) if column else None

    user_id = session.get("username")
    actor_name = _get_itma_actor_name()
    conn = get_db_connection()
    cur = conn.cursor()
    inserted = 0
    skipped_duplicates = 0
    skipped_asset_id_duplicates = 0
    skipped_serial_duplicates = 0
    skipped_duplicate_rows = []
    try:
        # 상세 스펙·사용자 정의 컬럼 (현재 서버에 있는 항목만, 삭제·이전 버전 컬럼은 무시)
        extra_columns, ignored_headers = _match_upload_extra_columns(cur, df, col_map, column_map_df)
        if not data_columns and not extra_columns:
            return jsonify({"success": False, "message": "ITMA 업로드 양식의 컬럼을 찾을 수 없습니다. 템플릿을 내려받아 작성해 주세요."}), 400
        can_save_custom = bool(permissions.get("can_manage_columns"))
        spec_saved = 0
        spec_skipped = 0
        custom_saved = 0
        custom_skipped = 0

        # 시리얼 중복 기준: 기본 정보(itma_assets)와 장비 상세(itma_asset_details) 시리얼 모두
        cur.execute(
            """
            SELECT serial_number
            FROM itma_assets
            WHERE serial_number IS NOT NULL AND serial_number <> ''
            UNION
            SELECT serial_number
            FROM itma_asset_details
            WHERE serial_number IS NOT NULL AND serial_number <> ''
            """
        )
        existing_serials = {}
        for row in cur.fetchall():
            if not row:
                continue
            normalized = _normalize_serial(row[0])
            if normalized:
                existing_serials[normalized] = str(row[0]).strip()

        cur.execute(
            """
            SELECT asset_id, asset_code
            FROM itma_assets
            WHERE (asset_id IS NOT NULL AND asset_id <> '')
               OR (asset_code IS NOT NULL AND asset_code <> '')
            """
        )
        existing_asset_ids = set()
        existing_asset_codes = set()
        max_asset_code_seq = 0
        prefix_pattern = re.compile(rf"^{re.escape(asset_code_seed)}-(\d+)$")
        for row in cur.fetchall():
            if not row:
                continue
            asset_id_value = _clean_text(row[0]) if len(row) > 0 else None
            asset_code_value = _clean_text(row[1]) if len(row) > 1 else None
            if asset_id_value:
                existing_asset_ids.add(asset_id_value)
            if not asset_code_value:
                continue
            existing_asset_codes.add(asset_code_value)
            matched = prefix_pattern.match(asset_code_value)
            if matched:
                max_asset_code_seq = max(max_asset_code_seq, int(matched.group(1)))
        next_asset_code_seq = max_asset_code_seq + 1
        upload_asset_ids = {}
        upload_asset_codes = {}
        upload_serials = {}

        for excel_row_no, (_, row) in enumerate(df.iterrows(), start=2):
            # 번호·수정 일시·수정자(자동 입력)를 제외한 모든 칸이 빈 행만 건너뜀
            if all(_clean_excel_text(row.get(column)) is None for column in data_columns + [extra["column"] for extra in extra_columns]):
                continue
            item_name = _clean_excel_text(cell(row, "item_name"))

            serial_value = None
            for column in col_map["serial_number_candidates"]:
                serial_value = _clean_excel_text(row.get(column))
                if serial_value:
                    break

            payload = {
                "category": _normalize_category(cell(row, "category")) if col_map.get("category") else None,
                "site": _clean_excel_text(cell(row, "site")),
                "asset_id": _clean_excel_text(cell(row, "asset_id")),
                "item_name": item_name,
                "manufacturer": _clean_excel_text(cell(row, "manufacturer")),
                "serial_number": serial_value,
                "received_date": _to_date(cell(row, "received_date")) if col_map.get("received_date") else None,
                "inbound_note": _clean_excel_text(cell(row, "inbound_note")),
                "released_date": _to_date(cell(row, "released_date")) if col_map.get("released_date") else None,
                "outbound_note": _clean_excel_text(cell(row, "outbound_note")),
                "storage_location": _clean_excel_text(cell(row, "storage_location")),
                "detail_note": _clean_excel_text(cell(row, "detail_note")),
                "sales_rep": _clean_excel_text(cell(row, "sales_rep")),
                "usage_status": _normalize_usage_status(cell(row, "usage_status")) if col_map.get("usage_status") else "",
                "manufacture_month": _parse_month_date(cell(row, "manufacture_month")) if col_map.get("manufacture_month") else None,
            }
            detail_payload = {field: _clean_excel_text(cell(row, field)) for field in ITMA_UPLOAD_DETAIL_FIELDS}

            asset_id_raw = payload.get("asset_id") or ""
            if asset_id_raw and (asset_id_raw in existing_asset_ids or asset_id_raw in upload_asset_ids):
                duplicate_target = "DB 자산번호"
                if asset_id_raw in upload_asset_ids:
                    duplicate_target = f"업로드 파일 자산번호 (행 {upload_asset_ids[asset_id_raw]})"
                skipped_duplicates += 1
                skipped_asset_id_duplicates += 1
                skipped_duplicate_rows.append(
                    {
                        "row": excel_row_no,
                        "match_column": "자산번호",
                        "target_column": duplicate_target,
                        "match_value": asset_id_raw,
                        "serial_number": payload.get("serial_number") or "",
                        "item_name": item_name or "",
                    }
                )
                continue

            serial_raw = payload["serial_number"] or ""
            serial_key = _normalize_serial(serial_raw)
            if serial_key and (serial_key in existing_serials or serial_key in upload_serials):
                duplicate_target = "DB 시리얼번호"
                if serial_key in upload_serials:
                    duplicate_target = f"업로드 파일 시리얼번호 (행 {upload_serials[serial_key]})"
                skipped_duplicates += 1
                skipped_serial_duplicates += 1
                skipped_duplicate_rows.append(
                    {
                        "row": excel_row_no,
                        "match_column": "시리얼번호",
                        "target_column": duplicate_target,
                        "match_value": serial_raw,
                        "serial_number": serial_raw,
                        "item_name": item_name or "",
                    }
                )
                continue

            generated_asset_code = _make_generated_asset_code(asset_code_seed, next_asset_code_seq)
            while generated_asset_code in existing_asset_codes or generated_asset_code in upload_asset_codes:
                next_asset_code_seq += 1
                generated_asset_code = _make_generated_asset_code(asset_code_seed, next_asset_code_seq)
            payload["asset_code"] = generated_asset_code

            now_ts = _to_db_timestamp(_now_local())
            cur.execute(
                """
                INSERT INTO itma_assets (
                    asset_id, asset_code, category, item_name, manufacturer, serial_number, received_date, inbound_note,
                    released_date, outbound_note, storage_location, detail_note, sales_rep, usage_status, manufacture_month,
                    uploaded_by, updated_by, input_at, updated_at, site
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    payload["asset_id"],
                    payload["asset_code"],
                    payload["category"],
                    payload["item_name"],
                    payload["manufacturer"],
                    payload["serial_number"],
                    payload["received_date"],
                    payload["inbound_note"],
                    payload["released_date"],
                    payload["outbound_note"],
                    payload["storage_location"],
                    payload["detail_note"],
                    payload["sales_rep"],
                    payload["usage_status"],
                    payload["manufacture_month"],
                    actor_name,
                    actor_name,
                    now_ts,
                    now_ts,
                    payload["site"],
                ),
            )
            new_asset_pk = cur.fetchone()[0]

            # 장비 정보·장비 상세 (화면의 Serial Number와 같은 값으로 저장)
            if serial_raw or any(detail_payload.values()):
                cur.execute(
                    """
                    INSERT INTO itma_asset_details (
                        asset_id, used_group, used_user, user_position, network_type, ip_address, mac_address,
                        hostname, os_version, serial_number, updated_at, updated_by
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (asset_id) DO UPDATE SET
                        used_group = EXCLUDED.used_group,
                        used_user = EXCLUDED.used_user,
                        user_position = EXCLUDED.user_position,
                        network_type = EXCLUDED.network_type,
                        ip_address = EXCLUDED.ip_address,
                        mac_address = EXCLUDED.mac_address,
                        hostname = EXCLUDED.hostname,
                        os_version = EXCLUDED.os_version,
                        serial_number = EXCLUDED.serial_number,
                        updated_at = EXCLUDED.updated_at,
                        updated_by = EXCLUDED.updated_by
                    """,
                    (
                        new_asset_pk,
                        detail_payload["used_group"],
                        detail_payload["used_user"],
                        detail_payload["user_position"],
                        detail_payload["network_type"],
                        detail_payload["ip_address"],
                        detail_payload["mac_address"],
                        detail_payload["hostname"],
                        detail_payload["os_version"],
                        payload["serial_number"],
                        now_ts,
                        actor_name,
                    ),
                )

            # 상세 스펙(자산 카테고리의 스펙 폼 항목만)·사용자 정의 컬럼(컬럼 관리 권한자만)
            category_key = _normalize_category_key(payload["category"]) if payload["category"] else ""
            for extra in extra_columns:
                extra_value = _clean_excel_text(row.get(extra["column"]))
                if not extra_value:
                    continue
                if extra["kind"] == "spec":
                    spec_item = next((item for item in extra["items"] if item["category_key"] == category_key), None)
                    if not spec_item:
                        spec_skipped += 1
                        continue
                    cur.execute(
                        """
                        INSERT INTO itma_asset_spec_items
                            (asset_id, spec_label, spec_value, display_order, source_form_item_id, updated_at, updated_by)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (asset_id, source_form_item_id) WHERE source_form_item_id IS NOT NULL
                        DO UPDATE SET spec_value = EXCLUDED.spec_value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
                        """,
                        (new_asset_pk, spec_item["label"], extra_value, spec_item["display_order"], spec_item["form_item_id"], now_ts, actor_name),
                    )
                    spec_saved += 1
                elif can_save_custom:
                    cur.execute(
                        """
                        INSERT INTO itma_custom_column_values (asset_id, column_key, column_value, updated_at, updated_by)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (asset_id, column_key) DO UPDATE SET
                            column_value = EXCLUDED.column_value,
                            updated_at = EXCLUDED.updated_at,
                            updated_by = EXCLUDED.updated_by
                        """,
                        (new_asset_pk, extra["key"], extra_value, now_ts, actor_name),
                    )
                    custom_saved += 1
                else:
                    custom_skipped += 1

            inserted += 1
            if payload.get("asset_id"):
                existing_asset_ids.add(payload["asset_id"])
                upload_asset_ids[payload["asset_id"]] = excel_row_no
            if payload.get("asset_code"):
                existing_asset_codes.add(payload["asset_code"])
                upload_asset_codes[payload["asset_code"]] = excel_row_no
                if payload["asset_code"].startswith(f"{asset_code_seed}-"):
                    next_asset_code_seq += 1
            if serial_key:
                upload_serials[serial_key] = excel_row_no

        conn.commit()
        extra_notes = []
        if spec_saved or custom_saved:
            extra_notes.append(f"상세 스펙 값 {spec_saved}건·사용자 정의 값 {custom_saved}건 저장")
        if spec_skipped:
            extra_notes.append(f"자산 카테고리의 스펙 폼 항목이 아닌 값 {spec_skipped}건 제외")
        if custom_skipped:
            extra_notes.append(f"사용자 정의 컬럼은 컬럼 관리 권한이 없어 {custom_skipped}건 미반영")
        if ignored_headers:
            preview = ", ".join(ignored_headers[:5]) + (f" 외 {len(ignored_headers) - 5}개" if len(ignored_headers) > 5 else "")
            extra_notes.append(f"현재 없는 컬럼 무시: {preview}")
        log_audit(
            user_id,
            "upload",
            resource="ITMA",
            details=(
                f"자산 업로드 추가 {inserted}건, 자산번호 중복 미업로드 {skipped_asset_id_duplicates}건, "
                f"시리얼번호 중복 미업로드 {skipped_serial_duplicates}건"
                + (f", 상세 스펙 {spec_saved}건, 사용자 정의 {custom_saved}건" if spec_saved or custom_saved else "")
            ),
        )
        return jsonify(
            {
                "success": True,
                "message": (
                    f"업로드 완료: 추가 {inserted}건 / "
                    f"자산번호 중복으로 미업로드 {skipped_asset_id_duplicates}건 / "
                    f"시리얼번호 중복으로 미업로드 {skipped_serial_duplicates}건"
                    + "".join(f" / {note}" for note in extra_notes)
                ),
                "spec_saved": spec_saved,
                "custom_saved": custom_saved,
                "ignored_columns": ignored_headers,
                "inserted": inserted,
                "updated": 0,
                "skipped_duplicates": skipped_duplicates,
                "skipped_asset_id_duplicates": skipped_asset_id_duplicates,
                "skipped_serial_duplicates": skipped_serial_duplicates,
                "skipped_duplicate_rows": skipped_duplicate_rows,
            }
        )
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@itma_bp.route("/custom-columns", methods=["GET"])
def get_custom_columns():
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    _ensure_itma_table()
    actor_name = _get_itma_actor_name()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        return jsonify({"success": True, "columns": _load_custom_columns(cur)})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/custom-columns", methods=["POST"])
def create_custom_column():
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    if not permissions.get("can_manage_columns"):
        return jsonify({"success": False, "message": "사용자 컬럼 관리 권한이 없습니다."}), 403
    _ensure_itma_table()
    data = request.get_json() or {}
    label = _normalize_custom_column_label(data.get("label"))
    if not label:
        return jsonify({"success": False, "message": "컬럼명이 필요합니다."}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT 1
            FROM itma_custom_columns
            WHERE LOWER(column_label) = LOWER(%s)
            LIMIT 1
            """,
            (label,),
        )
        if cur.fetchone():
            conn.rollback()
            return jsonify({"success": False, "message": "동일한 컬럼명이 이미 존재합니다."}), 400

        cur.execute("SELECT COALESCE(MAX(display_order), -1) + 1 FROM itma_custom_columns")
        next_order_row = cur.fetchone()
        next_order = int(next_order_row[0]) if next_order_row and next_order_row[0] is not None else 0

        seed = int(_now_local().timestamp())
        column_key = _make_custom_column_key(label, str(seed))
        suffix = 1
        while True:
            cur.execute("SELECT 1 FROM itma_custom_columns WHERE column_key = %s LIMIT 1", (column_key,))
            if not cur.fetchone():
                break
            suffix += 1
            column_key = f"{_make_custom_column_key(label, str(seed))}_{suffix}"

        now_ts = _to_db_timestamp(_now_local())
        user_id = session.get("username")
        actor_name = _get_itma_actor_name()
        cur.execute(
            """
            INSERT INTO itma_custom_columns (
                column_key, column_label, display_order, created_at, created_by, updated_at, updated_by
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (column_key, label, next_order, now_ts, actor_name, now_ts, actor_name),
        )
        conn.commit()
        log_audit(user_id, "create", resource="ITMA", details=f"사용자 컬럼 추가: {label} ({column_key})")
        return jsonify({"success": True, "column": {"key": column_key, "label": label, "display_order": next_order}})
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/custom-columns/<string:column_key>", methods=["DELETE"])
def delete_custom_column(column_key):
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    if not permissions.get("can_manage_columns"):
        return jsonify({"success": False, "message": "사용자 컬럼 관리 권한이 없습니다."}), 403
    _ensure_itma_table()
    clean_key = _clean_text(column_key) or ""
    if not clean_key:
        return jsonify({"success": False, "message": "삭제할 컬럼 키가 없습니다."}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT column_label
            FROM itma_custom_columns
            WHERE column_key = %s
            """,
            (clean_key,),
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            return jsonify({"success": False, "message": "대상 컬럼을 찾을 수 없습니다."}), 404

        label = row[0] or clean_key
        cur.execute("DELETE FROM itma_custom_columns WHERE column_key = %s", (clean_key,))
        conn.commit()
        username = session.get("username")
        log_audit(username, "delete", resource="ITMA", details=f"사용자 컬럼 삭제: {label} ({clean_key})")
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/custom-columns/reorder", methods=["POST"])
def reorder_custom_columns():
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    if not permissions.get("can_manage_columns"):
        return jsonify({"success": False, "message": "사용자 컬럼 관리 권한이 없습니다."}), 403
    _ensure_itma_table()
    data = request.get_json() or {}
    order = data.get("order")
    if not isinstance(order, list):
        return jsonify({"success": False, "message": "정렬 정보가 올바르지 않습니다."}), 400
    order_keys = [(_clean_text(key) or "") for key in order]
    order_keys = [key for key in order_keys if key]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT column_key FROM itma_custom_columns ORDER BY display_order ASC, id ASC")
        current_keys = [row[0] for row in cur.fetchall() if row and row[0]]
        if not current_keys:
            conn.rollback()
            return jsonify({"success": True})

        ordered = [key for key in order_keys if key in current_keys]
        ordered.extend([key for key in current_keys if key not in ordered])
        actor_name = _get_itma_actor_name()
        now_ts = _to_db_timestamp(_now_local())
        for idx, key in enumerate(ordered):
            cur.execute(
                """
                UPDATE itma_custom_columns
                SET display_order = %s, updated_at = %s, updated_by = %s
                WHERE column_key = %s
                """,
                (idx, now_ts, actor_name, key),
            )
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/custom-columns/value", methods=["PATCH"])
def update_custom_column_value():
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    if not permissions.get("can_manage_columns"):
        return jsonify({"success": False, "message": "사용자 컬럼 관리 권한이 없습니다."}), 403
    _ensure_itma_table()

    data = request.get_json() or {}
    try:
        asset_id = int(data.get("asset_id"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "유효하지 않은 자산번호 입니다."}), 400

    column_key = _clean_text(data.get("column_key")) or ""
    if not column_key:
        return jsonify({"success": False, "message": "컬럼 키가 필요합니다."}), 400

    value_text = data.get("value")
    if value_text is None:
        value_text = ""
    value_text = str(value_text).strip()

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT category FROM itma_assets WHERE id = %s LIMIT 1", (asset_id,))
        asset_row = cur.fetchone()
        if not asset_row:
            conn.rollback()
            return jsonify({"success": False, "message": "대상 자산을 찾을 수 없습니다."}), 404
        if not _can_edit_category(permissions, asset_row[0] or ""):
            conn.rollback()
            return jsonify({"success": False, "message": "해당 카테고리 수정 권한이 없습니다."}), 403

        cur.execute(
            """
            SELECT column_label
            FROM itma_custom_columns
            WHERE column_key = %s
            LIMIT 1
            """,
            (column_key,),
        )
        column_row = cur.fetchone()
        if not column_row:
            conn.rollback()
            return jsonify({"success": False, "message": "대상 사용자 컬럼을 찾을 수 없습니다."}), 404
        column_label = _clean_text(column_row[0]) or column_key

        actor_name = _get_itma_actor_name()
        now_ts = _to_db_timestamp(_now_local())
        if value_text == "":
            cur.execute(
                """
                DELETE FROM itma_custom_column_values
                WHERE asset_id = %s AND column_key = %s
                """,
                (asset_id, column_key),
            )
        else:
            cur.execute(
                """
                INSERT INTO itma_custom_column_values (
                    asset_id, column_key, column_value, updated_at, updated_by
                ) VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (asset_id, column_key)
                DO UPDATE SET
                    column_value = EXCLUDED.column_value,
                    updated_at = EXCLUDED.updated_at,
                    updated_by = EXCLUDED.updated_by
                """,
                (asset_id, column_key, value_text, now_ts, actor_name),
            )
        conn.commit()

        username = session.get("username")
        log_audit(
            username,
            "update",
            resource="ITMA",
            details=f"사용자 컬럼 값 변경: asset_id={asset_id}, 컬럼={column_label}({column_key})",
        )
        return jsonify(
            {
                "success": True,
                "asset_id": asset_id,
                "column_key": column_key,
                "value": value_text,
                "updated_at": now_ts.strftime("%Y-%m-%d %H:%M:%S"),
                "updated_by": actor_name,
            }
        )
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/assets/<int:asset_id>", methods=["PATCH"])
def update_asset(asset_id):
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions

    data = request.get_json() or {}
    column = (data.get("column") or "").strip()
    value = data.get("value")

    allowed_columns = {
        "category",
        "item_name",
        "manufacturer",
        "serial_number",
        "received_date",
        "inbound_note",
        "released_date",
        "outbound_note",
        "storage_location",
        "detail_note",
        "sales_rep",
        "usage_status",
        "manufacture_month",
        "asset_id",
        "site",
    }

    if column not in allowed_columns:
        return jsonify({"success": False, "message": "변경할 값이 없습니다."}), 400

    parsed_value = _parse_value_by_column(column, value)

    user_id = session.get("username")
    actor_name = _get_itma_actor_name()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT category FROM itma_assets WHERE id = %s", (asset_id,))
        asset_row = cur.fetchone()
        if not asset_row:
            conn.rollback()
            return jsonify({"success": False, "message": "대상 자산을 찾을 수 없습니다."}), 404
        if not _can_edit_category(permissions, asset_row[0] or ""):
            conn.rollback()
            return jsonify({"success": False, "message": "해당 카테고리 수정 권한이 없습니다."}), 403
        if column == "category":
            cur.execute("SELECT display_name FROM itma_categories WHERE category_key = %s", (_normalize_category_key(value),))
            category_row = cur.fetchone()
            if not category_row:
                return jsonify({"success": False, "message": "등록된 카테고리를 선택해주세요."}), 400
            if not _can_edit_category(permissions, category_row[0]):
                return jsonify({"success": False, "message": "선택한 카테고리 수정 권한이 없습니다."}), 403
            parsed_value = category_row[0]

        cur.execute(
            """
            SELECT id, category, manufacturer, item_name, serial_number, received_date,
                   inbound_note, released_date, outbound_note, storage_location,
                   detail_note, sales_rep, usage_status, manufacture_month, input_at, updated_at, updated_by, asset_id, asset_code
            FROM itma_assets
            WHERE id = %s
            """,
            (asset_id,),
        )
        existing_row = cur.fetchone()
        if not existing_row:
            conn.rollback()
            return jsonify({"success": False, "message": "대상 자산을 찾을 수 없습니다."}), 404

        old_item = _attach_site(cur, _asset_row_to_item(existing_row))
        old_value = old_item.get(column)

        if column == "asset_id":
            if parsed_value:
                cur.execute(
                    """
                    SELECT id
                    FROM itma_assets
                    WHERE id <> %s
                      AND asset_id = %s
                    LIMIT 1
                    """,
                    (asset_id, parsed_value),
                )
                if cur.fetchone():
                    conn.rollback()
                    return jsonify({"success": False, "message": "Duplicate asset_id already exists."}), 400

        if column == "serial_number":
            serial_key = _normalize_serial(parsed_value)
            if serial_key:
                cur.execute(
                    """
                    SELECT id
                    FROM itma_assets
                    WHERE id <> %s
                      AND serial_number IS NOT NULL
                      AND serial_number <> ''
                      AND regexp_replace(upper(serial_number), '[[:space:]_-]+', '', 'g') = %s
                    LIMIT 1
                    """,
                    (asset_id, serial_key),
                )
                if cur.fetchone():
                    conn.rollback()
                    return jsonify({"success": False, "message": "중복된 시리얼번호가 존재합니다."}), 400

        now_ts = _to_db_timestamp(_now_local())
        cur.execute(
            f"""
            UPDATE itma_assets
            SET {column} = %s, updated_at = %s, updated_by = %s
            WHERE id = %s
            RETURNING id, category, manufacturer, item_name, serial_number, received_date,
                      inbound_note, released_date, outbound_note, storage_location,
                      detail_note, sales_rep, usage_status, manufacture_month, input_at, updated_at, updated_by, asset_id, asset_code
            """,
            (parsed_value, now_ts, actor_name, asset_id),
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            return jsonify({"success": False, "message": "대상 자산을 찾을 수 없습니다."}), 404

        updated_item = _attach_site(cur, _asset_row_to_item(row))
        if column == "usage_status":
            equipment_status = _usage_to_equipment_status(parsed_value)
            if equipment_status:
                status_date = now_ts.date()
                cur.execute(
                    """
                    INSERT INTO itma_asset_details (
                        asset_id, equipment_status, equipment_status_date, updated_at, updated_by
                    ) VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (asset_id) DO UPDATE
                    SET equipment_status = EXCLUDED.equipment_status,
                        equipment_status_date = EXCLUDED.equipment_status_date,
                        updated_at = EXCLUDED.updated_at,
                        updated_by = EXCLUDED.updated_by
                    """,
                    (asset_id, equipment_status, status_date, now_ts, actor_name),
                )
                cur.execute(
                    """
                    INSERT INTO itma_asset_equipment_changes (asset_id, status_date, equipment_status, created_by)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (asset_id, status_date, equipment_status, actor_name),
                )
        _insert_history(
            cur,
            asset_id=asset_id,
            action="update",
            actor=actor_name,
            changed_column=column,
            before_value=old_value,
            after_value=updated_item.get(column),
            snapshot=updated_item,
        )
        conn.commit()
        updated_at = updated_item.get("updated_at", "")
        updated_by = updated_item.get("updated_by", "")
        return jsonify({"success": True, "updated_at": updated_at, "updated_by": updated_by})
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/assets/<int:asset_id>/details", methods=["GET"])
def get_asset_details(asset_id):
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions

    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id, category FROM itma_assets WHERE id = %s", (asset_id,))
        asset_row = cur.fetchone()
        if not asset_row:
            return jsonify({"success": False, "message": "대상 자산을 찾을 수 없습니다."}), 404
        if not _can_view_category(permissions, asset_row[1] or ""):
            return jsonify({"success": False, "message": "해당 카테고리 조회 권한이 없습니다."}), 403

        cur.execute(
            """
            SELECT hostname, ip_address, os_version, cpu_spec, mem_spec, hdd_spec, nw_port,
                   equipment_status, setting_change, config_change, firmware_change,
                   vendor_name, maintenance_period, maintenance_start_date, maintenance_months, maintenance_end_date,
                   vendor_contact, vendor_phone, vendor_mail, pre_auth_type, auth_completion_status, auth_number, auth_date, crypto_verification_number,
                   equipment_status_date, used_user, used_group, purchase_datetime, delivery_month, durability_years,
                   updated_at, updated_by, network_type, user_position, mac_address, serial_number
            FROM itma_asset_details
            WHERE asset_id = %s
            """,
            (asset_id,),
        )
        detail_row = cur.fetchone()
        cur.execute(
            """
            SELECT change_date, change_type, change_note
            FROM itma_asset_detail_changes
            WHERE asset_id = %s
            ORDER BY change_date DESC NULLS LAST, id DESC
            """,
            (asset_id,),
        )
        detail_changes = [
            {
                "change_date": row[0].strftime("%Y-%m-%d") if row[0] else "",
                "change_type": row[1] or "",
                "change_note": row[2] or "",
            }
            for row in cur.fetchall()
        ]
        cur.execute(
            """
            SELECT change_date, vendor_name, maintenance_start_date, maintenance_months, maintenance_end_date, vendor_contact, vendor_phone, vendor_mail, change_note
            FROM itma_asset_delivery_changes
            WHERE asset_id = %s
            ORDER BY change_date DESC NULLS LAST, id DESC
            """,
            (asset_id,),
        )
        delivery_changes = [
            {
                "change_date": row[0].strftime("%Y-%m-%d") if row[0] else "",
                "vendor_name": row[1] or "",
                "maintenance_start_date": row[2].strftime("%Y-%m-%d") if row[2] else "",
                "maintenance_months": str(row[3]) if row[3] is not None else "",
                "maintenance_end_date": row[4].strftime("%Y-%m-%d") if row[4] else "",
                "vendor_contact": row[5] or "",
                "vendor_phone": row[6] or "",
                "vendor_mail": row[7] or "",
                "change_note": row[8] or "",
            }
            for row in cur.fetchall()
        ]
        cur.execute(
            """
            SELECT status_date, equipment_status
            FROM itma_asset_equipment_changes
            WHERE asset_id = %s
            ORDER BY status_date DESC NULLS LAST, id DESC
            """,
            (asset_id,),
        )
        equipment_changes = [
            {
                "status_date": row[0].strftime("%Y-%m-%d") if row[0] else "",
                "equipment_status": row[1] or "",
            }
            for row in cur.fetchall()
        ]
        cur.execute(
            """
            SELECT change_date, pre_auth_type, auth_completion_status, auth_number, auth_date, crypto_verification_number
            FROM itma_asset_security_changes
            WHERE asset_id = %s
            ORDER BY change_date DESC NULLS LAST, id DESC
            """,
            (asset_id,),
        )
        security_changes = [
            {
                "change_date": row[0].strftime("%Y-%m-%d") if row[0] else "",
                "pre_auth_type": row[1] or "",
                "auth_completion_status": row[2] or "",
                "auth_number": row[3] or "",
                "auth_date": row[4].strftime("%Y-%m-%d") if row[4] else "",
                "crypto_verification_number": row[5] or "",
            }
            for row in cur.fetchall()
        ]
        cur.execute(
            """
            SELECT software_name, version, install_date, expiry_date, installed_quantity, deployment_target, network_type, status, change_note
            FROM itma_asset_software_items
            WHERE asset_id = %s
            ORDER BY install_date DESC NULLS LAST, id DESC
            """,
            (asset_id,),
        )
        software_items = [
            {
                "software_name": row[0] or "",
                "version": row[1] or "",
                "install_date": row[2].strftime("%Y-%m-%d") if row[2] else "",
                "expiry_date": row[3].strftime("%Y-%m-%d") if row[3] else "",
                "installed_quantity": str(row[4]) if row[4] is not None else "",
                "quantity": str(row[4]) if row[4] is not None else "",
                "deployment_target": row[6] or row[5] or "",
                "network_type": row[6] or row[5] or "",
                "status": row[7] or "",
                "change_note": row[8] or "",
                "note": row[8] or "",
            }
            for row in cur.fetchall()
        ]
        cur.execute(
            """
            SELECT license_name, version, install_date, license_quantity, expiry_date, network_type, change_note
            FROM itma_asset_license_items
            WHERE asset_id = %s
            ORDER BY expiry_date DESC NULLS LAST, id DESC
            """,
            (asset_id,),
        )
        license_items = [
            {
                "license_name": row[0] or "",
                "version": row[1] or "",
                "install_date": row[2].strftime("%Y-%m-%d") if row[2] else "",
                "license_quantity": str(row[3]) if row[3] is not None else "",
                "quantity": str(row[3]) if row[3] is not None else "",
                "expiry_date": row[4].strftime("%Y-%m-%d") if row[4] else "",
                "network_type": row[5] or "",
                "vendor_name": row[5] or "",
                "compliance_status": "",
                "change_note": row[6] or "",
                "note": row[6] or "",
            }
            for row in cur.fetchall()
        ]
        spec_items = []
        if _supports_dynamic_spec_forms(asset_row[1] or ""):
            spec_items = _load_asset_spec_items(cur, asset_id)
        return jsonify(
            {
                "success": True,
                "details": _asset_details_row_to_item(
                    detail_row,
                    detail_changes=detail_changes,
                    delivery_changes=delivery_changes,
                    equipment_changes=equipment_changes,
                    security_changes=security_changes,
                    software_items=software_items,
                    license_items=license_items,
                    spec_items=spec_items if spec_items else _legacy_spec_items_from_payload(
                        {
                            "cpu_spec": detail_row[3] if detail_row else "",
                            "mem_spec": detail_row[4] if detail_row else "",
                            "hdd_spec": detail_row[5] if detail_row else "",
                            "nw_port": detail_row[6] if detail_row else "",
                        }
                    ),
                ),
            }
        )
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/assets/<int:asset_id>/spec-items/<int:form_item_id>", methods=["PATCH"])
def update_asset_spec_value(asset_id, form_item_id):
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    value = _clean_text((request.get_json(silent=True) or {}).get("value")) or ""
    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT category FROM itma_assets WHERE id = %s FOR UPDATE", (asset_id,))
        asset = cur.fetchone()
        if not asset:
            return jsonify({"success": False, "message": "대상 자산을 찾을 수 없습니다."}), 404
        if not _can_edit_category(permissions, asset[0]):
            return jsonify({"success": False, "message": "해당 카테고리 수정 권한이 없습니다."}), 403
        cur.execute(
            """
            SELECT sfi.spec_label, sfi.display_order FROM itma_spec_form_items sfi
            JOIN itma_spec_forms sf ON sf.id = sfi.form_id
            WHERE sfi.id = %s AND sf.category_key = %s AND sf.is_active = TRUE
            """,
            (form_item_id, _normalize_category_key(asset[0])),
        )
        item = cur.fetchone()
        if not item:
            return jsonify({"success": False, "message": "해당 카테고리의 스펙 항목이 아닙니다."}), 400
        now_ts = _to_db_timestamp(_now_local())
        actor = _get_itma_actor_name()
        cur.execute(
            """
            INSERT INTO itma_asset_spec_items
                (asset_id, spec_label, spec_value, display_order, source_form_item_id, updated_at, updated_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (asset_id, source_form_item_id) WHERE source_form_item_id IS NOT NULL
            DO UPDATE SET spec_label = EXCLUDED.spec_label, spec_value = EXCLUDED.spec_value,
                updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
            """,
            (asset_id, item[0], value, item[1], form_item_id, now_ts, actor),
        )
        conn.commit()
        log_audit(session.get("username"), "update", resource="ITMA", details=f"자산 스펙 수정: {asset_id}, {form_item_id}")
        return jsonify({"success": True, "value": value})
    except Exception:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "message": "스펙 저장 중 오류가 발생했습니다."}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/assets/<int:asset_id>/details/field", methods=["PATCH"])
def update_asset_detail_field(asset_id):
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions

    data = request.get_json() or {}
    field = (_clean_text(data.get("field")) or "").strip()
    if field not in EDITABLE_DETAIL_FIELDS:
        return jsonify({"success": False, "message": "수정할 수 없는 상세 필드입니다."}), 400
    value = _clean_text(data.get("value")) or ""

    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT category FROM itma_assets WHERE id = %s", (asset_id,))
        asset_row = cur.fetchone()
        if not asset_row:
            return jsonify({"success": False, "message": "대상 자산을 찾을 수 없습니다."}), 404
        if not _can_edit_category(permissions, asset_row[0] or ""):
            return jsonify({"success": False, "message": "해당 카테고리 수정 권한이 없습니다."}), 403

        now_ts = _to_db_timestamp(_now_local())
        actor_name = _get_itma_actor_name()
        cur.execute(
            f"""
            INSERT INTO itma_asset_details (asset_id, {field}, updated_at, updated_by)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (asset_id) DO UPDATE
            SET {field} = EXCLUDED.{field}, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
            """,
            (asset_id, value, now_ts, actor_name),
        )
        conn.commit()
        log_audit(session.get("username"), "update", resource="ITMA", details=f"상세 필드 수정: 자산 {asset_id}, {field}")
        return jsonify({"success": True, "field": field, "value": value, "updated_at": now_ts.strftime("%Y-%m-%d %H:%M:%S"), "updated_by": actor_name})
    except Exception as error:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "message": str(error)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/assets/<int:asset_id>/details", methods=["POST"])
def upsert_asset_details(asset_id):
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions

    raw_payload = request.get_json() or {}
    detail_scope = (_clean_text(raw_payload.get("detail_scope")) or "").strip().lower()
    if detail_scope not in {"", "pc", "software", "license", "other"}:
        detail_scope = ""
    payload = _normalize_asset_details_payload(raw_payload)
    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id, usage_status, category FROM itma_assets WHERE id = %s", (asset_id,))
        asset_row = cur.fetchone()
        if not asset_row:
            conn.rollback()
            return jsonify({"success": False, "message": "대상 자산을 찾을 수 없습니다."}), 404
        if not _can_edit_category(permissions, asset_row[2] or ""):
            conn.rollback()
            return jsonify({"success": False, "message": "해당 카테고리 수정 권한이 없습니다."}), 403
        before_usage_status = _normalize_usage_status(asset_row[1] if len(asset_row) > 1 else "")

        now_ts = _to_db_timestamp(_now_local())
        user_id = session.get("username")
        actor_name = _get_itma_actor_name()
        cur.execute(
            """
            SELECT equipment_status, equipment_status_date, vendor_name, maintenance_start_date, maintenance_months, maintenance_end_date,
                   pre_auth_type, auth_completion_status, auth_number, auth_date, used_user, used_group, purchase_datetime, delivery_month, durability_years
            FROM itma_asset_details
            WHERE asset_id = %s
            """,
            (asset_id,),
        )
        before_detail_row = cur.fetchone()
        before_detail_summary = {}
        before_spec_items = []
        if _supports_dynamic_spec_forms(asset_row[2] or ""):
            before_spec_items = _load_asset_spec_items(cur, asset_id)
        if before_detail_row:
            before_detail_summary = _asset_detail_history_summary(
                {
                    "equipment_status": before_detail_row[0] or "",
                    "equipment_status_date": before_detail_row[1],
                    "vendor_name": before_detail_row[2] or "",
                    "maintenance_start_date": before_detail_row[3],
                    "maintenance_months": before_detail_row[4],
                    "maintenance_end_date": before_detail_row[5],
                    "pre_auth_type": before_detail_row[6] or "",
                    "auth_completion_status": before_detail_row[7] or "",
                    "auth_number": before_detail_row[8] or "",
                    "auth_date": before_detail_row[9],
                    "used_user": before_detail_row[10] or "",
                    "used_group": before_detail_row[11] or "",
                    "purchase_datetime": before_detail_row[12],
                    "delivery_month": before_detail_row[13],
                    "durability_years": before_detail_row[14],
                    "detail_changes": [],
                    "equipment_changes": [],
                    "delivery_changes": [],
                    "security_changes": [],
                    "software_items": [],
                    "license_items": [],
                    "spec_items": before_spec_items,
                }
            )
        cur.execute(
            """
            INSERT INTO itma_asset_details (
                asset_id, hostname, ip_address, os_version, cpu_spec, mem_spec, hdd_spec, nw_port,
                equipment_status, setting_change, config_change, firmware_change,
                vendor_name, network_type, maintenance_period, maintenance_start_date, maintenance_months, maintenance_end_date,
                vendor_contact, vendor_phone, vendor_mail, pre_auth_type, auth_completion_status, auth_number, auth_date, crypto_verification_number,
                equipment_status_date, used_user, used_group, purchase_datetime, delivery_month, durability_years,
                updated_at, updated_by, user_position, mac_address, serial_number
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            ON CONFLICT (asset_id) DO UPDATE
            SET hostname = EXCLUDED.hostname,
                ip_address = EXCLUDED.ip_address,
                os_version = EXCLUDED.os_version,
                cpu_spec = EXCLUDED.cpu_spec,
                mem_spec = EXCLUDED.mem_spec,
                hdd_spec = EXCLUDED.hdd_spec,
                nw_port = EXCLUDED.nw_port,
                equipment_status = EXCLUDED.equipment_status,
                setting_change = EXCLUDED.setting_change,
                config_change = EXCLUDED.config_change,
                firmware_change = EXCLUDED.firmware_change,
                vendor_name = EXCLUDED.vendor_name,
                network_type = EXCLUDED.network_type,
                maintenance_period = EXCLUDED.maintenance_period,
                maintenance_start_date = EXCLUDED.maintenance_start_date,
                maintenance_months = EXCLUDED.maintenance_months,
                maintenance_end_date = EXCLUDED.maintenance_end_date,
                vendor_contact = EXCLUDED.vendor_contact,
                vendor_phone = EXCLUDED.vendor_phone,
                vendor_mail = EXCLUDED.vendor_mail,
                pre_auth_type = EXCLUDED.pre_auth_type,
                auth_completion_status = EXCLUDED.auth_completion_status,
                auth_number = EXCLUDED.auth_number,
                auth_date = EXCLUDED.auth_date,
                crypto_verification_number = EXCLUDED.crypto_verification_number,
                equipment_status_date = EXCLUDED.equipment_status_date,
                used_user = EXCLUDED.used_user,
                used_group = EXCLUDED.used_group,
                purchase_datetime = EXCLUDED.purchase_datetime,
                delivery_month = EXCLUDED.delivery_month,
                durability_years = EXCLUDED.durability_years,
                updated_at = EXCLUDED.updated_at,
                updated_by = EXCLUDED.updated_by,
                user_position = EXCLUDED.user_position,
                mac_address = EXCLUDED.mac_address,
                serial_number = EXCLUDED.serial_number
            RETURNING hostname, ip_address, os_version, cpu_spec, mem_spec, hdd_spec, nw_port,
                      equipment_status, setting_change, config_change, firmware_change,
                      vendor_name, maintenance_period, maintenance_start_date, maintenance_months, maintenance_end_date,
                      vendor_contact, vendor_phone, vendor_mail, pre_auth_type, auth_completion_status, auth_number, auth_date, crypto_verification_number,
                      equipment_status_date, used_user, used_group, purchase_datetime, delivery_month, durability_years,
                      updated_at, updated_by, network_type, user_position, mac_address, serial_number
            """,
            (
                asset_id,
                payload["hostname"],
                payload["ip_address"],
                payload["os_version"],
                payload["cpu_spec"],
                payload["mem_spec"],
                payload["hdd_spec"],
                payload["nw_port"],
                payload["equipment_status"],
                payload["setting_change"],
                payload["config_change"],
                payload["firmware_change"],
                payload["vendor_name"],
                payload["network_type"],
                payload["maintenance_period"],
                payload["maintenance_start_date"],
                payload["maintenance_months"],
                payload["maintenance_end_date"],
                payload["vendor_contact"],
                payload["vendor_phone"],
                payload["vendor_mail"],
                payload["pre_auth_type"],
                payload["auth_completion_status"],
                payload["auth_number"],
                payload["auth_date"],
                payload["crypto_verification_number"],
                payload["equipment_status_date"],
                payload["used_user"],
                payload["used_group"],
                payload["purchase_datetime"],
                payload["delivery_month"],
                payload["durability_years"],
                now_ts,
                actor_name,
                payload["user_position"],
                payload["mac_address"],
                payload["serial_number"],
            ),
        )
        row = cur.fetchone()
        if detail_scope in {"", "pc", "other", "software", "license"}:
            cur.execute("DELETE FROM itma_asset_detail_changes WHERE asset_id = %s", (asset_id,))
            for detail_change in payload.get("detail_changes", []):
                cur.execute(
                    """
                    INSERT INTO itma_asset_detail_changes (asset_id, change_date, change_type, change_note, created_by)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        asset_id,
                        detail_change.get("change_date"),
                        detail_change.get("change_type"),
                        detail_change.get("change_note"),
                        actor_name,
                    ),
                )
            cur.execute("DELETE FROM itma_asset_equipment_changes WHERE asset_id = %s", (asset_id,))
            for equipment_change in payload.get("equipment_changes", []):
                cur.execute(
                    """
                    INSERT INTO itma_asset_equipment_changes (asset_id, status_date, equipment_status, created_by)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (
                        asset_id,
                        equipment_change.get("status_date"),
                        equipment_change.get("equipment_status"),
                        actor_name,
                    ),
                )
            cur.execute("DELETE FROM itma_asset_delivery_changes WHERE asset_id = %s", (asset_id,))
            for delivery_change in payload.get("delivery_changes", []):
                cur.execute(
                    """
                    INSERT INTO itma_asset_delivery_changes (
                        asset_id, change_date, vendor_name, maintenance_start_date, maintenance_months, maintenance_end_date,
                        vendor_contact, vendor_phone, vendor_mail, change_note, created_by
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        asset_id,
                        delivery_change.get("change_date"),
                        delivery_change.get("vendor_name"),
                        delivery_change.get("maintenance_start_date"),
                        delivery_change.get("maintenance_months"),
                        delivery_change.get("maintenance_end_date"),
                        delivery_change.get("vendor_contact"),
                        delivery_change.get("vendor_phone"),
                        delivery_change.get("vendor_mail"),
                        delivery_change.get("change_note"),
                        actor_name,
                    ),
                )
        if detail_scope in {"", "other"}:
            cur.execute("DELETE FROM itma_asset_security_changes WHERE asset_id = %s", (asset_id,))
            for security_change in payload.get("security_changes", []):
                cur.execute(
                    """
                    INSERT INTO itma_asset_security_changes (
                        asset_id, change_date, pre_auth_type, auth_completion_status, auth_number, auth_date, crypto_verification_number, created_by
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        asset_id,
                        security_change.get("change_date"),
                        security_change.get("pre_auth_type"),
                        security_change.get("auth_completion_status"),
                        security_change.get("auth_number"),
                        security_change.get("auth_date"),
                        security_change.get("crypto_verification_number"),
                        actor_name,
                    ),
                )
        if detail_scope in {"", "software"}:
            cur.execute("DELETE FROM itma_asset_software_items WHERE asset_id = %s", (asset_id,))
            for software_item in payload.get("software_items", []):
                cur.execute(
                    """
                    INSERT INTO itma_asset_software_items (
                        asset_id, software_name, version, install_date, expiry_date, installed_quantity, deployment_target, network_type, status, change_note, created_by
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        asset_id,
                        software_item.get("software_name"),
                        software_item.get("version"),
                        software_item.get("install_date"),
                        software_item.get("expiry_date"),
                        software_item.get("installed_quantity"),
                        software_item.get("deployment_target"),
                        software_item.get("network_type") or software_item.get("deployment_target"),
                        software_item.get("status"),
                        software_item.get("change_note"),
                        actor_name,
                    ),
                )
        if detail_scope in {"", "license"}:
            cur.execute("DELETE FROM itma_asset_license_items WHERE asset_id = %s", (asset_id,))
            for license_item in payload.get("license_items", []):
                cur.execute(
                    """
                    INSERT INTO itma_asset_license_items (
                        asset_id, license_name, version, install_date, license_quantity, expiry_date, network_type, compliance_status, change_note, created_by
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        asset_id,
                        license_item.get("license_name"),
                        license_item.get("version"),
                        license_item.get("install_date"),
                        license_item.get("license_quantity"),
                        license_item.get("expiry_date"),
                        license_item.get("network_type") or license_item.get("vendor_name"),
                        license_item.get("compliance_status"),
                        license_item.get("change_note"),
                        actor_name,
                    ),
                )
        if _supports_dynamic_spec_forms(asset_row[2] or ""):
            cur.execute("DELETE FROM itma_asset_spec_items WHERE asset_id = %s", (asset_id,))
            for spec_item in payload.get("spec_items", []):
                source_form_item_id = spec_item.get("source_form_item_id")
                if source_form_item_id not in (None, ""):
                    try:
                        source_form_item_id = int(source_form_item_id)
                    except (TypeError, ValueError):
                        return jsonify({"success": False, "message": "스펙 항목 연결 정보가 올바르지 않습니다."}), 400
                    cur.execute(
                        """
                        SELECT sfi.spec_label
                        FROM itma_spec_form_items sfi
                        JOIN itma_spec_forms sf ON sf.id = sfi.form_id
                        WHERE sfi.id = %s AND sf.category_key = %s
                        """,
                        (source_form_item_id, _normalize_category_key(asset_row[2])),
                    )
                    source_row = cur.fetchone()
                    if not source_row:
                        return jsonify({"success": False, "message": "현재 카테고리의 스펙 항목만 연결할 수 있습니다."}), 400
                    spec_item["label"] = source_row[0]
                cur.execute(
                    """
                    INSERT INTO itma_asset_spec_items (
                        asset_id, spec_label, spec_value, display_order, source_form_item_id, updated_at, updated_by
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        asset_id,
                        spec_item.get("label"),
                        spec_item.get("value"),
                        spec_item.get("display_order", 0),
                        source_form_item_id,
                        now_ts,
                        actor_name,
                    ),
                )

        mapped_usage_status = _latest_usage_from_equipment_changes(payload.get("equipment_changes", []))
        if mapped_usage_status != before_usage_status:
            cur.execute(
                """
                UPDATE itma_assets
                SET usage_status = %s, updated_at = %s, updated_by = %s
                WHERE id = %s
                """,
                (mapped_usage_status, now_ts, actor_name, asset_id),
            )
            _insert_history(
                cur,
                asset_id=asset_id,
                action="update",
                actor=actor_name,
                changed_column="usage_status",
                before_value=before_usage_status,
                after_value=mapped_usage_status,
            )
        after_detail_summary = _asset_detail_history_summary(payload)
        if before_detail_summary != after_detail_summary:
            _insert_history(
                cur,
                asset_id=asset_id,
                action="update",
                actor=actor_name,
                changed_column="asset_details",
                before_value=json.dumps(before_detail_summary, ensure_ascii=False) if before_detail_summary else "",
                after_value=json.dumps(after_detail_summary, ensure_ascii=False),
            )
        conn.commit()
        details = _asset_details_row_to_item(
            row,
            detail_changes=[
                {
                    "change_date": dc.get("change_date").strftime("%Y-%m-%d") if dc.get("change_date") else "",
                    "change_type": dc.get("change_type") or "",
                    "change_note": dc.get("change_note") or "",
                }
                for dc in payload.get("detail_changes", [])
            ],
            equipment_changes=[
                {
                    "status_date": ec.get("status_date").strftime("%Y-%m-%d") if ec.get("status_date") else "",
                    "equipment_status": ec.get("equipment_status") or "",
                }
                for ec in payload.get("equipment_changes", [])
            ],
            security_changes=[
                {
                    "change_date": sc.get("change_date").strftime("%Y-%m-%d") if sc.get("change_date") else "",
                    "pre_auth_type": sc.get("pre_auth_type") or "",
                    "auth_completion_status": sc.get("auth_completion_status") or "",
                    "auth_number": sc.get("auth_number") or "",
                    "auth_date": sc.get("auth_date").strftime("%Y-%m-%d") if sc.get("auth_date") else "",
                    "crypto_verification_number": sc.get("crypto_verification_number") or "",
                }
                for sc in payload.get("security_changes", [])
            ],
            delivery_changes=[
                {
                    "change_date": dc.get("change_date").strftime("%Y-%m-%d") if dc.get("change_date") else "",
                    "vendor_name": dc.get("vendor_name") or "",
                    "maintenance_start_date": dc.get("maintenance_start_date").strftime("%Y-%m-%d") if dc.get("maintenance_start_date") else "",
                    "maintenance_months": str(dc.get("maintenance_months")) if dc.get("maintenance_months") is not None else "",
                    "maintenance_end_date": dc.get("maintenance_end_date").strftime("%Y-%m-%d") if dc.get("maintenance_end_date") else "",
                    "vendor_contact": dc.get("vendor_contact") or "",
                    "vendor_phone": dc.get("vendor_phone") or "",
                    "vendor_mail": dc.get("vendor_mail") or "",
                    "change_note": dc.get("change_note") or "",
                }
                for dc in payload.get("delivery_changes", [])
            ],
            software_items=[
                {
                    "software_name": si.get("software_name") or "",
                    "version": si.get("version") or "",
                    "install_date": si.get("install_date").strftime("%Y-%m-%d") if si.get("install_date") else "",
                    "expiry_date": si.get("expiry_date").strftime("%Y-%m-%d") if si.get("expiry_date") else "",
                    "installed_quantity": str(si.get("installed_quantity")) if si.get("installed_quantity") is not None else "",
                    "quantity": str(si.get("installed_quantity")) if si.get("installed_quantity") is not None else "",
                    "deployment_target": si.get("deployment_target") or "",
                    "network_type": si.get("network_type") or si.get("deployment_target") or "",
                    "status": si.get("status") or "",
                    "change_note": si.get("change_note") or "",
                    "note": si.get("change_note") or "",
                }
                for si in payload.get("software_items", [])
            ],
            license_items=[
                {
                    "license_name": li.get("license_name") or "",
                    "version": li.get("version") or "",
                    "install_date": li.get("install_date").strftime("%Y-%m-%d") if li.get("install_date") else "",
                    "license_quantity": str(li.get("license_quantity")) if li.get("license_quantity") is not None else "",
                    "quantity": str(li.get("license_quantity")) if li.get("license_quantity") is not None else "",
                    "vendor_name": li.get("vendor_name") or li.get("network_type") or "",
                    "expiry_date": li.get("expiry_date").strftime("%Y-%m-%d") if li.get("expiry_date") else "",
                    "network_type": li.get("network_type") or li.get("vendor_name") or "",
                    "compliance_status": li.get("compliance_status") or "",
                    "change_note": li.get("change_note") or "",
                    "note": li.get("change_note") or "",
                }
                for li in payload.get("license_items", [])
            ],
            spec_items=[
                {
                    "label": si.get("label") or "",
                    "value": si.get("value") or "",
                    "display_order": int(si.get("display_order") or 0),
                    "source_form_item_id": si.get("source_form_item_id"),
                }
                for si in payload.get("spec_items", [])
            ] if _supports_dynamic_spec_forms(asset_row[2] or "") else _legacy_spec_items_from_payload(payload),
        )
        log_audit(user_id, "update", resource="ITMA", details=f"자산 상세정보 수정: asset_id={asset_id}")
        return jsonify({"success": True, "details": details})
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/spec-forms", methods=["GET"])
def get_spec_forms():
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions

    category_key = _normalize_category_key(request.args.get("category"))
    if not _supports_dynamic_spec_forms(category_key):
        return jsonify({"success": True, "forms": []})

    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT id, category_key, form_name, description, is_active, created_by, created_at, updated_at
            FROM itma_spec_forms
            WHERE category_key = %s
              AND is_active = TRUE
            ORDER BY form_name ASC, id ASC
            """,
            (category_key,),
        )
        return jsonify(
            {
                "success": True,
                "forms": [_serialize_spec_form_row(cur, row) for row in cur.fetchall()],
            }
        )
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/spec-forms/<int:form_id>", methods=["GET"])
def get_spec_form(form_id):
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions

    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT id, category_key, form_name, description, is_active, created_by, created_at, updated_at
            FROM itma_spec_forms
            WHERE id = %s
            """,
            (form_id,),
        )
        row = cur.fetchone()
        if not row:
            return jsonify({"success": False, "message": "대상 스펙 폼을 찾을 수 없습니다."}), 404
        return jsonify({"success": True, "form": _serialize_spec_form_row(cur, row)})
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/spec-forms", methods=["POST"])
def save_spec_form():
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    if not (permissions.get("can_edit_all") or (permissions.get("edit_categories") or [])):
        return jsonify({"success": False, "message": "스펙 폼 저장 권한이 없습니다."}), 403

    payload = request.get_json() or {}
    form_id = payload.get("id")
    category_key = _normalize_category_key(payload.get("category_key"))
    form_name = (_clean_text(payload.get("form_name")) or "").strip()
    description = (_clean_text(payload.get("description")) or "").strip()
    spec_items = _normalize_spec_items(payload.get("items"))

    if not _supports_dynamic_spec_forms(category_key):
        return jsonify({"success": False, "message": "해당 카테고리에서는 스펙 폼을 사용할 수 없습니다."}), 400
    if not form_name:
        return jsonify({"success": False, "message": "폼 이름을 입력해주세요."}), 400
    if not spec_items:
        return jsonify({"success": False, "message": "최소 1개의 스펙 항목을 입력해주세요."}), 400

    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT id
            FROM itma_spec_forms
            WHERE category_key = %s
              AND form_name = %s
              AND (%s IS NULL OR id <> %s)
            LIMIT 1
            """,
            (category_key, form_name, form_id, form_id),
        )
        if cur.fetchone():
            return jsonify({"success": False, "message": "같은 카테고리에 동일한 폼 이름이 이미 존재합니다."}), 409
        saved_form_id = None
        if form_id:
            cur.execute(
                """
                UPDATE itma_spec_forms
                SET category_key = %s,
                    form_name = %s,
                    description = %s,
                    updated_at = %s
                WHERE id = %s
                RETURNING id
                """,
                (category_key, form_name, description or None, _to_db_timestamp(_now_local()), form_id),
            )
            row = cur.fetchone()
            if not row:
                conn.rollback()
                return jsonify({"success": False, "message": "대상 스펙 폼을 찾을 수 없습니다."}), 404
            saved_form_id = row[0]
        else:
            cur.execute(
                """
                INSERT INTO itma_spec_forms (category_key, form_name, description, created_by)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (category_key, form_name, description or None, session.get("username")),
            )
            saved_form_id = cur.fetchone()[0]

        cur.execute("SELECT id, show_in_list FROM itma_spec_form_items WHERE form_id = %s", (saved_form_id,))
        existing_item_visibility = {row[0]: row[1] for row in cur.fetchall()}
        existing_item_ids = set(existing_item_visibility)
        submitted_item_ids = set()
        for spec_item in spec_items:
            item_id = spec_item.get("id")
            show_in_list = bool(spec_item.get("show_in_list")) if session.get("role") == "admin" else False
            if item_id not in (None, ""):
                try:
                    item_id = int(item_id)
                except (TypeError, ValueError):
                    return jsonify({"success": False, "message": "스펙 항목 정보가 올바르지 않습니다."}), 400
                if item_id not in existing_item_ids:
                    return jsonify({"success": False, "message": "다른 폼의 스펙 항목은 사용할 수 없습니다."}), 400
                if session.get("role") != "admin":
                    show_in_list = existing_item_visibility[item_id]
                submitted_item_ids.add(item_id)
                cur.execute(
                    """
                    UPDATE itma_spec_form_items
                    SET spec_label = %s, spec_value = %s, display_order = %s, show_in_list = %s
                    WHERE id = %s AND form_id = %s
                    """,
                    (spec_item["label"], spec_item["value"], spec_item["display_order"], show_in_list, item_id, saved_form_id),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO itma_spec_form_items (form_id, spec_label, spec_value, display_order, show_in_list)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (saved_form_id, spec_item["label"], spec_item["value"], spec_item["display_order"], show_in_list),
                )
        removed_item_ids = existing_item_ids - submitted_item_ids
        removed_value_count = 0
        if removed_item_ids:
            # 빠진 항목에 입력된 자산 값도 DB에서 함께 삭제
            removed_value_count = _delete_spec_values_for_form_items(cur, removed_item_ids)
            cur.execute("DELETE FROM itma_spec_form_items WHERE id = ANY(%s)", (list(removed_item_ids),))
        conn.commit()
        audit_detail = f"스펙 폼 저장: {form_name} ({category_key})"
        if removed_item_ids:
            audit_detail += f", 항목 {len(removed_item_ids)}개 삭제(자산 값 {removed_value_count}건 함께 삭제)"
        log_audit(session.get("username"), "update", resource="ITMA", details=audit_detail)
        cur.execute(
            """
            SELECT id, category_key, form_name, description, is_active, created_by, created_at, updated_at
            FROM itma_spec_forms
            WHERE id = %s
            """,
            (saved_form_id,),
        )
        message = "스펙 폼이 저장되었습니다."
        if removed_value_count:
            message += f" (삭제한 항목의 자산 값 {removed_value_count}건 함께 삭제)"
        return jsonify({"success": True, "message": message, "form": _serialize_spec_form_row(cur, cur.fetchone())})
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/spec-forms/<int:form_id>", methods=["DELETE"])
def delete_spec_form(form_id):
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    if not (permissions.get("can_edit_all") or (permissions.get("edit_categories") or [])):
        return jsonify({"success": False, "message": "스펙 폼 삭제 권한이 없습니다."}), 403

    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT form_name, category_key FROM itma_spec_forms WHERE id = %s", (form_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({"success": False, "message": "대상 스펙 폼을 찾을 수 없습니다."}), 404
        # 폼 항목에 입력된 자산 값도 DB에서 함께 삭제 (외래키는 연결만 끊으므로 먼저 삭제)
        cur.execute("SELECT id FROM itma_spec_form_items WHERE form_id = %s", (form_id,))
        removed_value_count = _delete_spec_values_for_form_items(cur, [item_row[0] for item_row in cur.fetchall()])
        cur.execute("DELETE FROM itma_spec_forms WHERE id = %s", (form_id,))
        conn.commit()
        log_audit(
            session.get("username"),
            "delete",
            resource="ITMA",
            details=f"스펙 폼 삭제: {row[0]} ({row[1]}), 자산 값 {removed_value_count}건 함께 삭제",
        )
        message = "스펙 폼이 삭제되었습니다."
        if removed_value_count:
            message += f" (입력된 자산 값 {removed_value_count}건 함께 삭제)"
        return jsonify({"success": True, "message": message, "removed_value_count": removed_value_count})
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/assets/template-download", methods=["GET"])
def download_template():
    """일괄등록 양식: 기본 형식 26개 고정 (기본 정보 17 / 장비 정보 6 / 장비 상세 3) — 상세 스펙·사용자 정의 컬럼 없음"""
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions

    from openpyxl import Workbook
    from openpyxl.comments import Comment
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    group_fills = ITMA_EXCEL_GROUP_FILLS
    auto_fill = ITMA_EXCEL_AUTO_FILL
    thin = Side(style="thin", color="9CA3AF")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    guides = {
        "row_no": ("자동 입력 (비워두세요)", ""),
        "category": ("카테고리 이름", "PC"),
        "site": ("예: 대전, 연구소, 구미", "대전"),
        "asset_id": ("중복 불가, 빈칸 허용", "PC-2026-001"),
        "manufacturer": ("", "DELL"),
        "item_name": ("", "OptiPlex 7010"),
        "received_date": ("날짜 (YYYY-MM-DD)", "2026-01-01"),
        "inbound_note": ("", "신규 구매"),
        "released_date": ("날짜 (YYYY-MM-DD)", ""),
        "outbound_note": ("", ""),
        "storage_location": ("", "본관 3층 자산실"),
        "detail_note": ("", ""),
        "sales_rep": ("", "홍길동"),
        "usage_status": ("정상/사용/미사용/교체/폐기 중 선택", "사용"),
        "manufacture_month": ("년월 (YYYY-MM)", "2025-12"),
        "updated_at": ("자동 입력 (비워두세요)", ""),
        "updated_by": ("자동 입력 (비워두세요)", ""),
        "used_group": ("", "총무팀"),
        "used_user": ("", "김사용"),
        "user_position": ("", "대리"),
        "network_type": ("", "업무망"),
        "ip_address": ("", "10.0.0.10/24"),
        "mac_address": ("", "00-11-22-33-44-55"),
        "hostname": ("", "PC-GA-001"),
        "os_version": ("", "Windows 11"),
        "serial_number": ("중복 불가, 빈칸 허용", "SN-EXAMPLE-0001"),
    }

    wb = Workbook()
    ws = wb.active
    ws.title = "ITMA_템플릿"
    for col_idx, (key, label, group, kind) in enumerate(ITMA_UPLOAD_TEMPLATE_COLUMNS, start=1):
        header = ws.cell(row=1, column=col_idx, value=label)
        header.font = Font(bold=True, color="6B7280" if kind == "auto" else "111827")
        header.fill = PatternFill("solid", fgColor=auto_fill if kind == "auto" else group_fills[group])
        header.alignment = Alignment(horizontal="center", vertical="center")
        header.border = border
        note = guides.get(key, ("", ""))[0]
        header.comment = Comment(f"[{group}] {note}".strip(), "ITMA")
        ws.column_dimensions[header.column_letter].width = max(12, len(label) * 2 + 4)
    ws.freeze_panes = "A2"

    guide_ws = wb.create_sheet("작성 안내")
    guide_ws.append(["구분", "컬럼", "입력 안내", "예시"])
    for key, label, group, kind in ITMA_UPLOAD_TEMPLATE_COLUMNS:
        note, example = guides.get(key, ("", ""))
        guide_ws.append([group, label, note or "자유 입력, 빈칸 허용", example])
    guide_ws.append([])
    guide_ws.append(["안내", "", "첫 번째 시트(ITMA_템플릿)의 2행부터 입력합니다. 모든 항목은 빈칸이어도 등록됩니다.", ""])
    guide_ws.append(["안내", "", "자산번호 또는 Serial Number가 기존 자산이나 같은 파일 안의 값과 겹치면 그 행은 등록되지 않습니다.", ""])
    for cell_obj in guide_ws[1]:
        cell_obj.font = Font(bold=True)
        cell_obj.fill = PatternFill("solid", fgColor="E5E7EB")
    for letter, width in (("A", 12), ("B", 16), ("C", 60), ("D", 22)):
        guide_ws.column_dimensions[letter].width = width

    output = BytesIO()
    wb.save(output)
    output.seek(0)

    return send_file(
        output,
        as_attachment=True,
        download_name="ITMA_sample_template.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )

@itma_bp.route("/assets/download", methods=["GET"])
def download_all_assets():
    """모든 항목(권한 범위 전체 자산) 다운로드 — 사용자 지정 항목(columns) 또는 기본 항목"""
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    return _send_assets_excel(permissions, None, "ITMA_자산목록", "ITMA_assets_all.xlsx", "전체")


@itma_bp.route("/assets/download-selected", methods=["GET"])
def download_selected_assets():
    """선택 항목(체크한 자산) 다운로드 — 사용자 지정 항목(columns) 또는 기본 항목"""
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions

    ids_raw = (request.args.get("ids") or "").strip()
    if not ids_raw:
        return jsonify({"success": False, "message": "선택된 항목이 없습니다."}), 400
    try:
        ids = [int(token) for token in ids_raw.split(",") if token.strip()]
    except ValueError:
        return jsonify({"success": False, "message": "선택값 형식이 올바르지 않습니다."}), 400
    if not ids:
        return jsonify({"success": False, "message": "선택된 항목이 없습니다."}), 400
    return _send_assets_excel(permissions, ids, "ITMA_선택목록", "ITMA_assets_selected.xlsx", "선택")


@itma_bp.route("/assets/new-row", methods=["POST"])
def create_new_row():
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    if not permissions.get("can_edit_all") and not permissions.get("edit_categories"):
        return jsonify({"success": False, "message": "행 추가 권한이 없습니다."}), 403

    user_id = session.get("username")
    actor_name = _get_itma_actor_name()
    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        now_ts = _to_db_timestamp(_now_local())
        asset_code = _next_asset_code(cur, "ITMA")
        cur.execute(
            """
            INSERT INTO itma_assets (asset_code, usage_status, input_at, updated_at, uploaded_by, updated_by)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, category, manufacturer, item_name, serial_number, received_date,
                   inbound_note, released_date, outbound_note, storage_location,
                   detail_note, sales_rep, usage_status, manufacture_month, input_at, updated_at, updated_by, asset_id, asset_code
            """,
            (asset_code, "", now_ts, now_ts, actor_name, actor_name),
        )
        row = cur.fetchone()
        conn.commit()

        log_audit(user_id, "create", resource="ITMA", details=f"신규 자산 생성: id={row[0]}")
        return jsonify(
            {
                "success": True,
                "item": {
                    "id": row[0],
                    "category": row[1] or "",
                    "manufacturer": row[2] or "",
                    "item_name": row[3] or "",
                    "serial_number": row[4] or "",
                    "received_date": row[5].strftime("%Y-%m-%d") if row[5] else "",
                    "inbound_note": row[6] or "",
                    "released_date": row[7].strftime("%Y-%m-%d") if row[7] else "",
                    "outbound_note": row[8] or "",
                    "storage_location": row[9] or "",
                    "detail_note": row[10] or "",
                    "sales_rep": row[11] or "",
                    "usage_status": row[12] or "",
                    "manufacture_month": row[13].strftime("%Y-%m") if row[13] else "",
                    "input_at": row[14].strftime("%Y-%m-%d %H:%M:%S") if row[14] else "",
                    "updated_at": row[15].strftime("%Y-%m-%d %H:%M:%S") if row[15] else "",
                    "updated_by": row[16] or "",
                    "asset_id": row[17] or "",
                    "asset_code": row[18] or "",
                },
            }
        )
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/assets/batch-update", methods=["POST"])
def batch_update_assets():
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    if not permissions.get("can_edit_all") and not permissions.get("edit_categories"):
        return jsonify({"success": False, "message": "일괄 수정 권한이 없습니다."}), 403

    data = request.get_json() or {}
    ids = data.get("ids") or []
    updates = data.get("updates") or {}
    column = (data.get("column") or "").strip()
    value = data.get("value")

    if isinstance(updates, dict):
        normalized_updates = {str(k).strip(): v for k, v in updates.items() if str(k).strip()}
    else:
        normalized_updates = {}

    # Backward compatibility for old single-column payload
    if not normalized_updates and column:
        normalized_updates = {column: value}

    try:
        parsed_ids = sorted(set(int(x) for x in ids))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "유효하지 않은 자산번호 형식입니다."}), 400

    allowed_columns = {
        "category",
        "item_name",
        "manufacturer",
        "serial_number",
        "received_date",
        "inbound_note",
        "released_date",
        "outbound_note",
        "storage_location",
        "detail_note",
        "sales_rep",
        "usage_status",
        "manufacture_month",
        "asset_id",
        "site",
    }

    if not parsed_ids:
        return jsonify({"success": False, "message": "수정할 자산이 없습니다."}), 400

    update_columns = [col for col in normalized_updates.keys() if col in allowed_columns]
    if not update_columns:
        return jsonify({"success": False, "message": "업데이트할 필드가 없습니다."}), 400

    parsed_updates = {col: _parse_value_by_column(col, normalized_updates.get(col)) for col in update_columns}

    # Policy: non-input should keep existing values. Empty string payload is treated as "not provided".
    parsed_updates = {k: v for k, v in parsed_updates.items() if v is not None and not (isinstance(v, str) and v.strip() == "")}
    if not parsed_updates:
        return jsonify({"success": False, "message": "업데이트 형식이 올바르지 않습니다."}), 400

    user_id = session.get("username")
    actor_name = _get_itma_actor_name()
    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        placeholders = ",".join(["%s"] * len(parsed_ids))
        cur.execute(
            f"""
            SELECT id, category, manufacturer, item_name, serial_number, received_date,
                   inbound_note, released_date, outbound_note, storage_location,
                   detail_note, sales_rep, usage_status, manufacture_month, input_at, updated_at, updated_by, asset_id, asset_code
            FROM itma_assets
            WHERE id IN ({placeholders})
            """,
            tuple(parsed_ids),
        )
        rows = cur.fetchall()
        if not rows:
            conn.rollback()
            return jsonify({"success": False, "message": "수정할 자산이 없습니다."}), 404

        items_by_id = {int(row[0]): _attach_site(cur, _asset_row_to_item(row)) for row in rows}
        editable_ids = {
            int(row[0])
            for row in rows
            if _can_edit_category(permissions, row[1] or "")
        }
        if not editable_ids:
            conn.rollback()
            return jsonify({"success": False, "message": "수정 가능한 자산이 없습니다."}), 403
        now_ts = _to_db_timestamp(_now_local())
        updated_count = 0

        if "asset_id" in parsed_updates:
            target_asset_id = parsed_updates.get("asset_id")
            if target_asset_id:
                cur.execute(
                    """
                    SELECT id
                    FROM itma_assets
                    WHERE id <> ALL(%s)
                      AND asset_id = %s
                    LIMIT 1
                    """,
                    (parsed_ids, target_asset_id),
                )
                if cur.fetchone():
                    conn.rollback()
                    return jsonify({"success": False, "message": "Duplicate asset_id already exists."}), 400
                if len(parsed_ids) > 1:
                    conn.rollback()
                    return jsonify({"success": False, "message": "asset_id can be updated for only one asset at a time."}), 400

        if "serial_number" in parsed_updates:
            serial_value = parsed_updates.get("serial_number")
            serial_key = _normalize_serial(serial_value)
            if serial_key:
                cur.execute(
                    """
                    SELECT id
                    FROM itma_assets
                    WHERE id <> ALL(%s)
                      AND serial_number IS NOT NULL
                      AND serial_number <> ''
                      AND regexp_replace(upper(serial_number), '[[:space:]_-]+', '', 'g') = %s
                    LIMIT 1
                    """,
                    (parsed_ids, serial_key),
                )
                if cur.fetchone():
                    conn.rollback()
                    return jsonify({"success": False, "message": "중복된 시리얼번호가 존재합니다."}), 400
                if len(parsed_ids) > 1:
                    conn.rollback()
                    return jsonify({"success": False, "message": "시리얼번호 변경 시 중복되는 자산이 존재합니다."}), 400

        for asset_id in parsed_ids:
            if asset_id not in editable_ids:
                continue
            item = items_by_id.get(asset_id)
            if not item:
                continue

            changed_columns = []
            changed_values = []
            history_changes = []

            for col, new_value in parsed_updates.items():
                old_value = item.get(col)
                old_norm = "" if old_value is None else str(old_value)
                new_norm = "" if new_value is None else str(new_value)
                if old_norm == new_norm:
                    continue
                changed_columns.append(f"{col} = %s")
                changed_values.append(new_value)
                history_changes.append((col, old_value, new_value))

            if not changed_columns:
                continue

            changed_columns.extend(["updated_at = %s", "updated_by = %s"])
            changed_values.extend([now_ts, actor_name, asset_id])

            cur.execute(
                f"""
                UPDATE itma_assets
                SET {', '.join(changed_columns)}
                WHERE id = %s
                RETURNING id, category, manufacturer, item_name, serial_number, received_date,
                          inbound_note, released_date, outbound_note, storage_location,
                          detail_note, sales_rep, usage_status, manufacture_month, input_at, updated_at, updated_by, asset_id, asset_code
                """,
                tuple(changed_values),
            )
            updated_row = cur.fetchone()
            if not updated_row:
                continue
            updated_item = _attach_site(cur, _asset_row_to_item(updated_row))

            for col, old_value, _new_value in history_changes:
                _insert_history(
                    cur,
                    asset_id=asset_id,
                    action="update",
                    actor=actor_name,
                    changed_column=col,
                    before_value=old_value,
                    after_value=updated_item.get(col),
                    snapshot=updated_item,
                )
            updated_count += 1

        conn.commit()
        log_audit(
            user_id,
            "update",
            resource="ITMA",
            details=f"일괄 수정 자산 수: {updated_count}, 필드={','.join(parsed_updates.keys())}",
        )
        return jsonify({"success": True, "updated_count": updated_count})
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/assets/delete", methods=["POST"])
def delete_assets():
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    if not permissions.get("can_edit_all") and not permissions.get("edit_categories"):
        return jsonify({"success": False, "message": "삭제 권한이 없습니다."}), 403

    data = request.get_json() or {}
    ids = data.get("ids") or []
    try:
        parsed_ids = sorted(set(int(x) for x in ids))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "유효하지 않은 자산번호 입니다."}), 400

    if not parsed_ids:
        return jsonify({"success": False, "message": "삭제할 자산이 없습니다."}), 400

    user_id = session.get("username")
    actor_name = _get_itma_actor_name()
    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        placeholders = ",".join(["%s"] * len(parsed_ids))
        cur.execute(
            f"""
            SELECT id, category, manufacturer, item_name, serial_number, received_date,
                   inbound_note, released_date, outbound_note, storage_location,
                   detail_note, sales_rep, usage_status, manufacture_month, input_at, updated_at, updated_by, asset_id, asset_code
            FROM itma_assets
            WHERE id IN ({placeholders})
            """,
            tuple(parsed_ids),
        )
        rows_to_delete = cur.fetchall()
        if not rows_to_delete:
            conn.rollback()
            return jsonify({"success": False, "message": "삭제할 자산이 없습니다."}), 404

        deletable_rows = [row for row in rows_to_delete if _can_edit_category(permissions, row[1] or "")]
        if not deletable_rows:
            conn.rollback()
            return jsonify({"success": False, "message": "삭제 가능한 자산이 없습니다."}), 403

        for row in deletable_rows:
            item = _attach_site(cur, _asset_row_to_item(row))
            _insert_history(
                cur,
                asset_id=item["id"],
                action="delete",
                actor=actor_name,
                snapshot=item,
            )

        delete_ids = [int(row[0]) for row in deletable_rows]
        delete_placeholders = ",".join(["%s"] * len(delete_ids))
        cur.execute(f"DELETE FROM itma_assets WHERE id IN ({delete_placeholders})", tuple(delete_ids))
        deleted_count = cur.rowcount or 0
        conn.commit()

        log_audit(user_id, "delete", resource="ITMA", details=f"선택된 자산 삭제 {deleted_count}건")
        return jsonify({"success": True, "deleted_count": deleted_count})
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/history", methods=["GET"])
def get_history():
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions

    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        limit = request.args.get("limit", default=200, type=int)
        safe_limit = min(max(limit or 200, 1), 1000)
        cur.execute(
            """
            SELECT h.id, h.asset_id, h.action, h.changed_column, h.before_value, h.after_value,
                   h.snapshot_data, h.restored_from_history_id, h.restored, h.restored_at, h.restored_by,
                   h.actor, h.created_at, a.asset_code
            FROM itma_asset_history h
            LEFT JOIN itma_assets a ON a.id = h.asset_id
            ORDER BY h.created_at DESC, h.id DESC
            LIMIT %s
            """,
            (safe_limit,),
        )
        rows = cur.fetchall()
        items = []
        for row in rows:
            snapshot = None
            if row[6]:
                try:
                    snapshot = json.loads(row[6])
                except Exception:
                    snapshot = None
            items.append(
                {
                    "id": row[0],
                    "asset_id": row[1],
                    "action": row[2] or "",
                    "changed_column": row[3] or "",
                    "before_value": row[4] if row[4] is not None else "",
                    "after_value": row[5] if row[5] is not None else "",
                    "snapshot": snapshot,
                    "restored_from_history_id": row[7],
                    "restored": bool(row[8]),
                    "restored_at": row[9].strftime("%Y-%m-%d %H:%M:%S") if row[9] else "",
                    "restored_by": row[10] or "",
                    "actor": row[11] or "",
                    "created_at": row[12].strftime("%Y-%m-%d %H:%M:%S") if row[12] else "",
                    # 화면 표시용 자산번호: 현재 자산 → 이력 스냅샷 순으로 사용
                    "asset_code": (row[13] or (snapshot or {}).get("asset_code") or ""),
                }
            )
        return jsonify({"success": True, "items": items})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/history/<int:history_id>/restore", methods=["POST"])
def restore_history(history_id):
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions

    _ensure_itma_table()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT id, asset_id, action, changed_column, before_value, after_value,
                   snapshot_data, restored
            FROM itma_asset_history
            WHERE id = %s
            """,
            (history_id,),
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            return jsonify({"success": False, "message": "복원할 자산이 없습니다."}), 404
        if row[7]:
            conn.rollback()
            return jsonify({"success": False, "message": "복원 대상 자산이 이미 복원되었습니다."}), 400

        source_asset_id = row[1]
        action = row[2] or ""
        changed_column = row[3] or ""
        before_value = row[4]
        snapshot = None
        if row[6]:
            try:
                snapshot = json.loads(row[6])
            except Exception:
                snapshot = None

        now_ts = _to_db_timestamp(_now_local())
        user_id = session.get("username")
        actor_name = _get_itma_actor_name()
        asset_code_changed = False

        if action == "delete":
            if not snapshot:
                conn.rollback()
                return jsonify({"success": False, "message": "복원할 변경 이력이 없습니다."}), 400

            serial_key = _normalize_serial(snapshot.get("serial_number"))
            if serial_key:
                cur.execute(
                    """
                    SELECT id
                    FROM itma_assets
                    WHERE serial_number IS NOT NULL
                      AND serial_number <> ''
                      AND regexp_replace(upper(serial_number), '[[:space:]_-]+', '', 'g') = %s
                    LIMIT 1
                    """,
                    (serial_key,),
                )
                dupe = cur.fetchone()
                if dupe:
                    conn.rollback()
                    return jsonify({"success": False, "message": "중복된 시리얼번호가 존재합니다."}), 400

            # 삭제 전 자산번호(asset_code)·자산ID·최초 입력일을 그대로 되살려
            # 복원 후에도 목록·이력에서 같은 자산번호로 보이도록 한다.
            restore_asset_code = _clean_text(snapshot.get("asset_code"))
            if restore_asset_code:
                cur.execute(
                    "SELECT 1 FROM itma_assets WHERE asset_code = %s LIMIT 1",
                    (restore_asset_code,),
                )
                if cur.fetchone():
                    restore_asset_code = _next_asset_code(cur)
                    asset_code_changed = True
            else:
                restore_asset_code = _next_asset_code(cur)
            restore_input_at = _to_datetime(snapshot.get("input_at")) or _to_db_timestamp(_now_local())
            restore_values = (
                _clean_text(snapshot.get("category")),
                _clean_text(snapshot.get("manufacturer")),
                _clean_text(snapshot.get("item_name")),
                _clean_text(snapshot.get("serial_number")),
                _to_date(snapshot.get("received_date")),
                _clean_text(snapshot.get("inbound_note")),
                _to_date(snapshot.get("released_date")),
                _clean_text(snapshot.get("outbound_note")),
                _clean_text(snapshot.get("storage_location")),
                _clean_text(snapshot.get("detail_note")),
                _clean_text(snapshot.get("sales_rep")),
                _normalize_usage_status(snapshot.get("usage_status")),
                _parse_month_date(snapshot.get("manufacture_month")),
                restore_input_at,
                now_ts,
                actor_name,
                actor_name,
                _clean_text(snapshot.get("asset_id")),
                restore_asset_code,
                _clean_text(snapshot.get("site")),
            )
            returning_columns = """
                RETURNING id, category, manufacturer, item_name, serial_number, received_date,
                          inbound_note, released_date, outbound_note, storage_location,
                          detail_note, sales_rep, usage_status, manufacture_month, input_at, updated_at, updated_by, asset_id, asset_code
            """
            cur.execute(
                """
                INSERT INTO itma_assets (
                    id, category, manufacturer, item_name, serial_number, received_date,
                    inbound_note, released_date, outbound_note, storage_location,
                    detail_note, sales_rep, usage_status, manufacture_month,
                    input_at, updated_at, uploaded_by, updated_by, asset_id, asset_code, site
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                """ + returning_columns,
                (snapshot.get("id"),) + restore_values,
            )
            restored_row = cur.fetchone()
            if not restored_row:
                cur.execute(
                    """
                    INSERT INTO itma_assets (
                        category, manufacturer, item_name, serial_number, received_date,
                        inbound_note, released_date, outbound_note, storage_location,
                        detail_note, sales_rep, usage_status, manufacture_month,
                        input_at, updated_at, uploaded_by, updated_by, asset_id, asset_code, site
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """ + returning_columns,
                    restore_values,
                )
                restored_row = cur.fetchone()
            restored_item = _attach_site(cur, _asset_row_to_item(restored_row))
            restored_asset_id = restored_item["id"]
        else:
            if not changed_column:
                conn.rollback()
                return jsonify({"success": False, "message": "삭제 대상 이력이 없습니다."}), 400

            cur.execute(
                """
                SELECT id, category, manufacturer, item_name, serial_number, received_date,
                       inbound_note, released_date, outbound_note, storage_location,
                       detail_note, sales_rep, usage_status, manufacture_month, input_at, updated_at, updated_by, asset_id, asset_code
                FROM itma_assets
                WHERE id = %s
                """,
                (source_asset_id,),
            )
            current_row = cur.fetchone()
            if not current_row:
                conn.rollback()
                return jsonify({"success": False, "message": "대상 자산을 찾을 수 없습니다."}), 404

            parsed_old = _parse_value_by_column(changed_column, before_value)
            if changed_column == "serial_number":
                serial_key = _normalize_serial(parsed_old)
                if serial_key:
                    cur.execute(
                        """
                        SELECT id
                        FROM itma_assets
                        WHERE id <> %s
                          AND serial_number IS NOT NULL
                          AND serial_number <> ''
                          AND regexp_replace(upper(serial_number), '[[:space:]_-]+', '', 'g') = %s
                        LIMIT 1
                        """,
                        (source_asset_id, serial_key),
                    )
                    if cur.fetchone():
                        conn.rollback()
                        return jsonify({"success": False, "message": "중복된 시리얼번호가 존재합니다."}), 400

            cur.execute(
                f"""
                UPDATE itma_assets
                SET {changed_column} = %s, updated_at = %s, updated_by = %s
                WHERE id = %s
                RETURNING id, category, manufacturer, item_name, serial_number, received_date,
                          inbound_note, released_date, outbound_note, storage_location,
                          detail_note, sales_rep, usage_status, manufacture_month, input_at, updated_at, updated_by, asset_id, asset_code
                """,
                (parsed_old, now_ts, actor_name, source_asset_id),
            )
            restored_row = cur.fetchone()
            if not restored_row:
                conn.rollback()
                return jsonify({"success": False, "message": "대상 자산을 찾을 수 없습니다."}), 404
            restored_item = _attach_site(cur, _asset_row_to_item(restored_row))
            restored_asset_id = restored_item["id"]

        cur.execute(
            """
            UPDATE itma_asset_history
            SET restored = TRUE, restored_at = %s, restored_by = %s
            WHERE id = %s
            """,
            (now_ts, actor_name, history_id),
        )
        _insert_history(
            cur,
            asset_id=restored_asset_id,
            action="restore",
            actor=actor_name,
            changed_column=changed_column if action != "delete" else None,
            before_value=row[5] if action != "delete" else None,
            after_value=before_value if action != "delete" else None,
            snapshot=restored_item,
            restored_from_history_id=history_id,
        )

        conn.commit()
        log_audit(
            user_id,
            "restore",
            resource="ITMA",
            details=f"이력 복원 자산번호 : {restored_item.get('asset_code') or restored_asset_id}, history_id={history_id}",
        )
        message = f"{restored_item.get('asset_code') or ''} 자산을 복원했습니다.".strip()
        if asset_code_changed:
            message = (
                f"기존 자산번호({_clean_text((snapshot or {}).get('asset_code'))})는 다른 자산이 사용 중이어서 "
                f"새 자산번호 {restored_item.get('asset_code')}(으)로 복원했습니다."
            )
        return jsonify({"success": True, "item": restored_item, "message": message})
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@itma_bp.route("/server-time", methods=["GET"])
def server_time():
    permissions = _require_itma_role()
    if not isinstance(permissions, dict):
        return permissions
    return jsonify({"success": True, "server_time": _now_local().strftime("%Y-%m-%d %H:%M:%S")})
