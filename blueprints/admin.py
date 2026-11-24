# -*- coding: utf-8 -*-
"""
관리자 Blueprint
관리자 설정, 사용자 관리, 이메일 관리, 보안 설정
"""
from flask import Blueprint, render_template, request, redirect, url_for, session, flash, abort, jsonify
from werkzeug.security import generate_password_hash
from werkzeug.utils import secure_filename
from datetime import datetime
import hmac
import re
import os
import secrets
import traceback
import pandas as pd
from io import BytesIO
from openpyxl import Workbook
from models import get_db_connection
from services import send_email
from services.email_service import test_email_connection
from config import email_config
from utils import log_audit, parse_ip_entries, validate_ip_entries

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')
DEFAULT_RESET_PASSWORD = '123456'
LOGIN_CUSTOM_LOGO_DIR = os.path.join('static', 'uploads', 'login_logo')
LOGIN_CUSTOM_LOGO_FILENAME = 'custom_logo.png'
LOGIN_CUSTOM_LOGO_PATH = os.path.join(LOGIN_CUSTOM_LOGO_DIR, LOGIN_CUSTOM_LOGO_FILENAME)
LOGIN_CUSTOM_LOGO_STATIC_PATH = 'uploads/login_logo/custom_logo.png'
LOGIN_CUSTOM_LOGO_MAX_SIZE = 5 * 1024 * 1024


def _is_valid_login_logo_png(uploaded_file):
    filename = secure_filename(getattr(uploaded_file, 'filename', '') or '')
    if not filename or os.path.splitext(filename)[1].lower() != '.png':
        return False
    try:
        signature = uploaded_file.stream.read(8)
        uploaded_file.stream.seek(0)
    except (AttributeError, OSError):
        return False
    return signature == b'\x89PNG\r\n\x1a\n'


DEFAULT_CATEGORY_PERMISSION_KEYS = (
    'pc',
    'printer',
    'software',
    'license',
    'hardware',
    'network',
    'security',
    'server',
    'solution',
    'cloud',
    'other',
)


def _to_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ('1', 'true', 'yes', 'on')


def _to_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _load_security_settings(cur):
    settings = {}
    try:
        cur.execute("SELECT setting_key, setting_value FROM security_settings")
        for key, value in cur.fetchall():
            settings[key] = value
    except Exception:
        # security_settings table may not exist yet.
        pass
    return settings


def _normalize_allowed_ip_text(value):
    return '\n'.join(parse_ip_entries(value))


def _ensure_security_settings_table(cur):
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS security_settings (
            id SERIAL PRIMARY KEY,
            setting_key VARCHAR(100) UNIQUE NOT NULL,
            setting_value TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def _validate_password_by_policy(password, settings):
    min_length = _to_int(settings.get('password_min_length', 8), 8)
    if len(password) < min_length:
        return False, f'비밀번호는 최소 {min_length}자 이상이어야 합니다.'

    if _to_bool(settings.get('password_require_uppercase', True), True) and not any(c.isupper() for c in password):
        return False, '비밀번호에 대문자를 1자 이상 포함해야 합니다.'
    if _to_bool(settings.get('password_require_lowercase', True), True) and not any(c.islower() for c in password):
        return False, '비밀번호에 소문자를 1자 이상 포함해야 합니다.'
    if _to_bool(settings.get('password_require_number', True), True) and not any(c.isdigit() for c in password):
        return False, '비밀번호에 숫자를 1자 이상 포함해야 합니다.'
    if _to_bool(settings.get('password_require_special', True), True):
        specials = set('!@#$%^&*()_+-=[]{}|;:,.<>?/~`')
        if not any(c in specials for c in password):
            return False, '비밀번호에 특수문자를 1자 이상 포함해야 합니다.'

    return True, ''


def _get_or_create_csrf_token():
    token = session.get('csrf_token')
    if not token:
        token = secrets.token_urlsafe(32)
        session['csrf_token'] = token
    return token


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


def _csrf_failure_response():
    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        return jsonify({'success': False, 'message': '잘못된 요청입니다.'}), 400
    flash("잘못된 요청입니다.", "danger")
    return redirect(url_for('admin.settings'))


def _normalize_category_key(value):
    raw = str(value or '').strip().lower()
    if not raw:
        return ''
    if raw in {'pc', '컴퓨터', '노트북'} or 'pc' in raw:
        return 'pc'
    if raw in {'printer', '프린터'} or '프린터' in raw:
        return 'printer'
    if raw in {'software', 'sw', '소프트웨어'} or '소프트' in raw:
        return 'software'
    if raw in {'license', '라이선스'} or '라이선' in raw:
        return 'license'
    if raw in {'hardware', 'hw', '하드웨어'} or '하드웨어' in raw:
        return 'hardware'
    if raw in {'network', 'nw', '네트워크', 'l2', 'l3', 'l4', 'l7'} or '네트워크' in raw:
        return 'network'
    if raw in {'security', 'se', '보안'} or '보안' in raw:
        return 'security'
    if raw in {'server', '서버'} or '서버' in raw:
        return 'server'
    if raw in {'solution', '솔루션'} or '솔루션' in raw:
        return 'solution'
    if raw in {'cloud', '클라우드'} or '클라우드' in raw:
        return 'cloud'
    if raw in {'other', '기타', '그외'} or '기타' in raw or '그외' in raw:
        return 'other'
    fallback = re.sub(r'[^\w-]+', '_', raw, flags=re.UNICODE).strip('_')
    return fallback or 'other'


def _get_permission_category_keys(cur):
    category_keys = list(DEFAULT_CATEGORY_PERMISSION_KEYS)
    seen = set(category_keys)
    try:
        cur.execute("SELECT category_key FROM itma_categories WHERE category_key IS NOT NULL AND TRIM(category_key) <> '' ORDER BY display_order, category_key")
        for row in cur.fetchall():
            key = _normalize_category_key(row[0])
            if key and key not in seen:
                category_keys.append(key)
                seen.add(key)
    except Exception:
        pass
    try:
        cur.execute("SELECT DISTINCT category FROM itma_assets WHERE category IS NOT NULL AND TRIM(category) <> ''")
        for row in cur.fetchall():
            key = _normalize_category_key(row[0])
            if key and key not in seen:
                category_keys.append(key)
                seen.add(key)
    except Exception:
        pass
    try:
        cur.execute("SELECT DISTINCT category_key FROM permission_group_categories WHERE category_key IS NOT NULL AND TRIM(category_key) <> ''")
        for row in cur.fetchall():
            key = _normalize_category_key(row[0])
            if key and key not in seen:
                category_keys.append(key)
                seen.add(key)
    except Exception:
        pass
    return category_keys


def _serialize_permission_group(cur, row):
    group_id = row[0]
    cur.execute(
        """
        SELECT category_key, can_view, can_edit
        FROM permission_group_categories
        WHERE group_id = %s
        ORDER BY category_key ASC
        """,
        (group_id,),
    )
    permissions = {
        category_key: {
            'can_view': bool(can_view),
            'can_edit': bool(can_edit),
        }
        for category_key, can_view, can_edit in cur.fetchall()
    }
    cur.execute(
        """
        SELECT u.username, COALESCE(u.real_name, ''), u.role
        FROM user_permission_groups upg
        JOIN users u ON u.username = upg.username
        WHERE upg.group_id = %s
        ORDER BY u.username ASC
        """,
        (group_id,),
    )
    assigned_users = [
        {
            'username': username,
            'real_name': real_name,
            'role': role,
        }
        for username, real_name, role in cur.fetchall()
    ]
    return {
        'id': group_id,
        'group_name': row[1],
        'target_role': row[2],
        'description': row[3] or '',
        'is_active': bool(row[4]),
        'permissions': permissions,
        'assigned_users': assigned_users,
    }


def _load_permission_groups(cur):
    cur.execute(
        """
        SELECT id, group_name, target_role, description, is_active
        FROM permission_groups
        ORDER BY target_role ASC, group_name ASC
        """
    )
    return [_serialize_permission_group(cur, row) for row in cur.fetchall()]


@admin_bp.before_request
def _enforce_csrf_for_mutating_admin_requests():
    # Protect all mutating admin routes with CSRF validation.
    if request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
        if not _validate_csrf_token():
            return _csrf_failure_response()
    return None


def replace_template_variables(template_text, variables):
    """
    이메일 템플릿의 플레이스홀더를 실제 값으로 치환
    
    Args:
        template_text (str): 템플릿 텍스트
        variables (dict): 치환할 변수 딕셔너리 (예: {'real_name': '홍길동', 'username': 'user01', ...})
    
    Returns:
        str: 치환된 텍스트
    
    Example:
        >>> template = "안녕하세요 {real_name}님, ID는 {username}입니다."
        >>> replace_template_variables(template, {'real_name': '홍길동', 'username': 'user01'})
        '안녕하세요 홍길동님, ID는 user01입니다.'
    """
    result = template_text
    for key, value in variables.items():
        placeholder = '{' + key + '}'
        result = result.replace(placeholder, str(value))
    return result


def get_web_server_config():
    """웹서버 설정 조회"""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("SELECT setting_key, setting_value, updated_at FROM system_settings WHERE setting_key IN ('server_name', 'url_scheme', 'allowed_extensions', 'max_file_size', 'ssl_cert_path', 'ssl_key_path', 'force_https_redirect')")
        rows = cur.fetchall()
        
        config = {}
        for row in rows:
            key, value, updated_at = row
            config[key] = value
            if key == 'server_name':
                config['updated_at'] = updated_at.strftime('%Y-%m-%d %H:%M:%S') if updated_at else None
        
        # 기본값 설정
        if 'allowed_extensions' not in config:
            config['allowed_extensions'] = 'txt,pdf,png,jpg,jpeg,gif,xlsx,xls,csv,doc,docx,zip'
        if 'max_file_size' not in config:
            config['max_file_size'] = '100'
        if 'ssl_cert_path' not in config:
            config['ssl_cert_path'] = ''
        if 'ssl_key_path' not in config:
            config['ssl_key_path'] = ''
        if 'force_https_redirect' not in config:
            config['force_https_redirect'] = 'false'
        
        cur.close()
        conn.close()
        
        return config
    except Exception as e:
        print(f"웹서버 설정 조회 오류: {e}")
        return {'allowed_extensions': 'txt,pdf,png,jpg,jpeg,gif,xlsx,xls,csv,doc,docx,zip', 
                'max_file_size': '100',
                'ssl_cert_path': '',
                'ssl_key_path': '',
                'force_https_redirect': 'false'}


@admin_bp.route('/settings')
def settings():
    """관리자 설정 페이지"""
    if session.get('role') != 'admin':
        flash("최고 관리자만 접근 가능한 페이지입니다.", "danger")
        abort(403)
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    # 사용자 목록 (활성 사용자만)
    cur.execute(
        """
        SELECT username, real_name, role, is_active, email, created_at, COALESCE(allowed_ip_list, '')
        FROM users
        WHERE is_active = TRUE
        ORDER BY username ASC
        """
    )
    users = cur.fetchall()
    
    # 최근 접속 로그 50개
    cur.execute("SELECT username, ip_address, login_time FROM access_logs ORDER BY login_time DESC LIMIT 50")
    logs = cur.fetchall()
    
    # ITMA 자산 통계
    cur.execute("SELECT to_regclass('public.itma_assets') IS NOT NULL")
    has_itma_assets = cur.fetchone()[0]
    if has_itma_assets:
        cur.execute("SELECT COUNT(*) FROM itma_assets")
        total_itma_assets = cur.fetchone()[0]
    else:
        total_itma_assets = 0
    
    cur.execute("SELECT COUNT(*) FROM email_logs WHERE status = 'success'")
    email_count = cur.fetchone()[0]
    
    cur.execute("SELECT COUNT(*) FROM access_logs WHERE login_time >= NOW() - INTERVAL '24 hours'")
    login_24h = cur.fetchone()[0]

    # 상세 통계(통계 탭)
    cur.execute("SELECT COUNT(*) FROM users WHERE is_active = TRUE")
    total_users = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM users WHERE is_active = TRUE AND role = 'admin'")
    admin_users = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM users WHERE is_active = TRUE AND role = 'manager'")
    manager_users = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM users WHERE is_active = TRUE AND role = 'user'")
    normal_users = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM access_logs")
    total_access_logs = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM access_logs WHERE DATE(login_time) = CURRENT_DATE")
    today_access_logs = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM access_logs WHERE login_time >= NOW() - INTERVAL '7 days'")
    week_access_logs = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM access_logs WHERE login_time >= NOW() - INTERVAL '30 days'")
    month_access_logs = cur.fetchone()[0]
    
    cur.close()
    conn.close()
    
    # 웹서버 설정 조회
    web_server_config = get_web_server_config()
    
    return render_template(
        'admin.html',
        users=users,
        logs=logs,
        total_itma_assets=total_itma_assets,
        email_count=email_count,
        login_24h=login_24h,
        web_server_config=web_server_config,
        total_users=total_users,
        admin_users=admin_users,
        manager_users=manager_users,
        normal_users=normal_users,
        total_access_logs=total_access_logs,
        today_access_logs=today_access_logs,
        week_access_logs=week_access_logs,
        month_access_logs=month_access_logs,
        category_permission_keys=DEFAULT_CATEGORY_PERMISSION_KEYS,
        csrf_token=_get_or_create_csrf_token(),
    )


@admin_bp.route('/login-page-settings', methods=['GET', 'POST'])
def login_page_settings():
    """로그인 화면에 표시하는 사이트 명칭과 안내 문구를 관리한다."""
    if session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '권한이 없습니다.'}), 403

    setting_keys = (
        'login_site_name',
        'login_welcome_message',
        'login_site_name_font_size',
        'login_welcome_message_font_size',
    )

    def normalize_text(value, maximum):
        return str(value or '').strip()[:maximum] or None

    def normalize_font_size(value, minimum, maximum):
        if value is None or str(value).strip() == '':
            return None
        try:
            size = int(value)
        except (TypeError, ValueError):
            return None
        return min(max(size, minimum), maximum)

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        if request.method == 'GET':
            cur.execute(
                """
                SELECT setting_key, setting_value
                FROM system_settings
                WHERE setting_key IN ('login_site_name', 'login_welcome_message', 'login_site_name_font_size', 'login_welcome_message_font_size')
                """
            )
            values = {key: value for key, value in cur.fetchall()}
            settings = {
                'login_site_name': normalize_text(values.get('login_site_name'), 100),
                'login_welcome_message': normalize_text(values.get('login_welcome_message'), 300),
                'login_site_name_font_size': normalize_font_size(values.get('login_site_name_font_size'), 12, 48),
                'login_welcome_message_font_size': normalize_font_size(values.get('login_welcome_message_font_size'), 10, 32),
            }
            return jsonify({'success': True, 'settings': settings})

        data = request.get_json(silent=True) or {}
        settings = {
            'login_site_name': normalize_text(data.get('login_site_name'), 100),
            'login_welcome_message': normalize_text(data.get('login_welcome_message'), 300),
            'login_site_name_font_size': normalize_font_size(data.get('login_site_name_font_size'), 12, 48),
            'login_welcome_message_font_size': normalize_font_size(data.get('login_welcome_message_font_size'), 10, 32),
        }
        for key in setting_keys:
            cur.execute(
                """
                INSERT INTO system_settings (setting_key, setting_value, created_at, updated_at)
                VALUES (%s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (setting_key)
                DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP
                """,
                (key, settings[key]),
            )
        conn.commit()
        log_audit(session.get('username'), 'update', resource='로그인 화면 설정', details='로그인 화면 문구를 변경했습니다.')
        return jsonify({
            'success': True,
            'message': '로그인 화면 설정을 저장했습니다.',
            'settings': settings,
        })
    except Exception:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'message': '로그인 화면 설정 저장 중 오류가 발생했습니다.'}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@admin_bp.route('/login-page-logo', methods=['GET', 'POST', 'DELETE'])
def login_page_logo():
    """사용자 지정 로그인 로고를 업로드하거나 기본 로고로 초기화한다."""
    if session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '권한이 없습니다.'}), 403

    def logo_url(version=''):
        return url_for('static', filename=LOGIN_CUSTOM_LOGO_STATIC_PATH, v=version or None)

    if request.method == 'GET':
        conn = get_db_connection()
        cur = conn.cursor()
        try:
            cur.execute("SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('login_custom_logo_enabled', 'login_custom_logo_updated_at')")
            values = {key: value for key, value in cur.fetchall()}
            enabled = str(values.get('login_custom_logo_enabled') or '').strip().lower() in {'1', 'true', 'yes', 'on'}
            has_custom_logo = enabled and os.path.isfile(LOGIN_CUSTOM_LOGO_PATH)
            return jsonify({'success': True, 'has_custom_logo': has_custom_logo, 'logo_url': logo_url(values.get('login_custom_logo_updated_at')) if has_custom_logo else url_for('static', filename='logo.png')})
        finally:
            cur.close()
            conn.close()

    if request.method == 'DELETE':
        try:
            if os.path.isfile(LOGIN_CUSTOM_LOGO_PATH):
                os.remove(LOGIN_CUSTOM_LOGO_PATH)
            conn = get_db_connection()
            cur = conn.cursor()
            try:
                _upsert_system_setting(cur, 'login_custom_logo_enabled', None)
                _upsert_system_setting(cur, 'login_custom_logo_updated_at', None)
                conn.commit()
            finally:
                cur.close()
                conn.close()
            log_audit(session.get('username'), 'delete', resource='로그인 로고', details='사용자 지정 로그인 로고를 초기화했습니다.')
            return jsonify({'success': True, 'message': '기본 로고로 초기화했습니다.', 'logo_url': url_for('static', filename='logo.png')})
        except OSError:
            return jsonify({'success': False, 'message': '로고 초기화 중 오류가 발생했습니다.'}), 500

    logo_file = request.files.get('login_logo_file')
    if not logo_file or not logo_file.filename:
        return jsonify({'success': False, 'message': 'PNG 로고 파일을 선택해주세요.'}), 400
    if not _is_valid_login_logo_png(logo_file):
        return jsonify({'success': False, 'message': 'PNG 형식의 이미지 파일만 업로드할 수 있습니다.'}), 400
    try:
        logo_file.stream.seek(0, os.SEEK_END)
        size = logo_file.stream.tell()
        logo_file.stream.seek(0)
    except OSError:
        return jsonify({'success': False, 'message': '로고 파일을 읽을 수 없습니다.'}), 400
    if size > LOGIN_CUSTOM_LOGO_MAX_SIZE:
        return jsonify({'success': False, 'message': '로고 파일은 5MB 이하만 업로드할 수 있습니다.'}), 400

    try:
        os.makedirs(LOGIN_CUSTOM_LOGO_DIR, exist_ok=True)
        temporary_path = f'{LOGIN_CUSTOM_LOGO_PATH}.tmp'
        logo_file.save(temporary_path)
        os.replace(temporary_path, LOGIN_CUSTOM_LOGO_PATH)
        version = str(int(datetime.now().timestamp() * 1000))
        conn = get_db_connection()
        cur = conn.cursor()
        try:
            _upsert_system_setting(cur, 'login_custom_logo_enabled', 'true')
            _upsert_system_setting(cur, 'login_custom_logo_updated_at', version)
            conn.commit()
        finally:
            cur.close()
            conn.close()
        log_audit(session.get('username'), 'update', resource='로그인 로고', details='사용자 지정 로그인 로고를 업로드했습니다.')
        return jsonify({'success': True, 'message': '로그인 로고를 변경했습니다.', 'logo_url': logo_url(version), 'has_custom_logo': True})
    except OSError:
        return jsonify({'success': False, 'message': '로고 파일 저장 중 오류가 발생했습니다.'}), 500


@admin_bp.route('/email_config')
def get_email_config():
    """이메일 설정 정보 조회"""
    if session.get('role') != 'admin':
        abort(403)
    return jsonify(email_config)


@admin_bp.route('/access_logs', methods=['GET'])
def get_access_logs():
    """접속 로그 조회 (건수/검색/페이지네이션 지원)"""
    if session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '권한이 없습니다.'}), 403

    limit_raw = (request.args.get('limit', '50') or '50').strip().lower()
    page_raw = (request.args.get('page', '1') or '1').strip()
    keyword = (request.args.get('q', '') or '').strip()
    like_keyword = f"%{keyword}%"
    allowed = {'10', '30', '50', '100', 'all'}
    if limit_raw not in allowed:
        limit_raw = '50'
    try:
        page = int(page_raw)
        if page < 1:
            page = 1
    except ValueError:
        page = 1

    try:
        conn = get_db_connection()
        cur = conn.cursor()

        cur.execute("SELECT COUNT(*) FROM access_logs")
        overall_total_count = cur.fetchone()[0]

        if keyword:
            cur.execute(
                """
                SELECT COUNT(*)
                FROM access_logs
                WHERE CAST(username AS TEXT) ILIKE %s
                   OR CAST(ip_address AS TEXT) ILIKE %s
                   OR TO_CHAR(login_time, 'YYYY-MM-DD HH24:MI:SS') ILIKE %s
                """,
                (like_keyword, like_keyword, like_keyword),
            )
            total_count = cur.fetchone()[0]
        else:
            total_count = overall_total_count

        if limit_raw == 'all':
            page = 1
            total_pages = 1 if total_count > 0 else 0
            if keyword:
                cur.execute(
                    """
                    SELECT username, ip_address, login_time
                    FROM access_logs
                    WHERE CAST(username AS TEXT) ILIKE %s
                       OR CAST(ip_address AS TEXT) ILIKE %s
                       OR TO_CHAR(login_time, 'YYYY-MM-DD HH24:MI:SS') ILIKE %s
                    ORDER BY login_time DESC
                    """,
                    (like_keyword, like_keyword, like_keyword),
                )
            else:
                cur.execute(
                    """
                    SELECT username, ip_address, login_time
                    FROM access_logs
                    ORDER BY login_time DESC
                    """
                )
        else:
            limit_val = int(limit_raw)
            total_pages = (total_count + limit_val - 1) // limit_val if total_count > 0 else 0
            if total_pages > 0 and page > total_pages:
                page = total_pages
            offset = (page - 1) * limit_val
            if keyword:
                cur.execute(
                    """
                    SELECT username, ip_address, login_time
                    FROM access_logs
                    WHERE CAST(username AS TEXT) ILIKE %s
                       OR CAST(ip_address AS TEXT) ILIKE %s
                       OR TO_CHAR(login_time, 'YYYY-MM-DD HH24:MI:SS') ILIKE %s
                    ORDER BY login_time DESC
                    LIMIT %s
                    OFFSET %s
                    """,
                    (like_keyword, like_keyword, like_keyword, limit_val, offset),
                )
            else:
                cur.execute(
                    """
                    SELECT username, ip_address, login_time
                    FROM access_logs
                    ORDER BY login_time DESC
                    LIMIT %s
                    OFFSET %s
                    """,
                    (limit_val, offset),
                )

        rows = cur.fetchall()
        cur.close()
        conn.close()

        logs = [
            {
                'username': row[0],
                'ip_address': row[1] or '-',
                'login_time': row[2].strftime('%Y-%m-%d %H:%M:%S') if row[2] else '-',
            }
            for row in rows
        ]

        return jsonify({
            'success': True,
            'logs': logs,
            'total_count': total_count,
            'overall_total_count': overall_total_count,
            'shown_count': len(logs),
            'limit': limit_raw,
            'page': page,
            'total_pages': total_pages,
            'has_prev': page > 1,
            'has_next': page < total_pages if total_pages > 0 else False,
            'q': keyword,
        })
    except Exception as e:
        print(f"❌ 접속 로그 조회 오류: {e}")
        return jsonify({'success': False, 'message': f'접속 로그 조회 실패: {str(e)}'}), 500


@admin_bp.route('/send_email', methods=['POST'])
def send_email_route():
    """이메일 발송"""
    if session.get('role') != 'admin':
        abort(403)
    
    try:
        data = request.get_json()
        recipient = data.get('recipient', '').strip()
        subject = data.get('subject', '').strip()
        body = data.get('body', '').strip()
        
        if not recipient or not subject or not body:
            return jsonify({"success": False, "message": "모든 필드를 입력해주세요."}), 400
        
        # 이메일 주소 검증
        email_regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        recipients_list = [email.strip() for email in recipient.split(',')]
        for email_addr in recipients_list:
            if not re.match(email_regex, email_addr):
                return jsonify({"success": False, "message": f"잘못된 이메일 주소: {email_addr}"}), 400
        # 이메일 발송 결과 초기화
        sent_count = 0
        failed_count = 0
        failed_details = []

        conn = get_db_connection()
        cur = conn.cursor()

        for email_addr in recipients_list:
            try:
                # 이메일 발송 결과 초기화
                cur.execute("""
                    SELECT username, real_name, role
                    FROM users
                    WHERE email = %s
                    LIMIT 1
                """, (email_addr,))
                user_row = cur.fetchone()

                per_subject = subject
                per_body = body

                if user_row:
                    username, real_name, role = user_row
                    real_name = real_name or username

                    variables = {
                        'real_name': real_name,
                        'username': username,
                        'password': '',  # 이메일 발송 결과 초기화
                        'role': role or ''
                    }

                    per_subject = replace_template_variables(per_subject, variables)
                    per_body = replace_template_variables(per_body, variables)

                result = send_email(email_addr, per_subject, per_body)

                if result.get('success'):
                    sent_count += 1
                    try:
                        cur.execute("""
                            INSERT INTO email_logs (admin_username, recipient, subject, status, sent_at)
                            VALUES (%s, %s, %s, %s, %s)
                        """, (session['username'], email_addr, per_subject, 'success', datetime.now()))
                        conn.commit()
                    except Exception as log_error:
                        print(f"이메일 로그 기록 실패: {log_error}")
                else:
                    failed_count += 1
                    failed_details.append({
                        'email': email_addr,
                        'error': result.get('message', '알 수 없는 오류')
                    })

            except Exception as send_error:
                failed_count += 1
                failed_details.append({
                    'email': email_addr,
                    'error': str(send_error)
                })
                print(f"이메일 전송 실패: {email_addr} - {send_error}")

        cur.close()
        conn.close()

        return jsonify({
            "success": failed_count == 0,
            "sent_count": sent_count,
            "failed_count": failed_count,
            "failed_details": failed_details,
            "message": f"전송 결과: 성공 {sent_count}건, 실패 {failed_count}건"
        })        
    except Exception as e:
        print(f"❌ 이메일 발송 오류: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "message": f"오류: {str(e)}"}), 500


@admin_bp.route('/get_user_emails', methods=['GET'])
def get_user_emails():
    """활성 사용자 이메일 목록 조회"""
    if session.get('role') != 'admin':
        return jsonify({"success": False, "message": "권한이 없습니다."}), 403
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT username, real_name, email, role
            FROM users
            WHERE is_active = TRUE AND email IS NOT NULL AND email != ''
            ORDER BY real_name ASC, username ASC
        """)
        
        users = cur.fetchall()
        cur.close()
        conn.close()
        
        user_list = []
        for user in users:
            user_list.append({
                'username': user[0],
                'real_name': user[1],
                'email': user[2],
                'role': user[3]
            })
        
        return jsonify({"success": True, "users": user_list})
        
    except Exception as e:
        print(f"❌ 사용자 이메일 조회 오류: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@admin_bp.route('/get_address_book', methods=['GET'])
def get_address_book():
    """주소록 목록 조회"""
    if session.get('role') != 'admin':
        return jsonify({"success": False, "message": "권한이 없습니다."}), 403
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT id, name, email, department, position, notes, created_at
            FROM address_book
            ORDER BY name ASC
        """)
        
        addresses = cur.fetchall()
        cur.close()
        conn.close()
        
        address_list = []
        for addr in addresses:
            address_list.append({
                'id': addr[0],
                'name': addr[1],
                'email': addr[2],
                'department': addr[3],
                'position': addr[4],
                'notes': addr[5],
                'created_at': addr[6].strftime('%Y-%m-%d %H:%M:%S') if addr[6] else ''
            })
        
        return jsonify({"success": True, "addresses": address_list})
        
    except Exception as e:
        print(f"❌ 주소록 조회 오류: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@admin_bp.route('/save_address', methods=['POST'])
def save_address():
    """주소록에 새 주소 저장"""
    if session.get('role') != 'admin':
        return jsonify({"success": False, "message": "권한이 없습니다."}), 403
    
    try:
        data = request.get_json()
        name = data.get('name', '').strip()
        email = data.get('email', '').strip()
        department = data.get('department', '').strip()
        position = data.get('position', '').strip()
        notes = data.get('notes', '').strip()
        
        if not name or not email:
            return jsonify({"success": False, "message": "이름과 이메일은 필수입니다."}), 400
        
        # 이메일 유효성 검사
        email_regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_regex, email):
            return jsonify({"success": False, "message": "유효하지 않은 이메일 주소입니다."}), 400
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        # 중복 체크
        cur.execute("SELECT COUNT(*) FROM address_book WHERE email = %s", (email,))
        if cur.fetchone()[0] > 0:
            cur.close()
            conn.close()
            return jsonify({"success": False, "message": "이미 등록된 이메일입니다."}), 400
        
        cur.execute("""
            INSERT INTO address_book (name, email, department, position, notes, created_by)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (name, email, department, position, notes, session.get('username')))
        
        new_id = cur.fetchone()[0]
        conn.commit()
        cur.close()
        conn.close()
        
        log_audit(session.get('username'), 'create', resource=f'주소록: {name}', details=f'이메일: {email}')
        
        return jsonify({"success": True, "message": "주소가 저장되었습니다.", "id": new_id})
        
    except Exception as e:
        print(f"❌ 주소 저장 오류: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500


@admin_bp.route('/delete_address/<int:address_id>', methods=['DELETE'])
def delete_address(address_id):
    """주소록에서 주소 삭제"""
    if session.get('role') != 'admin':
        return jsonify({"success": False, "message": "권한이 없습니다."}), 403
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # 삭제할 주소 정보 조회
        cur.execute("SELECT name, email FROM address_book WHERE id = %s", (address_id,))
        addr_info = cur.fetchone()
        
        if not addr_info:
            cur.close()
            conn.close()
            return jsonify({"success": False, "message": "주소를 찾을 수 없습니다."}), 404
        
        cur.execute("DELETE FROM address_book WHERE id = %s", (address_id,))
        conn.commit()
        cur.close()
        conn.close()
        
        log_audit(session.get('username'), 'delete', resource=f'주소록: {addr_info[0]}', details=f'이메일: {addr_info[1]}')
        
        return jsonify({"success": True, "message": "주소가 삭제되었습니다."})
        
    except Exception as e:
        print(f"❌ 주소 삭제 오류: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@admin_bp.route('/email_settings', methods=['GET'])
def get_email_settings():
    """현재 이메일 설정 가져오기"""
    if session.get('role') != 'admin':
        return jsonify({"success": False, "message": "권한이 없습니다."}), 403
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("""
            SELECT smtp_server, smtp_port, smtp_username, smtp_password, 
                   sender_email, sender_name, use_tls
            FROM email_settings 
            LIMIT 1
        """)
        
        settings = cur.fetchone()
        cur.close()
        conn.close()
        
        if settings:
            return jsonify({
                "success": True,
                "smtp_server": settings[0],
                "smtp_port": settings[1],
                "smtp_username": settings[2],
                "smtp_password": "",
                "smtp_password_set": bool(settings[3]),
                "sender_email": settings[4],
                "sender_name": settings[5],
                "use_tls": settings[6]
            })
        else:
            return jsonify({
                "success": True,
                "smtp_server": "",
                "smtp_port": 587,
                "smtp_username": "",
                "smtp_password": "",
                "smtp_password_set": False,
                "sender_email": "",
                "sender_name": "",
                "use_tls": True
            })
            
    except Exception as e:
        print(f"Error getting email settings: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@admin_bp.route('/test_smtp', methods=['POST'])
def test_smtp():
    """SMTP 연결 테스트"""
    if session.get('role') != 'admin':
        return jsonify({"success": False, "message": "권한이 없습니다."}), 403

    try:
        data = request.get_json() or {}
        smtp_server = (data.get('smtp_server') or '').strip()
        smtp_port = data.get('smtp_port')
        smtp_username = (data.get('smtp_username') or '').strip()
        sender_email = (data.get('sender_email') or '').strip()

        if not smtp_server or not smtp_port or not smtp_username or not sender_email:
            return jsonify({"success": False, "message": "서버/포트/계정/발신자 이메일을 입력해주세요."}), 400

        result = test_email_connection(data)
        return jsonify(result), (200 if result.get('success') else 400)
    except Exception as e:
        print(f"❌ SMTP 테스트 오류: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "message": f"오류: {str(e)}"}), 500


@admin_bp.route('/update_email_settings', methods=['POST'])
def update_email_settings():
    """SMTP 설정 업데이트"""
    if session.get('role') != 'admin':
        return jsonify({"success": False, "message": "권한이 없습니다."}), 403
    
    try:
        data = request.get_json()
        smtp_server = data.get('smtp_server', '').strip()
        smtp_port = int(data.get('smtp_port', 587))
        smtp_username = data.get('smtp_username', '').strip()
        smtp_password = data.get('smtp_password', '').strip()
        sender_email = data.get('sender_email', '').strip()
        sender_name = data.get('sender_name', '').strip()
        use_tls = data.get('use_tls', True)
        
        if not all([smtp_server, smtp_port, smtp_username, smtp_password, sender_email, sender_name]):
            return jsonify({"success": False, "message": "모든 필드를 입력해주세요."}), 400
        
        # DB 업데이트
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("SELECT COUNT(*) FROM email_settings;")
        if cur.fetchone()[0] == 0:
            cur.execute("""
                INSERT INTO email_settings (smtp_server, smtp_port, smtp_username, smtp_password, sender_email, sender_name, use_tls)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (smtp_server, smtp_port, smtp_username, smtp_password, sender_email, sender_name, use_tls))
        else:
            cur.execute("""
                UPDATE email_settings
                SET smtp_server = %s, smtp_port = %s, smtp_username = %s, smtp_password = %s,
                    sender_email = %s, sender_name = %s, use_tls = %s, updated_at = NOW()
                WHERE id = (SELECT id FROM email_settings LIMIT 1)
            """, (smtp_server, smtp_port, smtp_username, smtp_password, sender_email, sender_name, use_tls))
        
        conn.commit()
        cur.close()
        conn.close()
        
        # 전역 설정 업데이트
        email_config.update({
            'smtp_server': smtp_server,
            'smtp_port': smtp_port,
            'smtp_username': smtp_username,
            'smtp_password': smtp_password,
            'sender_email': sender_email,
            'sender_name': sender_name,
            'use_tls': use_tls
        })
        
        # 감사 로그 기록
        log_audit(session.get('username'), 'config', 
                 resource='이메일 설정',
                 details=f'SMTP: {smtp_server}:{smtp_port}, 발신: {sender_email}')
        
        return jsonify({"success": True, "message": "이메일 설정이 저장되었습니다."})
        
    except Exception as e:
        print(f"❌ 이메일 설정 저장 오류: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "message": f"오류: {str(e)}"}), 500


@admin_bp.route('/get_recent_emails', methods=['GET'])
def get_recent_emails():
    """최근 이메일 발송 내역 조회"""
    if session.get('role') != 'admin':
        return jsonify({"success": False, "message": "권한이 없습니다."}), 403
    
    try:
        page = max(request.args.get('page', 1, type=int) or 1, 1)
        per_page = request.args.get('per_page', request.args.get('limit', 10, type=int), type=int) or 10
        per_page = min(max(per_page, 1), 50)
        offset = (page - 1) * per_page
        
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM email_logs")
        total = cur.fetchone()[0] or 0
        cur.execute("""
            SELECT id, admin_username, recipient, subject, status, sent_at
            FROM email_logs
            ORDER BY sent_at DESC
            LIMIT %s
            OFFSET %s
        """, (per_page, offset))
        
        logs = cur.fetchall()
        cur.close()
        conn.close()
        
        email_list = []
        for log in logs:
            email_list.append({
                "id": log[0],
                "admin": log[1],
                "recipient": log[2],
                "subject": log[3],
                "status": log[4],
                "sent_at": log[5].strftime('%Y-%m-%d %H:%M:%S') if log[5] else ''
            })
        
        total_pages = (total + per_page - 1) // per_page if total else 1
        return jsonify({
            "success": True,
            "emails": email_list,
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total,
                "total_pages": total_pages,
                "has_prev": page > 1,
                "has_next": page < total_pages,
            }
        })
        
    except Exception as e:
        print(f"❌ 이메일 내역 조회 오류: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500


@admin_bp.route('/get_all_templates', methods=['GET'])
def get_all_templates():
    """모든 이메일 템플릿 목록 조회"""
    if session.get('role') != 'admin':
        return jsonify({"success": False, "message": "권한이 없습니다."}), 403
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT id, template_name, template_type, subject, body, created_by, 
                   created_at, updated_at, is_active
            FROM email_templates
            WHERE is_active = TRUE
            ORDER BY created_at DESC
        """)
        
        templates = cur.fetchall()
        cur.close()
        conn.close()
        
        template_list = []
        for t in templates:
            template_list.append({
                "id": t[0],
                "template_name": t[1],
                "template_type": t[2],
                "subject": t[3],
                "body": t[4],
                "created_by": t[5],
                "created_at": t[6].strftime('%Y-%m-%d %H:%M:%S') if t[6] else '',
                "updated_at": t[7].strftime('%Y-%m-%d %H:%M:%S') if t[7] else '',
                "is_active": t[8]
            })
        
        return jsonify({"success": True, "templates": template_list})
        
    except Exception as e:
        print(f"❌ 템플릿 목록 조회 오류: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500


@admin_bp.route('/get_template/<int:template_id>', methods=['GET'])
def get_template(template_id):
    """특정 템플릿 조회"""
    if session.get('role') != 'admin':
        return jsonify({"success": False, "message": "권한이 없습니다."}), 403
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT id, template_name, template_type, subject, body, created_by, 
                   created_at, updated_at, is_active
            FROM email_templates
            WHERE id = %s
        """, (template_id,))
        
        result = cur.fetchone()
        cur.close()
        conn.close()
        
        if result:
            return jsonify({
                "success": True,
                "template": {
                    "id": result[0],
                    "template_name": result[1],
                    "template_type": result[2] or '',
                    "subject": result[3],
                    "body": result[4],
                    "created_by": result[5],
                    "created_at": result[6].strftime('%Y-%m-%d %H:%M:%S') if result[6] else '',
                    "updated_at": result[7].strftime('%Y-%m-%d %H:%M:%S') if result[7] else '',
                    "is_active": result[8]
                }
            })
        else:
            return jsonify({"success": False, "message": "템플릿을 찾을 수 없습니다."}), 404
            
    except Exception as e:
        print(f"❌ 템플릿 조회 오류: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@admin_bp.route('/save_template', methods=['POST'])
def save_template():
    """이메일 템플릿 저장 (신규 또는 수정)"""
    if session.get('role') != 'admin':
        return jsonify({"success": False, "message": "권한이 없습니다."}), 403
    
    try:
        data = request.get_json()
        template_id = data.get('id')
        template_name = data.get('template_name', '').strip()
        template_type = data.get('template_type', '').strip()
        subject = data.get('subject', '').strip()
        body = data.get('body', '').strip()
        
        if not all([template_name, subject, body]):
            return jsonify({"success": False, "message": "템플릿 이름, 제목, 본문은 필수입니다."}), 400
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        if template_id:
            # 기존 템플릿 수정
            cur.execute("""
                UPDATE email_templates
                SET template_name = %s, template_type = %s, subject = %s, body = %s, updated_at = NOW()
                WHERE id = %s
            """, (template_name, template_type if template_type else None, subject, body, template_id))
            message = "템플릿이 수정되었습니다."
            returned_id = template_id
        else:
            # 새 템플릿 생성
            cur.execute("""
                INSERT INTO email_templates (template_name, template_type, subject, body, created_by)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
            """, (template_name, template_type if template_type else None, subject, body, session['username']))
            new_id = cur.fetchone()[0]
            message = f"템플릿이 생성되었습니다. (ID: {new_id})"
            returned_id = new_id
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({"success": True, "message": message, "template_id": returned_id})
        
    except Exception as e:
        print(f"❌ 템플릿 저장 오류: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500


@admin_bp.route('/delete_template/<int:template_id>', methods=['DELETE'])
def delete_template(template_id):
    """템플릿 삭제 (소프트 삭제)"""
    if session.get('role') != 'admin':
        return jsonify({"success": False, "message": "권한이 없습니다."}), 403
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # 소프트 삭제 (is_active = FALSE)
        cur.execute("""
            UPDATE email_templates
            SET is_active = FALSE, updated_at = NOW()
            WHERE id = %s
        """, (template_id,))
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({"success": True, "message": "템플릿이 삭제되었습니다."})
        
    except Exception as e:
        print(f"❌ 템플릿 삭제 오류: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500


@admin_bp.route('/get_email_template', methods=['GET'])
def get_email_template():
    """이메일 템플릿 로드 (레거시 - template_type 기반)"""
    if session.get('role') != 'admin':
        abort(403)
    
    template_type = request.args.get('type', 'welcome_new_user')
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT subject, body FROM email_templates WHERE template_type = %s AND is_active = TRUE
        """, (template_type,))
        result = cur.fetchone()
        cur.close()
        conn.close()
        
        if result:
            return jsonify({
                "success": True,
                "subject": result[0],
                "body": result[1]
            })
        else:
            return jsonify({
                "success": False,
                "message": "템플릿을 찾을 수 없습니다."
            }), 404
            
    except Exception as e:
        print(f"❌ 템플릿 로드 오류: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@admin_bp.route('/save_email_template', methods=['POST'])
def save_email_template():
    """이메일 템플릿 저장"""
    if session.get('role') != 'admin':
        return jsonify({"success": False, "message": "권한이 없습니다."}), 403
    
    try:
        data = request.get_json()
        template_type = data.get('type', '').strip()
        subject = data.get('subject', '').strip()
        body = data.get('body', '').strip()
        
        if not all([template_type, subject, body]):
            return jsonify({"success": False, "message": "모든 필드를 입력해주세요."}), 400
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("""
            SELECT id
            FROM email_templates
            WHERE template_type = %s AND is_active = TRUE
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
        """, (template_type,))
        existing = cur.fetchone()

        if existing:
            cur.execute("""
                UPDATE email_templates
                SET subject = %s,
                    body = %s,
                    updated_at = NOW()
                WHERE id = %s
            """, (subject, body, existing[0]))
        else:
            cur.execute("""
                INSERT INTO email_templates (template_name, template_type, subject, body, created_by)
                VALUES (%s, %s, %s, %s, %s)
            """, (template_type, template_type, subject, body, session.get('username')))
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({"success": True, "message": "템플릿이 저장되었습니다."})
        
    except Exception as e:
        print(f"❌ 템플릿 저장 오류: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500


@admin_bp.route('/update_admin', methods=['POST'])
def update_admin():
    """관리자 정보 수정"""
    if session.get('role') != 'admin':
        flash("권한이 없습니다.", "danger")
        return redirect(url_for('admin.settings'))
    
    try:
        # Form 데이터 받기
        new_admin_id = request.form.get('new_admin_id', '').strip()
        new_password = request.form.get('new_password', '').strip()
        confirm_password = request.form.get('confirm_password', '').strip()
        
        if not new_admin_id:
            flash("관리자 ID를 입력해주세요.", "danger")
            return redirect(url_for('admin.settings'))
        
        # 비밀번호 확인
        if new_password and new_password != confirm_password:
            flash("새 비밀번호가 일치하지 않습니다.", "danger")
            return redirect(url_for('admin.settings'))
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        # 현재 관리자 username 가져오기
        current_username = session.get('username')
        
        settings = _load_security_settings(cur)

        # 관리자 계정 업데이트
        if new_password:
            is_valid, error_msg = _validate_password_by_policy(new_password, settings)
            if not is_valid:
                cur.close()
                conn.close()
                flash(error_msg, "danger")
                return redirect(url_for('admin.settings'))

            hashed_password = generate_password_hash(new_password)
            cur.execute("""
                UPDATE users 
                SET username = %s, password = %s 
                WHERE username = %s AND role = 'admin'
            """, (new_admin_id, hashed_password, current_username))
        else:
            cur.execute("""
                UPDATE users 
                SET username = %s 
                WHERE username = %s AND role = 'admin'
            """, (new_admin_id, current_username))
        
        conn.commit()
        
        if cur.rowcount > 0:
            # 세션 업데이트
            session['username'] = new_admin_id
            flash("관리자 계정 정보가 변경되었습니다.", "success")
        else:
            flash("관리자 계정을 찾을 수 없습니다.", "danger")
        
        cur.close()
        conn.close()
        
        return redirect(url_for('admin.settings'))
        
    except Exception as e:
        print(f"❌ 관리자 정보 수정 오류: {e}")
        flash(f"오류가 발생했습니다: {str(e)}", "danger")
        return redirect(url_for('admin.settings'))


@admin_bp.route('/user/<string:username>/<string:action>', methods=['POST', 'DELETE'])
def user_action(username, action):
    """계정 상태 변경 (정지/활성화) 및 삭제"""
    if session.get('role') != 'admin':
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return jsonify({'success': False, 'message': '권한이 없습니다.'}), 403
        flash("권한이 없습니다.", "danger")
        return redirect(url_for('itma.page'))

    if not _validate_csrf_token():
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return jsonify({'success': False, 'message': '잘못된 요청입니다.'}), 400
        flash("잘못된 요청입니다.", "danger")
        return redirect(url_for('admin.settings'))

    # Action-method mapping: suspend/activate via POST, delete via DELETE.
    if action in ('suspend', 'activate') and request.method != 'POST':
        return jsonify({'success': False, 'message': '허용되지 않은 요청 방식입니다.'}), 405
    if action == 'delete' and request.method != 'DELETE':
        return jsonify({'success': False, 'message': '허용되지 않은 요청 방식입니다.'}), 405
    if action not in ('suspend', 'activate', 'delete'):
        return jsonify({'success': False, 'message': '지원하지 않는 작업입니다.'}), 400
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        if action == 'suspend':
            cur.execute("UPDATE users SET is_active = FALSE WHERE username = %s", (username,))
            message = f"사용자 '{username}'가 정지되었습니다."
            flash(message, "success")
        elif action == 'activate':
            cur.execute("UPDATE users SET is_active = TRUE WHERE username = %s", (username,))
            message = f"사용자 '{username}'가 활성화되었습니다."
            flash(message, "success")
        elif action == 'delete':
            # 관리자는 삭제할 수 없음
            if username == 'admin':
                msg = "관리자 계정은 삭제할 수 없습니다."
                if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                    return jsonify({'success': False, 'message': msg}), 400
                flash(msg, "danger")
                return redirect(url_for('admin.settings'))
            
            # 연관 로그/참조 데이터도 함께 정리됨
            cur.execute("DELETE FROM users WHERE username = %s", (username,))
            message = f"사용자 '{username}'가 삭제되었습니다."
            flash(message, "success")
            
            # 감사 로그 기록
            log_audit(session.get('username'), 'delete', resource=f'사용자: {username}', 
                     details='사용자 삭제')
        
        conn.commit()
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return jsonify({'success': True, 'message': message})
    except Exception as e:
        conn.rollback()
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return jsonify({'success': False, 'message': f'오류가 발생했습니다: {str(e)}'}), 500
        flash(f"오류가 발생했습니다: {str(e)}", "danger")
    finally:
        cur.close()
        conn.close()
    
    return redirect(url_for('admin.settings'))


@admin_bp.route('/users/bulk-delete', methods=['POST'])
def bulk_delete_users():
    """사용자 일괄 삭제"""
    if session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '권한이 없습니다.'}), 403

    data = request.get_json(silent=True) or {}
    raw_usernames = data.get('usernames')
    if not isinstance(raw_usernames, list):
        return jsonify({'success': False, 'message': '잘못된 요청 데이터입니다.'}), 400

    usernames = []
    for item in raw_usernames:
        value = str(item or '').strip()
        if value and value not in usernames:
            usernames.append(value)

    if not usernames:
        return jsonify({'success': False, 'message': '삭제할 사용자를 선택해주세요.'}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        placeholders = ','.join(['%s'] * len(usernames))
        cur.execute(f"SELECT username, role FROM users WHERE username IN ({placeholders})", tuple(usernames))
        rows = cur.fetchall()
        if not rows:
            return jsonify({'success': False, 'message': '삭제할 사용자를 찾을 수 없습니다.'}), 404

        found_usernames = [row[0] for row in rows]
        admin_targets = [row[0] for row in rows if row[1] == 'admin']

        if admin_targets:
            cur.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'")
            total_admin_count = cur.fetchone()[0] or 0
            remaining_admin_count = total_admin_count - len(admin_targets)
            if remaining_admin_count < 1:
                return jsonify({
                    'success': False,
                    'message': '관리자 계정은 최소 1명 이상 유지되어야 하므로 선택한 계정을 삭제할 수 없습니다.'
                }), 400

        delete_placeholders = ','.join(['%s'] * len(found_usernames))
        delete_params = tuple(found_usernames)
        cur.execute(f"DELETE FROM users WHERE username IN ({delete_placeholders})", delete_params)
        deleted_count = cur.rowcount or 0
        deleted_self = session.get('username') in found_usernames

        conn.commit()
        log_audit(
            session.get('username'),
            'delete',
            resource='users',
            details=f'사용자 일괄 삭제 | 삭제 수: {deleted_count}'
        )

        response = {
            'success': True,
            'message': f'{deleted_count}명의 사용자가 삭제되었습니다.',
            'deleted_count': deleted_count
        }
        if deleted_self:
            session.clear()
            response['redirect_url'] = url_for('auth.login')
        return jsonify(response)
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'message': f'오류가 발생했습니다: {str(e)}'}), 500
    finally:
        cur.close()
        conn.close()


@admin_bp.route('/user/update', methods=['POST'])
def update_user():
    """사용자 정보 업데이트 (이름, 이메일, 비밀번호)"""
    if session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '권한이 없습니다.'}), 403
    
    try:
        username = request.form.get('username')
        real_name = request.form.get('real_name', '').strip()
        email = request.form.get('email', '').strip()
        new_password = request.form.get('new_password', '').strip()
        allowed_ip_list = _normalize_allowed_ip_text(request.form.get('allowed_ip_list', ''))
        
        if not username:
            return jsonify({'success': False, 'message': '사용자 ID가 필요합니다.'}), 400
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        # 이메일 중복 체크 (다른 사용자가 사용 중인지)
        if email:
            cur.execute("SELECT username FROM users WHERE email = %s AND username != %s", (email, username))
            if cur.fetchone():
                cur.close()
                conn.close()
                return jsonify({'success': False, 'message': '이미 사용 중인 이메일 주소입니다.'}), 400

        is_valid_ip_list, invalid_entries = validate_ip_entries(allowed_ip_list)
        if not is_valid_ip_list:
            cur.close()
            conn.close()
            invalid_text = ', '.join(invalid_entries)
            return jsonify({'success': False, 'message': f'허용 IP 형식이 올바르지 않습니다: {invalid_text}'}), 400
        
        settings = _load_security_settings(cur)

        # 사용자 정보 업데이트
        if new_password:
            is_valid, error_msg = _validate_password_by_policy(new_password, settings)
            if not is_valid:
                cur.close()
                conn.close()
                return jsonify({'success': False, 'message': error_msg}), 400

            # 비밀번호도 함께 변경
            hashed_password = generate_password_hash(new_password)
            cur.execute("""
                UPDATE users 
                SET real_name = %s, email = %s, allowed_ip_list = %s, password = %s
                WHERE username = %s
            """, (real_name, email, allowed_ip_list or None, hashed_password, username))
        else:
            # 이름과 이메일만 변경
            cur.execute("""
                UPDATE users 
                SET real_name = %s, email = %s, allowed_ip_list = %s
                WHERE username = %s
            """, (real_name, email, allowed_ip_list or None, username))
        
        if cur.rowcount == 0:
            cur.close()
            conn.close()
            return jsonify({'success': False, 'message': '사용자를 찾을 수 없습니다.'}), 404
        
        conn.commit()
        cur.close()
        conn.close()
        
        # 감사 로그 기록
        log_audit(session.get('username'), 'update', resource=f'사용자: {username}', 
                 details=(
                     f'정보 수정 - 이름: {real_name}, 이메일: {email}'
                     + (f', 허용 IP: {allowed_ip_list}' if allowed_ip_list else ', 허용 IP: 전체 허용')
                     + (' [비밀번호 변경]' if new_password else '')
                 ))
        
        return jsonify({'success': True, 'message': '사용자 정보가 업데이트되었습니다.'})
        
    except Exception as e:
        print(f"❌ 사용자 업데이트 오류: {e}")
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'업데이트 실패: {str(e)}'}), 500


@admin_bp.route('/user/<username>/reset-password', methods=['POST'])
def reset_user_password(username):
    """관리자가 사용자 비밀번호를 기본값으로 초기화"""
    if session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '권한이 없습니다.'}), 403

    target_username = (username or '').strip()
    if not target_username:
        return jsonify({'success': False, 'message': '사용자 ID가 필요합니다.'}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        hashed_password = generate_password_hash(DEFAULT_RESET_PASSWORD)
        cur.execute(
            """
            UPDATE users
            SET password = %s,
                must_change_password = TRUE
            WHERE username = %s
            RETURNING username
            """,
            (hashed_password, target_username),
        )
        updated = cur.fetchone()
        if not updated:
            conn.rollback()
            return jsonify({'success': False, 'message': '사용자를 찾을 수 없습니다.'}), 404

        conn.commit()
        log_audit(
            session.get('username'),
            'update',
            resource=f'사용자: {target_username}',
            details=f'비밀번호 초기화 (기본값 {DEFAULT_RESET_PASSWORD}, 다음 로그인 시 변경 강제)',
        )
        return jsonify({
            'success': True,
            'message': f"사용자 '{target_username}' 비밀번호를 {DEFAULT_RESET_PASSWORD}(으)로 초기화했습니다. 다음 로그인 시 비밀번호 변경이 필요합니다."
        })
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'초기화 실패: {str(e)}'}), 500
    finally:
        cur.close()
        conn.close()


@admin_bp.route('/permission-groups', methods=['GET'])
def get_permission_groups():
    if session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        groups = _load_permission_groups(cur)
        cur.execute(
            """
            SELECT username, COALESCE(real_name, ''), role
            FROM users
            WHERE is_active = TRUE
              AND role IN ('manager', 'user')
            ORDER BY role ASC, username ASC
            """
        )
        users = [
            {'username': username, 'real_name': real_name, 'role': role}
            for username, real_name, role in cur.fetchall()
        ]
        return jsonify({
            'success': True,
            'groups': groups,
            'users': users,
            'category_keys': _get_permission_category_keys(cur),
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        cur.close()
        conn.close()


@admin_bp.route('/permission-groups', methods=['POST'])
def save_permission_group():
    if session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403

    payload = request.get_json(silent=True) or {}
    group_id = payload.get('group_id')
    group_name = str(payload.get('group_name') or '').strip()
    target_role = str(payload.get('target_role') or '').strip().lower()
    description = str(payload.get('description') or '').strip()
    is_active = bool(payload.get('is_active', True))
    permissions = payload.get('permissions') or {}
    assigned_usernames = payload.get('assigned_usernames') or []

    if not group_name:
        return jsonify({'success': False, 'message': '그룹명을 입력해주세요.'}), 400
    if target_role not in {'manager', 'user'}:
        return jsonify({'success': False, 'message': '대상 역할은 manager 또는 user만 가능합니다.'}), 400

    normalized_permissions = {}
    for raw_key, config in permissions.items():
        category_key = _normalize_category_key(raw_key)
        can_view = bool((config or {}).get('can_view'))
        can_edit = bool((config or {}).get('can_edit')) if target_role == 'manager' else False
        normalized_permissions[category_key] = {
            'can_view': can_view,
            'can_edit': can_edit and can_view,
        }

    normalized_usernames = []
    for username in assigned_usernames:
        name = str(username or '').strip()
        if name:
            normalized_usernames.append(name)
    normalized_usernames = sorted(set(normalized_usernames))

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        if group_id:
            cur.execute(
                """
                UPDATE permission_groups
                SET group_name = %s,
                    target_role = %s,
                    description = %s,
                    is_active = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
                RETURNING id
                """,
                (group_name, target_role, description or None, is_active, group_id),
            )
            row = cur.fetchone()
            if not row:
                conn.rollback()
                return jsonify({'success': False, 'message': '대상 그룹을 찾을 수 없습니다.'}), 404
            saved_group_id = row[0]
        else:
            cur.execute(
                """
                INSERT INTO permission_groups (group_name, target_role, description, is_active)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (group_name, target_role, description or None, is_active),
            )
            saved_group_id = cur.fetchone()[0]

        cur.execute("DELETE FROM permission_group_categories WHERE group_id = %s", (saved_group_id,))
        for category_key, config in normalized_permissions.items():
            if not config or not config.get('can_view'):
                continue
            cur.execute(
                """
                INSERT INTO permission_group_categories (group_id, category_key, can_view, can_edit)
                VALUES (%s, %s, %s, %s)
                """,
                (saved_group_id, category_key, True, bool(config.get('can_edit'))),
            )

        cur.execute("DELETE FROM user_permission_groups WHERE group_id = %s", (saved_group_id,))
        if normalized_usernames:
            cur.execute(
                """
                SELECT username, role
                FROM users
                WHERE username = ANY(%s)
                """,
                (normalized_usernames,),
            )
            valid_users = {username: role for username, role in cur.fetchall()}
            for username in normalized_usernames:
                user_role = valid_users.get(username)
                if user_role != target_role:
                    continue
                cur.execute(
                    """
                    INSERT INTO user_permission_groups (username, group_id, assigned_by)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (username, group_id) DO NOTHING
                    """,
                    (username, saved_group_id, session.get('username')),
                )

        conn.commit()
        log_audit(
            session.get('username'),
            'config',
            resource=f'권한그룹: {group_name}',
            details=f'역할={target_role}, 활성={is_active}, 사용자수={len(normalized_usernames)}',
        )
        return jsonify({'success': True, 'message': '그룹/권한 설정이 저장되었습니다.', 'group_id': saved_group_id})
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        cur.close()
        conn.close()


@admin_bp.route('/permission-groups/<int:group_id>', methods=['DELETE'])
def delete_permission_group(group_id):
    if session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT group_name FROM permission_groups WHERE id = %s", (group_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({'success': False, 'message': '대상 그룹을 찾을 수 없습니다.'}), 404
        group_name = row[0]
        cur.execute("DELETE FROM permission_groups WHERE id = %s", (group_id,))
        conn.commit()
        log_audit(session.get('username'), 'delete', resource=f'권한그룹: {group_name}', details='권한 그룹 삭제')
        return jsonify({'success': True, 'message': '그룹이 삭제되었습니다.'})
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        cur.close()
        conn.close()


@admin_bp.route('/add_user', methods=['POST'])
def add_user():
    """신규 유저 추가"""
    if session.get('role') != 'admin':
        flash("권한이 없습니다.", "danger")
        return redirect(url_for('itma.page'))
    
    username = request.form['username']
    password = request.form['password']
    role = request.form['role']
    real_name = request.form.get('real_name', '')
    email = request.form.get('email', '')
    allowed_ip_list = _normalize_allowed_ip_text(request.form.get('allowed_ip_list', ''))
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        settings = _load_security_settings(cur)
        is_valid, error_msg = _validate_password_by_policy(password, settings)
        if not is_valid:
            cur.close()
            conn.close()
            flash(error_msg, "danger")
            return redirect(url_for('admin.settings'))

        is_valid_ip_list, invalid_entries = validate_ip_entries(allowed_ip_list)
        if not is_valid_ip_list:
            cur.close()
            conn.close()
            invalid_text = ', '.join(invalid_entries)
            flash(f'허용 IP 형식이 올바르지 않습니다: {invalid_text}', "danger")
            return redirect(url_for('admin.settings'))

        hashed_password = generate_password_hash(password)

        cur.execute("""
            INSERT INTO users (username, password, role, real_name, email, allowed_ip_list, is_active, must_change_password)
            VALUES (%s, %s, %s, %s, %s, %s, TRUE, TRUE)
        """, (username, hashed_password, role, real_name, email, allowed_ip_list or None))
        conn.commit()
        
        # 환영 이메일 발송 (이메일이 있는 경우)
        if email and '@' in email:
            try:
                # 템플릿 조회
                cur.execute("""
                    SELECT subject, body 
                    FROM email_templates 
                    WHERE template_type = 'welcome_new_user' AND is_active = TRUE
                    LIMIT 1
                """)
                template = cur.fetchone()
                
                if template:
                    subject_template, body_template = template
                    # 플레이스홀더 치환
                    variables = {
                        'real_name': real_name or username,
                        'username': username,
                        'password': password,
                        'role': role
                    }
                    subject = replace_template_variables(subject_template, variables)
                    body = replace_template_variables(body_template, variables)
                else:
                    # 템플릿이 없을 경우 기본 메시지
                    subject = "[자산 관리 시스템] 계정이 생성되었습니다"
                    body = f"""
안녕하세요 {real_name or username}님,

자산 관리 시스템 계정이 생성되었습니다.

【 계정 정보 】
사용자 ID: {username}
초기 비밀번호: {password}
권한: {role}

로그인 후 반드시 비밀번호를 변경해주시기 바랍니다.

감사합니다.
자산 관리 시스템
"""
                
                result = send_email(email, subject, body)
                if result.get('success'):
                    print(f"✓ 환영 이메일 발송 성공: {email}")
            except Exception as email_error:
                print(f"❌ 이메일 발송 실패: {email_error}")
                # 이메일 실패해도 계정 생성은 성공으로 처리
        
        cur.close()
        conn.close()
        
        # 감사 로그 기록
        log_audit(session.get('username'), 'create', resource=f'사용자: {username}', 
                 details=f'역할: {role}, 이름: {real_name}' + (f', 허용 IP: {allowed_ip_list}' if allowed_ip_list else ''))
        
        flash(f"사용자 '{username}'이(가) 성공적으로 추가되었습니다.", "success")
    except Exception as e:
        flash(f"사용자 추가 실패: {str(e)}", "danger")
    
    return redirect(url_for('admin.settings'))


@admin_bp.route('/download_bulk_user_template')
def download_bulk_user_template():
    """대규모 사용자 등록용 엑셀 템플릿 다운로드"""
    if session.get('role') != 'admin':
        abort(403)
    
    try:
        from flask import send_file
        
        # 엑셀 워크북 생성
        wb = Workbook()
        ws = wb.active
        ws.title = "사용자 목록"
        
        # 헤더 작성
        headers = ['username', 'real_name', 'password', 'role', 'email']
        ws.append(headers)
        
        # 스타일 적용
        from openpyxl.styles import Font, PatternFill, Alignment
        
        header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
        header_font = Font(bold=True, color="FFFFFF")
        
        for col_num, header in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col_num)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")
        
        # 예시 데이터 추가
        examples = [
            ['user01', '홍길동', 'password123', 'user', 'user01@example.com'],
            ['manager01', '김철수', 'manager456', 'manager', 'manager01@example.com'],
            ['admin01', '이영희', 'admin789', 'admin', '']
        ]
        
        for example in examples:
            ws.append(example)
        
        # 컬럼 너비 자동 조정
        for col in ws.columns:
            max_length = 0
            column = col[0].column_letter
            for cell in col:
                try:
                    if len(str(cell.value)) > max_length:
                        max_length = len(str(cell.value))
                except:
                    pass
            adjusted_width = max_length + 2
            ws.column_dimensions[column].width = adjusted_width
        
        # 메모리에 저장
        output = BytesIO()
        wb.save(output)
        output.seek(0)
        
        return send_file(
            output,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name='templates_add_users.xlsx'
        )
        
    except Exception as e:
        print(f"❌ 템플릿 다운로드 오류: {e}")
        traceback.print_exc()
        flash('템플릿 다운로드에 실패했습니다.', 'danger')
        return redirect(url_for('admin.settings'))


@admin_bp.route('/bulk_add_users', methods=['POST'])
def bulk_add_users():
    """엑셀 파일을 통한 대규모 사용자 일괄 등록"""
    if session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '권한이 없습니다.'}), 403
    
    try:
        # 파일 확인
        if 'file' not in request.files:
            return jsonify({'success': False, 'message': '파일이 없습니다.'}), 400
        
        file = request.files['file']
        send_email_flag = request.form.get('send_email', 'false') == 'true'
        
        if file.filename == '':
            return jsonify({'success': False, 'message': '파일이 선택되지 않았습니다.'}), 400
        
        # 파일 확장자 확인
        allowed_extensions = {'xlsx', 'xls', 'csv'}
        file_ext = file.filename.rsplit('.', 1)[-1].lower()
        
        if file_ext not in allowed_extensions:
            return jsonify({'success': False, 'message': '지원하지 않는 파일 형식입니다.'}), 400
        
        # 엑셀 파일 읽기
        try:
            if file_ext == 'csv':
                df = pd.read_csv(file, encoding='utf-8-sig')
            else:
                df = pd.read_excel(file)
        except Exception as read_error:
            return jsonify({'success': False, 'message': f'파일 읽기 실패: {str(read_error)}'}), 400
        
        # 필수 컬럼 확인
        required_columns = ['username', 'real_name', 'password', 'role']
        missing_columns = [col for col in required_columns if col not in df.columns]
        
        if missing_columns:
            return jsonify({
                'success': False, 
                'message': f'필수 컬럼이 없습니다: {", ".join(missing_columns)}'
            }), 400
        
        # 데이터 처리
        conn = get_db_connection()
        cur = conn.cursor()
        settings = _load_security_settings(cur)
        
        added_count = 0
        failed_count = 0
        skipped_count = 0
        email_sent_count = 0
        
        failed_details = []
        skipped_users = []
        
        # 최대 처리 건수 제한
        max_rows = 500
        if len(df) > max_rows:
            return jsonify({
                'success': False,
                'message': f'최대 {max_rows}명까지 한 번에 등록할 수 있습니다. (현재: {len(df)}명)'
            }), 400
        
        # 이메일 템플릿 미리 조회 (성능 최적화)
        email_subject_template = None
        email_body_template = None
        if send_email_flag:
            try:
                cur.execute("""
                    SELECT subject, body 
                    FROM email_templates 
                    WHERE template_type = 'welcome_new_user' AND is_active = TRUE
                    LIMIT 1
                """)
                template = cur.fetchone()
                if template:
                    email_subject_template, email_body_template = template
            except Exception as template_error:
                print(f"⚠️ 템플릿 조회 실패: {template_error}")
        
        for index, row in df.iterrows():
            row_num = index + 2  # 엑셀 행 번호 (헤더 포함)
            
            try:
                username = str(row['username']).strip()
                real_name = str(row['real_name']).strip()
                password = str(row['password']).strip()
                role = str(row['role']).strip().lower()
                email = str(row.get('email', '')).strip() if 'email' in row and pd.notna(row.get('email')) else ''
                
                # 데이터 검증
                if not username or username == 'nan':
                    failed_details.append({
                        'row': row_num,
                        'username': username,
                        'error': '사용자 ID가 비어있습니다'
                    })
                    failed_count += 1
                    continue
                
                if not real_name or real_name == 'nan':
                    failed_details.append({
                        'row': row_num,
                        'username': username,
                        'error': '이름이 비어있습니다'
                    })
                    failed_count += 1
                    continue
                
                if not password or password == 'nan':
                    failed_details.append({
                        'row': row_num,
                        'username': username,
                        'error': '비밀번호가 비어있습니다'
                    })
                    failed_count += 1
                    continue

                is_valid, error_msg = _validate_password_by_policy(password, settings)
                if not is_valid:
                    failed_details.append({
                        'row': row_num,
                        'username': username,
                        'error': error_msg
                    })
                    failed_count += 1
                    continue
                
                if role not in ['user', 'manager', 'admin']:
                    failed_details.append({
                        'row': row_num,
                        'username': username,
                        'error': f'잘못된 권한: {role} (user, manager, admin 중 선택)'
                    })
                    failed_count += 1
                    continue
                
                # 중복 확인
                cur.execute("SELECT username FROM users WHERE username = %s", (username,))
                if cur.fetchone():
                    skipped_users.append(username)
                    skipped_count += 1
                    continue
                
                # 이메일 검증 (있는 경우만)
                if email and email != 'nan':
                    email_regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
                    if not re.match(email_regex, email):
                        email = ''  # 잘못된 이메일은 빈 값으로
                
                # 비밀번호 해싱
                hashed_password = generate_password_hash(password)
                
                # 사용자 등록
                cur.execute("""
                    INSERT INTO users (username, password, role, real_name, email, is_active, must_change_password)
                    VALUES (%s, %s, %s, %s, %s, TRUE, TRUE)
                """, (username, hashed_password, role, real_name, email if email != 'nan' else None))
                
                added_count += 1
                
                # 환영 이메일 발송 (옵션이 활성화되고 이메일이 있는 경우)
                if send_email_flag and email and email != 'nan':
                    try:
                        # 미리 조회한 템플릿 사용
                        if email_subject_template and email_body_template:
                            # 플레이스홀더 치환
                            variables = {
                                'real_name': real_name or username,
                                'username': username,
                                'password': password,
                                'role': role
                            }
                            subject = replace_template_variables(email_subject_template, variables)
                            body = replace_template_variables(email_body_template, variables)
                        else:
                            # 템플릿이 없을 경우 기본 메시지
                            subject = "[자산 관리 시스템] 계정이 생성되었습니다"
                            body = f"""
안녕하세요 {real_name or username}님,

자산 관리 시스템 계정이 생성되었습니다.

【 계정 정보 】
사용자 ID: {username}
초기 비밀번호: {password}
권한: {role}

로그인 후 반드시 비밀번호를 변경해주시기 바랍니다.

감사합니다.
자산 관리 시스템
"""
                        
                        result = send_email(email, subject, body)
                        if result.get('success'):
                            email_sent_count += 1
                    except:
                        pass  # 이메일 발송 실패해도 계속 진행
                
            except Exception as row_error:
                failed_details.append({
                    'row': row_num,
                    'username': username if 'username' in locals() else '알 수 없음',
                    'error': str(row_error)
                })
                failed_count += 1
                continue
        
        # 커밋
        conn.commit()
        cur.close()
        conn.close()
        
        # 감사 로그 기록
        log_audit(
            username=session.get('username'),
            action='bulk_create',
            resource='users',
            details=f'일괄 등록 - 성공: {added_count}, 실패: {failed_count}, 중복: {skipped_count}'
        )
        
        return jsonify({
            'success': True,
            'total_count': len(df),
            'added_count': added_count,
            'failed_count': failed_count,
            'skipped_count': skipped_count,
            'email_sent_count': email_sent_count,
            'failed_details': failed_details,
            'skipped_users': skipped_users
        })
        
    except Exception as e:
        print(f"❌ 일괄 등록 오류: {e}")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'일괄 등록 실패: {str(e)}'
        }), 500


@admin_bp.route('/update_security_settings', methods=['POST'])
def update_security_settings():
    """보안 설정 저장"""
    if session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '권한이 없습니다.'}), 403
    
    try:
        data = request.get_json() or {}
        setting_type = data.get('setting_type')
        if not setting_type:
            return jsonify({'success': False, 'message': '설정 유형이 필요합니다.'}), 400
        
        conn = get_db_connection()
        cur = conn.cursor()
        _ensure_security_settings_table(cur)
        
        if setting_type == 'password':
            settings = {
                'password_min_length': data.get('min_length', 8),
                'password_require_uppercase': data.get('require_uppercase', True),
                'password_require_lowercase': data.get('require_lowercase', True),
                'password_require_number': data.get('require_number', True),
                'password_require_special': data.get('require_special', True),
                'password_expiry_days': data.get('expiry_days', 0)
            }
        elif setting_type == 'session':
            settings = {
                'session_timeout_minutes': data.get('timeout_minutes', 10),
                'session_absolute_timeout_hours': data.get('absolute_timeout_hours', 8),
                'session_warn_before_timeout': data.get('warn_before_timeout', True),
                'concurrent_sessions': data.get('concurrent_sessions', 3),
                'remember_me': data.get('remember_me', True),
                'auto_cleanup': data.get('auto_cleanup', True),
            }
        elif setting_type == 'login_attempt_limit':
            settings = {
                'login_max_attempts': data.get('max_attempts', 5),
                'login_lockout_duration_minutes': data.get('lockout_duration', 15),
                'login_time_window_minutes': data.get('time_window', 10),
                'enable_failed_login_alert': data.get('enable_failed_login_alert', False),
                'failed_login_alert_threshold': data.get('failed_login_alert_threshold', data.get('max_attempts', 5)),
                'failed_login_alert_include_admin': data.get('failed_login_alert_include_admin', True),
                'failed_login_alert_include_attempt_user': data.get('failed_login_alert_include_attempt_user', True),
                'failed_login_alert_custom_recipients': data.get('failed_login_alert_custom_recipients', ''),
                'failed_login_alert_template_id': data.get('failed_login_alert_template_id', ''),
            }
        elif setting_type == 'ip_filter':
            settings = {
                'ip_filter_type': data.get('filter_type', 'blacklist'),
                'ip_filter_list': data.get('ip_list', ''),
                'ip_filter_enabled': data.get('enabled', False)
            }
        else:
            cur.close()
            conn.close()
            return jsonify({'success': False, 'message': '알 수 없는 설정 유형입니다.'}), 400
        
        # 각 설정을 DB에 저장 (UPSERT 방식)
        for key, value in settings.items():
            cur.execute("""
                INSERT INTO security_settings (setting_key, setting_value, created_at, updated_at)
                VALUES (%s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (setting_key)
                DO UPDATE SET
                    setting_value = EXCLUDED.setting_value,
                    updated_at = CURRENT_TIMESTAMP
            """, (key, str(value)))
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({'success': True, 'message': f'{setting_type} 설정이 저장되었습니다.'})
    
    except Exception as e:
        print(f"Security settings error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'success': False, 'message': f'설정 저장 실패: {str(e)}'})


@admin_bp.route('/get_security_settings', methods=['GET'])
def get_security_settings():
    """보안 설정 조회"""
    if session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '권한이 없습니다.'}), 403

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        _ensure_security_settings_table(cur)
        raw = _load_security_settings(cur)
        cur.close()
        conn.close()

        settings = {
            'password_min_length': _to_int(raw.get('password_min_length'), 8),
            'password_require_uppercase': _to_bool(raw.get('password_require_uppercase'), True),
            'password_require_lowercase': _to_bool(raw.get('password_require_lowercase'), True),
            'password_require_number': _to_bool(raw.get('password_require_number'), True),
            'password_require_special': _to_bool(raw.get('password_require_special'), True),
            'password_expiry_days': _to_int(raw.get('password_expiry_days'), 0),
            'session_timeout_minutes': _to_int(raw.get('session_timeout_minutes'), 10),
            'session_absolute_timeout_hours': _to_int(raw.get('session_absolute_timeout_hours'), 8),
            'session_warn_before_timeout': _to_bool(raw.get('session_warn_before_timeout'), True),
            'login_max_attempts': _to_int(raw.get('login_max_attempts'), 5),
            'login_lockout_duration_minutes': _to_int(raw.get('login_lockout_duration_minutes'), 15),
            'login_time_window_minutes': _to_int(raw.get('login_time_window_minutes'), 10),
            'enable_failed_login_alert': _to_bool(raw.get('enable_failed_login_alert'), False),
            'failed_login_alert_threshold': _to_int(raw.get('failed_login_alert_threshold'), _to_int(raw.get('login_max_attempts'), 5)),
            'failed_login_alert_include_admin': _to_bool(raw.get('failed_login_alert_include_admin'), True),
            'failed_login_alert_include_attempt_user': _to_bool(raw.get('failed_login_alert_include_attempt_user'), True),
            'failed_login_alert_custom_recipients': (raw.get('failed_login_alert_custom_recipients') or ''),
            'failed_login_alert_template_id': _to_int(raw.get('failed_login_alert_template_id'), 0),
            'ip_filter_type': (raw.get('ip_filter_type') or 'blacklist'),
            'ip_filter_list': (raw.get('ip_filter_list') or ''),
            'ip_filter_enabled': _to_bool(raw.get('ip_filter_enabled'), False),
            'ip_binding': _to_bool(raw.get('ip_binding'), False),
            'force_logout_on_password_change': _to_bool(raw.get('force_logout_on_password_change'), True),
            'suspicious_activity_detection': (raw.get('suspicious_activity_detection') or 'alert'),
            'concurrent_sessions': _to_int(raw.get('concurrent_sessions'), 3),
            'remember_me': _to_bool(raw.get('remember_me'), True),
            'auto_cleanup': _to_bool(raw.get('auto_cleanup'), True),
        }
        return jsonify({'success': True, 'settings': settings})
    except Exception as e:
        print(f"Security settings get error: {str(e)}")
        return jsonify({'success': False, 'message': f'설정 조회 실패: {str(e)}'}), 500


@admin_bp.route('/web_server/update', methods=['POST'])
def update_web_server():
    """ 웹 서버 설정 업데이트 """
    if session.get('role') != 'admin':
        abort(403)

    try:
        data = request.get_json() or {}
        server_name = data.get('server_name', '').strip()
        url_scheme = data.get('url_scheme', 'http').strip()
        allowed_extensions = data.get('allowed_extensions', '').strip()
        max_file_size = data.get('max_file_size', '100').strip()
        ssl_cert_path = data.get('ssl_cert_path', '').strip()
        ssl_key_path = data.get('ssl_key_path', '').strip()
        force_https_redirect = str(data.get('force_https_redirect', False)).strip().lower()

        if url_scheme not in ['http', 'https']:
            return jsonify({'success': False, 'message': 'URL 프로토콜은 http 또는 https만 가능합니다.'})

        if force_https_redirect not in ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off']:
            return jsonify({'success': False, 'message': 'HTTPS 강제 리다이렉트 값이 올바르지 않습니다.'})
        force_https_redirect = 'true' if force_https_redirect in ['true', '1', 'yes', 'on'] else 'false'

        if url_scheme == 'https':
            if not ssl_cert_path or not ssl_key_path:
                return jsonify({'success': False, 'message': 'HTTPS를 사용하려면 SSL 인증서와 키 파일이 필요합니다.'})
            if not os.path.isfile(ssl_cert_path):
                return jsonify({'success': False, 'message': 'SSL 인증서 파일이 존재하지 않습니다. 경로를 확인하세요    .'})
            if not os.path.isfile(ssl_key_path):
                return jsonify({'success': False, 'message': 'SSL 키 파일이 존재하지 않습니다. 경로를 확인하세요.'})

        if not allowed_extensions:
            return jsonify({'success': False, 'message': '허용된 파일 확장자가 없습니다.'})

        try:
            max_size = int(max_file_size)
            if max_size < 1 or max_size > 1000:
                return jsonify({'success': False, 'message': '최대 파일 크기는 1-1000 MB 사이여야 합니다.'})
        except ValueError:
            return jsonify({'success': False, 'message': '최대 파일 크기는 숫자여야 합니다.'})

        conn = get_db_connection()
        cur = conn.cursor()

        settings = [
            ('server_name', server_name),
            ('url_scheme', url_scheme),
            ('allowed_extensions', allowed_extensions),
            ('max_file_size', max_file_size),
            ('ssl_cert_path', ssl_cert_path),
            ('ssl_key_path', ssl_key_path),
            ('force_https_redirect', force_https_redirect),
        ]

        for key, value in settings:
            cur.execute(
                """
                INSERT INTO system_settings (setting_key, setting_value, created_at, updated_at)
                VALUES (%s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (setting_key)
                DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP
                """,
                (key, value),
            )

        conn.commit()
        cur.close()
        conn.close()

        log_audit(
            session.get('username'),
            'config',
            resource='웹 서버 설정',
            details=(
                f'서버 이름: {server_name}, URL 프로토콜: {url_scheme}, 최대 파일 크기: {max_file_size}MB, '
                f'SSL cert: {ssl_cert_path or "-"}, SSL key: {ssl_key_path or "-"}, '
                f'force https: {force_https_redirect}'
            ),
        )

        return jsonify({'success': True, 'message': '웹 서버 설정이 업데이트되었습니다. 변경 사항이 적용되었습니다.'})

    except Exception as e:
        print(f"웹 서버 설정 업데이트 실패: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'success': False, 'message': f'웹 서버 설정 업데이트 실패: {str(e)}'})


# ==================== 데이터베이스 백업 관리 ====================

def _get_db_backup_params():
    """Return DB connection params for pg_dump/psql."""
    return {
        'host': os.environ.get('DB_HOST', 'db'),
        'port': os.environ.get('DB_PORT', '5432'),
        'name': os.environ.get('DB_NAME', 'itma_db'),
        'user': os.environ.get('DB_USER', 'jininfra'),
        'password': os.environ.get('DB_PASSWORD', '')
    }


def _get_pg_tool_versions():
    """Return pg_dump/psql versions if available."""
    import subprocess

    def _run(cmd):
        try:
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                return result.stdout.strip() or result.stderr.strip()
            return result.stderr.strip() or 'not found'
        except FileNotFoundError:
            return 'not found'

    return {
        'pg_dump': _run(['pg_dump', '--version']),
        'psql': _run(['psql', '--version'])
    }



SSL_UPLOAD_DIR = os.path.join('infra', 'nginx', 'ssl')


def _ensure_ssl_upload_dir():
    os.makedirs(SSL_UPLOAD_DIR, exist_ok=True)
    return SSL_UPLOAD_DIR


def _is_allowed_ssl_filename(filename, file_type):
    ext = os.path.splitext(filename or '')[1].lower()
    cert_exts = {'.pem', '.crt', '.cer'}
    key_exts = {'.key', '.pem'}
    if file_type == 'cert':
        return ext in cert_exts
    if file_type == 'key':
        return ext in key_exts
    return False


def _upsert_system_setting(cur, key, value):
    cur.execute(
        """
        INSERT INTO system_settings (setting_key, setting_value, created_at, updated_at)
        VALUES (%s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (setting_key)
        DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP
        """,
        (key, value),
    )


@admin_bp.route('/web_server/upload_ssl', methods=['POST'])
def upload_ssl_files():
    """Upload SSL cert/key files and persist their paths."""
    if session.get('role') != 'admin':
        abort(403)

    try:
        cert_file = request.files.get('ssl_cert_file')
        key_file = request.files.get('ssl_key_file')

        has_cert = cert_file and cert_file.filename
        has_key = key_file and key_file.filename
        if not has_cert and not has_key:
            return jsonify({'success': False, 'message': 'SSL 인증서 또는 키 파일이 필요합니다.'}), 400

        upload_dir = _ensure_ssl_upload_dir()
        conn = get_db_connection()
        cur = conn.cursor()

        uploaded_cert_path = None
        uploaded_key_path = None
        if has_cert:
            if not _is_allowed_ssl_filename(cert_file.filename, 'cert'):
                cur.close()
                conn.close()
                return jsonify({'success': False, 'message': '허용되지 않는 SSL 인증서 파일 형식입니다. .pem/.crt/.cer 파일만 업로드 가능합니다.'}), 400
            cert_path = os.path.join(upload_dir, 'fullchain.pem')
            cert_file.save(cert_path)
            uploaded_cert_path = cert_path.replace('\\', '/')
            _upsert_system_setting(cur, 'ssl_cert_path', uploaded_cert_path)

        if has_key:
            if not _is_allowed_ssl_filename(key_file.filename, 'key'):
                cur.close()
                conn.close()
                return jsonify({'success': False, 'message': '허용되지 않는 SSL 키 파일 형식입니다. .key/.pem 파일만 업로드 가능합니다.'}), 400
            key_path = os.path.join(upload_dir, 'privkey.pem')
            key_file.save(key_path)
            uploaded_key_path = key_path.replace('\\', '/')
            _upsert_system_setting(cur, 'ssl_key_path', uploaded_key_path)

        conn.commit()
        cur.close()
        conn.close()

        log_audit(
            session.get('username'),
            'config',
            resource='SSL 설정',
            details=f'SSL 인증서 업로드(cert={uploaded_cert_path or "-"}, key={uploaded_key_path or "-"})',
        )

        return jsonify({
            'success': True,
            'message': 'SSL 인증서가 성공적으로 업로드되었습니다.',
            'cert_path': uploaded_cert_path,
            'key_path': uploaded_key_path,
        })
    except Exception as e:
        print(f'SSL 인증서 업로드 오류: {str(e)}')
        print(traceback.format_exc())
        return jsonify({'success': False, 'message': f'SSL 인증서 업로드 실패: {str(e)}'}), 500

@admin_bp.route('/backup/create', methods=['POST'])
def create_backup():
    """데이터베이스 백업 생성"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        import subprocess
        import os
        from datetime import datetime
        
        data = request.get_json()
        description = data.get('description', '')
        
        # 백업 디렉토리 생성
        backup_dir = 'backups'
        if not os.path.exists(backup_dir):
            os.makedirs(backup_dir)
        
        # 백업 파일명 생성
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_filename = f'backup_{timestamp}.sql'
        backup_path = os.path.join(backup_dir, backup_filename)
        
        params = _get_db_backup_params()
        pg_dump_cmd = [
            'pg_dump',
            '-h', params['host'],
            '-p', params['port'],
            '-U', params['user'],
            '-d', params['name']
        ]

        env = os.environ.copy()
        if params['password']:
            env['PGPASSWORD'] = params['password']

        result = subprocess.run(pg_dump_cmd, capture_output=True, text=True, env=env)
        
        if result.returncode != 0:
            return jsonify({'success': False, 'message': f'백업 실패: {result.stderr.strip()}'})

        # Only write file after a successful dump to avoid empty files.
        with open(backup_path, 'w', encoding='utf-8') as f:
            f.write(result.stdout)
        
        # 백업 정보를 데이터베이스에 저장
        conn = get_db_connection()
        cur = conn.cursor()
        file_size = os.path.getsize(backup_path)
        
        cur.execute("""
            INSERT INTO backup_history (filename, description, file_size, created_by, created_at)
            VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)
        """, (backup_filename, description, file_size, session['username']))
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({'success': True, 'message': '백업이 생성되었습니다.', 'filename': backup_filename})
    
    except Exception as e:
        try:
            if 'backup_path' in locals() and os.path.exists(backup_path) and os.path.getsize(backup_path) == 0:
                os.remove(backup_path)
        except Exception:
            pass
        print(f"백업 생성 오류: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'success': False, 'message': f'백업 생성 실패: {str(e)}'})


@admin_bp.route('/backup/list', methods=['GET'])
def list_backups():
    """백업 목록 조회"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        import os
        
        backup_dir = 'backups'
        if not os.path.exists(backup_dir):
            return jsonify({'success': True, 'backups': []})
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("""
            SELECT filename, description, file_size, created_at
            FROM backup_history
            ORDER BY created_at DESC
        """)
        
        backups = []
        for row in cur.fetchall():
            filename, description, file_size, created_at = row
            backups.append({
                'filename': filename,
                'description': description,
                'size': file_size,
                'date': created_at.strftime('%Y-%m-%d %H:%M:%S')
            })
        
        cur.close()
        conn.close()
        
        return jsonify({'success': True, 'backups': backups})
    
    except Exception as e:
        print(f"백업 목록 조회 오류: {str(e)}")
        return jsonify({'success': False, 'message': f'백업 목록 조회 실패: {str(e)}'})


@admin_bp.route('/backup/tools', methods=['GET'])
def backup_tools():
    """Check pg_dump/psql availability."""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403

    try:
        tools = _get_pg_tool_versions()
        return jsonify({'success': True, 'tools': tools})
    except Exception as e:
        return jsonify({'success': False, 'message': f'도구 확인 실패: {str(e)}'})


@admin_bp.route('/backup/download/<filename>', methods=['GET'])
def download_backup(filename):
    """백업 파일 다운로드"""
    if 'username' not in session or session.get('role') != 'admin':
        abort(403)
    
    try:
        import os
        from flask import send_file
        
        backup_path = os.path.join('backups', filename)
        if not os.path.exists(backup_path):
            abort(404)
        
        return send_file(backup_path, as_attachment=True, download_name=filename)
    
    except Exception as e:
        print(f"백업 다운로드 오류: {str(e)}")
        abort(500)


@admin_bp.route('/backup/delete/<filename>', methods=['DELETE'])
def delete_backup(filename):
    """백업 파일 삭제"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        import os
        
        backup_path = os.path.join('backups', filename)
        if os.path.exists(backup_path):
            os.remove(backup_path)
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("DELETE FROM backup_history WHERE filename = %s", (filename,))
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({'success': True, 'message': '백업 파일이 삭제되었습니다.'})
    
    except Exception as e:
        print(f"백업 삭제 오류: {str(e)}")
        return jsonify({'success': False, 'message': f'백업 삭제 실패: {str(e)}'})


@admin_bp.route('/backup/restore', methods=['POST'])
def restore_backup():
    """데이터베이스 복원"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403

    temp_path = 'temp_restore.sql'
    sanitized_path = None
    combined_path = None
    try:
        import subprocess

        file = request.files.get('file')
        if not file:
            return jsonify({'success': False, 'message': '파일을 선택해주세요.'})
        clear_before_restore = str(request.form.get('clear_before_restore', 'true')).lower() == 'true'

        # 임시 파일로 저장
        file.save(temp_path)

        # pg_dump 버전 차이로 생성된 미지원 설정문 제거 (예: PG16+ -> PG15 복원)
        restore_source_path = temp_path
        unsupported_set_patterns = [
            re.compile(r'^\s*SET\s+transaction_timeout\s*=.*;\s*$', re.IGNORECASE),
        ]
        try:
            sanitized_path = f'{temp_path}.sanitized'
            changed = False
            with open(temp_path, 'r', encoding='utf-8', errors='ignore') as src, open(sanitized_path, 'w', encoding='utf-8') as dst:
                for line in src:
                    if any(p.match(line) for p in unsupported_set_patterns):
                        changed = True
                        continue
                    dst.write(line)
            if changed:
                restore_source_path = sanitized_path
        except Exception:
            # 정제 실패 시 원본으로 진행
            restore_source_path = temp_path

        params = _get_db_backup_params()
        restore_cmd = [
            'psql',
            '-h', params['host'],
            '-p', params['port'],
            '-U', params['user'],
            '-d', params['name'],
            '-v', 'ON_ERROR_STOP=1',
            '-1'
        ]

        env = os.environ.copy()
        if params['password']:
            env['PGPASSWORD'] = params['password']

        restore_input_path = restore_source_path
        if clear_before_restore:
            # 스키마 초기화 + 복원을 단일 트랜잭션(-1)으로 수행하여 실패 시 롤백되도록 함
            combined_path = f'{temp_path}.combined'
            with open(combined_path, 'w', encoding='utf-8') as out_file:
                out_file.write('DROP SCHEMA IF EXISTS public CASCADE;\n')
                out_file.write('CREATE SCHEMA public;\n')
                with open(restore_source_path, 'r', encoding='utf-8', errors='ignore') as in_file:
                    for line in in_file:
                        out_file.write(line)
            restore_input_path = combined_path

        with open(restore_input_path, 'r', encoding='utf-8', errors='ignore') as restore_file:
            result = subprocess.run(
                restore_cmd,
                stdin=restore_file,
                capture_output=True,
                text=True,
                env=env
            )

        if result.returncode != 0:
            err = (result.stderr or result.stdout or '').strip()
            return jsonify({'success': False, 'message': f'복원 실패: {err}'})

        return jsonify({'success': True, 'message': '데이터베이스가 성공적으로 복원되었습니다.'})

    except Exception as e:
        print(f"복원 오류: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'success': False, 'message': f'복원 오류: {str(e)}'})
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        if sanitized_path and os.path.exists(sanitized_path):
            os.remove(sanitized_path)
        if combined_path and os.path.exists(combined_path):
            os.remove(combined_path)


@admin_bp.route('/backup/settings', methods=['GET', 'POST'])
def backup_settings():
    """자동 백업 설정"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        if request.method == 'POST':
            data = request.get_json()
            
            conn = get_db_connection()
            cur = conn.cursor()
            
            cur.execute("""
                INSERT INTO system_settings (setting_key, setting_value)
                VALUES 
                    ('auto_backup_enabled', %s),
                    ('backup_frequency', %s),
                    ('max_backups', %s)
                ON CONFLICT (setting_key) 
                DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP
            """, (
                str(data.get('enabled', False)),
                data.get('frequency', 'daily'),
                str(data.get('max_backups', 10))
            ))
            
            conn.commit()
            cur.close()
            conn.close()
            
            return jsonify({'success': True, 'message': '자동 백업 설정이 저장되었습니다.'})
        
        else:  # GET
            conn = get_db_connection()
            cur = conn.cursor()
            
            cur.execute("""
                SELECT setting_key, setting_value 
                FROM system_settings 
                WHERE setting_key IN ('auto_backup_enabled', 'backup_frequency', 'max_backups')
            """)
            
            settings = {row[0]: row[1] for row in cur.fetchall()}
            cur.close()
            conn.close()
            
            return jsonify({'success': True, 'settings': settings})
    
    except Exception as e:
        print(f"백업 설정 오류: {str(e)}")
        return jsonify({'success': False, 'message': f'설정 처리 실패: {str(e)}'})


# ==================== 시스템 상태 모니터링 ====================

@admin_bp.route('/system/status', methods=['GET'])
def system_status():
    """시스템 상태 조회"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        import psutil
        import shutil
        from datetime import datetime, timedelta
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        # 데이터베이스 상태
        db_connected = True
        try:
            cur.execute("SELECT version()")
            db_version = cur.fetchone()[0]
        except:
            db_connected = False
            db_version = 'Unknown'
        
        params = _get_db_backup_params()
        db_name = params.get('name') or 'itma_db'

        # 데이터베이스 크기
        try:
            cur.execute("SELECT pg_size_pretty(pg_database_size(%s))", (db_name,))
            db_size = cur.fetchone()[0]
        except:
            db_size = 'Unknown'
        
        # 활성 연결 수
        try:
            cur.execute("SELECT count(*) FROM pg_stat_activity WHERE datname = %s", (db_name,))
            active_connections = cur.fetchone()[0]
        except:
            active_connections = 0
        
        # 테이블 수
        try:
            cur.execute("""
                SELECT count(*) FROM information_schema.tables 
                WHERE table_schema = 'public'
            """)
            table_count = cur.fetchone()[0]
        except:
            table_count = 0
        
        # 마지막 백업
        try:
            cur.execute("SELECT created_at FROM backup_history ORDER BY created_at DESC LIMIT 1")
            last_backup_row = cur.fetchone()
            last_backup = last_backup_row[0].strftime('%Y-%m-%d %H:%M:%S') if last_backup_row else '없음'
        except:
            last_backup = '없음'
        
        cur.close()
        conn.close()
        
        # 디스크 사용량
        disk = shutil.disk_usage('/')
        disk_usage_percent = int((disk.used / disk.total) * 100)
        
        # 메모리 사용량
        memory = psutil.virtual_memory()
        memory_usage_percent = int(memory.percent)
        
        # uploads 폴더 크기
        uploads_dir = 'uploads'
        uploads_size = 0
        if os.path.exists(uploads_dir):
            for dirpath, dirnames, filenames in os.walk(uploads_dir):
                for filename in filenames:
                    filepath = os.path.join(dirpath, filename)
                    if os.path.exists(filepath):
                        uploads_size += os.path.getsize(filepath)
        
        uploads_size_mb = uploads_size / (1024 * 1024)  # MB
        uploads_limit_gb = 10  # 기본 10GB
        uploads_usage_percent = int((uploads_size_mb / (uploads_limit_gb * 1024)) * 100)
        
        # 서버 가동 시간
        boot_time = datetime.fromtimestamp(psutil.boot_time())
        uptime = datetime.now() - boot_time
        uptime_str = f"{uptime.days}일 {uptime.seconds // 3600}시간"
        
        return jsonify({
            'success': True,
            'status': {
                'database': 'connected' if db_connected else 'disconnected',
                'disk_usage': disk_usage_percent,
                'memory_usage': memory_usage_percent,
                'uptime': uptime_str
            },
            'database': {
                'connected': db_connected,
                'version': db_version,
                'size': db_size,
                'active_connections': active_connections,
                'table_count': table_count,
                'last_backup': last_backup
            },
            'resources': {
                'disk_usage': disk_usage_percent,
                'disk_used': f"{disk.used / (1024**3):.1f} GB",
                'disk_total': f"{disk.total / (1024**3):.1f} GB",
                'uploads_usage': uploads_usage_percent,
                'uploads_used': f"{uploads_size_mb:.1f} MB",
                'uploads_limit': f"{uploads_limit_gb} GB",
                'uptime': uptime_str
            }
        })
    
    except Exception as e:
        print(f"시스템 상태 조회 오류: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'success': False, 'message': f'상태 조회 실패: {str(e)}'})


@admin_bp.route('/system/db_test', methods=['GET'])
def test_db_connection():
    """데이터베이스 연결 테스트"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        import time
        
        start_time = time.time()
        
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT 1")
        result = cur.fetchone()
        cur.close()
        conn.close()
        
        response_time = int((time.time() - start_time) * 1000)  # ms
        
        if result and result[0] == 1:
            return jsonify({'success': True, 'response_time': response_time})
        else:
            return jsonify({'success': False, 'message': '연결 테스트 실패'})
    
    except Exception as e:
        print(f"DB 연결 테스트 오류: {str(e)}")
        return jsonify({'success': False, 'message': str(e)})


@admin_bp.route('/system/thresholds', methods=['POST'])
def save_thresholds():
    """알림 임계값 저장"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        data = request.get_json()
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("""
            INSERT INTO system_settings (setting_key, setting_value)
            VALUES 
                ('disk_warning_threshold', %s),
                ('disk_danger_threshold', %s),
                ('db_connection_threshold', %s),
                ('uploads_limit_threshold', %s)
            ON CONFLICT (setting_key) 
            DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP
        """, (
            str(data.get('disk_warning', 80)),
            str(data.get('disk_danger', 90)),
            str(data.get('db_connections', 100)),
            str(data.get('uploads_limit', 10))
        ))
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({'success': True, 'message': '임계값이 저장되었습니다.'})
    
    except Exception as e:
        print(f"임계값 저장 오류: {str(e)}")
        return jsonify({'success': False, 'message': f'저장 실패: {str(e)}'})


# ==================== 감사 로그 ====================

@admin_bp.route('/audit/logs', methods=['GET'])
def get_audit_logs():
    """감사 로그 조회"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        page = int(request.args.get('page', 1))
        page_size = int(request.args.get('page_size', 50))
        filter_user = request.args.get('user', '')
        filter_action = request.args.get('action', '')
        filter_start_date = request.args.get('start_date', '')
        filter_end_date = request.args.get('end_date', '')
        
        offset = (page - 1) * page_size
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        # 기본 쿼리
        query = """
            SELECT id, username, action, resource, details, ip_address, created_at, success
            FROM audit_logs
            WHERE 1=1
        """
        params = []
        
        # 필터 조건 추가
        if filter_user:
            query += " AND username = %s"
            params.append(filter_user)
        
        if filter_action:
            query += " AND action = %s"
            params.append(filter_action)
        
        if filter_start_date:
            query += " AND created_at >= %s"
            params.append(filter_start_date)
        
        if filter_end_date:
            query += " AND created_at <= %s"
            params.append(filter_end_date + ' 23:59:59')
        
        # 전체 개수 조회
        count_query = f"SELECT COUNT(*) FROM ({query}) AS filtered"
        cur.execute(count_query, params)
        total_count = cur.fetchone()[0]
        
        # 페이지네이션 적용
        query += " ORDER BY created_at DESC LIMIT %s OFFSET %s"
        params.extend([page_size, offset])
        
        cur.execute(query, params)
        
        logs = []
        for row in cur.fetchall():
            log_id, username, action, resource, details, ip_address, created_at, success = row
            logs.append({
                'id': log_id,
                'username': username,
                'action': action,
                'resource': resource,
                'details': details,
                'ip_address': ip_address,
                'created_at': created_at.strftime('%Y-%m-%d %H:%M:%S'),
                'success': success
            })
        
        total_pages = (total_count + page_size - 1) // page_size
        
        cur.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'logs': logs,
            'total': total_count,
            'pagination': {
                'current_page': page,
                'total_pages': total_pages,
                'page_size': page_size
            }
        })
    
    except Exception as e:
        print(f"감사 로그 조회 오류: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'success': False, 'message': f'로그 조회 실패: {str(e)}'})


@admin_bp.route('/audit/statistics', methods=['GET'])
def audit_statistics():
    """감사 로그 통계"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        from datetime import datetime, timedelta
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        now = datetime.now()
        today = now.date()
        week_ago = today - timedelta(days=7)
        month_ago = today - timedelta(days=30)
        
        # 오늘 활동
        cur.execute("SELECT COUNT(*) FROM audit_logs WHERE DATE(created_at) = %s", (today,))
        today_count = cur.fetchone()[0]
        
        # 이번 주
        cur.execute("SELECT COUNT(*) FROM audit_logs WHERE DATE(created_at) >= %s", (week_ago,))
        week_count = cur.fetchone()[0]
        
        # 이번 달
        cur.execute("SELECT COUNT(*) FROM audit_logs WHERE DATE(created_at) >= %s", (month_ago,))
        month_count = cur.fetchone()[0]
        
        cur.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'today': today_count,
            'week': week_count,
            'month': month_count
        })
    
    except Exception as e:
        print(f"통계 조회 오류: {str(e)}")
        return jsonify({'success': False, 'message': f'통계 조회 실패: {str(e)}'})


@admin_bp.route('/audit/export', methods=['GET'])
def export_audit_logs():
    """감사 로그 CSV 내보내기"""
    if 'username' not in session or session.get('role') != 'admin':
        abort(403)
    
    try:
        import csv
        from io import StringIO
        from flask import Response
        
        filter_user = request.args.get('user', '')
        filter_action = request.args.get('action', '')
        filter_start_date = request.args.get('start_date', '')
        filter_end_date = request.args.get('end_date', '')
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        query = """
            SELECT id, username, action, resource, details, ip_address, created_at, success
            FROM audit_logs
            WHERE 1=1
        """
        params = []
        
        if filter_user:
            query += " AND username = %s"
            params.append(filter_user)
        
        if filter_action:
            query += " AND action = %s"
            params.append(filter_action)
        
        if filter_start_date:
            query += " AND created_at >= %s"
            params.append(filter_start_date)
        
        if filter_end_date:
            query += " AND created_at <= %s"
            params.append(filter_end_date + ' 23:59:59')
        
        query += " ORDER BY created_at DESC"
        
        cur.execute(query, params)
        
        # CSV 생성
        output = StringIO()
        writer = csv.writer(output)
        writer.writerow(['ID', '사용자', '작업', '대상', '세부내용', 'IP주소', '날짜/시간', '결과'])
        
        for row in cur.fetchall():
            log_id, username, action, resource, details, ip_address, created_at, success = row
            writer.writerow([
                log_id, username, action, resource or '', details or '', 
                ip_address, created_at.strftime('%Y-%m-%d %H:%M:%S'),
                '성공' if success else '실패'
            ])
        
        cur.close()
        conn.close()
        
        output.seek(0)
        
        return Response(
            output.getvalue(). encode('utf-8-sig'),
            mimetype='text/csv; charset=utf-8',
            headers={'Content-Disposition': 'attachment; filename=audit_logs.csv'}
        )
    
    except Exception as e:
        print(f"CSV 내보내기 오류: {str(e)}")
        abort(500)


# ==================== 세션 관리 ====================

@admin_bp.route('/sessions/list', methods=['GET'])
def list_sessions():
    """활성 세션 목록"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("""
            SELECT 
                al.username, u.real_name, u.role, al.login_time, al.ip_address,
                EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - al.login_time)) / 60 AS minutes
            FROM access_logs al
            JOIN users u ON al.username = u.username
            WHERE al.logout_time IS NULL
            ORDER BY al.login_time DESC
        """)
        
        sessions = []
        for row in cur.fetchall():
            username, real_name, role, login_time, ip_address, minutes = row
            duration_hours = int(minutes // 60)
            duration_mins = int(minutes % 60)
            
            sessions.append({
                'session_id': f"{username}_{int(login_time.timestamp())}",
                'username': username,
                'real_name': real_name,
                'role': role,
                'login_time': login_time.strftime('%Y-%m-%d %H:%M:%S'),
                'session_duration': f"{duration_hours}시간 {duration_mins}분",
                'ip_address': ip_address,
                'status': 'active' if minutes < 30 else 'idle',
                'is_current': username == session.get('username')
            })
        
        cur.close()
        conn.close()
        
        return jsonify({'success': True, 'sessions': sessions})
    
    except Exception as e:
        print(f"세션 목록 조회 오류: {str(e)}")
        return jsonify({'success': False, 'message': f'세션 조회 실패: {str(e)}'})


@admin_bp.route('/sessions/terminate/<session_id>', methods=['POST'])
def terminate_session(session_id):
    """세션 강제 종료"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        # session_id는 username_timestamp 형식
        username = session_id.split('_')[0]
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        # 해당 사용자의 가장 최근 로그인 기록을 로그아웃 처리
        cur.execute("""
            UPDATE access_logs
            SET logout_time = CURRENT_TIMESTAMP
            WHERE username = %s AND logout_time IS NULL
        """, (username,))
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({'success': True, 'message': f'{username} 세션이 종료되었습니다.'})
    
    except Exception as e:
        print(f"세션 종료 오류: {str(e)}")
        return jsonify({'success': False, 'message': f'세션 종료 실패: {str(e)}'})


@admin_bp.route('/sessions/clear_expired', methods=['POST'])
def clear_expired_sessions():
    """만료된 세션 정리"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        from datetime import datetime, timedelta
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        # 24시간 이상 된 세션 정리
        expiry_time = datetime.now() - timedelta(hours=24)
        
        cur.execute("""
            UPDATE access_logs
            SET logout_time = CURRENT_TIMESTAMP
            WHERE logout_time IS NULL 
            AND login_time < %s
        """, (expiry_time,))
        
        cleared_count = cur.rowcount
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({'success': True, 'cleared_count': cleared_count})
    
    except Exception as e:
        print(f"만료 세션 정리 오류: {str(e)}")
        return jsonify({'success': False, 'message': f'정리 실패: {str(e)}'})


@admin_bp.route('/sessions/statistics', methods=['GET'])
def session_statistics():
    """세션 통계"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        from datetime import datetime, timedelta
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        # 활성 세션 수
        cur.execute("SELECT COUNT(*) FROM access_logs WHERE logout_time IS NULL")
        active_sessions = cur.fetchone()[0]
        
        # 오늘 로그인 수
        today = datetime.now().date()
        cur.execute("SELECT COUNT(*) FROM access_logs WHERE DATE(login_time) = %s", (today,))
        today_logins = cur.fetchone()[0]
        
        # 평균 세션 시간 (최근 100개)
        cur.execute("""
            SELECT AVG(EXTRACT(EPOCH FROM (logout_time - login_time)) / 60)
            FROM (
                SELECT login_time, logout_time 
                FROM access_logs 
                WHERE logout_time IS NOT NULL
                ORDER BY login_time DESC
                LIMIT 100
            ) AS recent_sessions
        """)
        avg_minutes = cur.fetchone()[0] or 0
        
        # 만료된 세션 수 (24시간 이상)
        expiry_time = datetime.now() - timedelta(hours=24)
        cur.execute("""
            SELECT COUNT(*) FROM access_logs 
            WHERE logout_time IS NULL AND login_time < %s
        """, (expiry_time,))
        expired_sessions = cur.fetchone()[0]
        
        cur.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'active_sessions': active_sessions,
            'today_logins': today_logins,
            'avg_session_time': f"{int(avg_minutes)}분",
            'expired_sessions': expired_sessions
        })
    
    except Exception as e:
        print(f"세션 통계 조회 오류: {str(e)}")
        return jsonify({'success': False, 'message': f'통계 조회 실패: {str(e)}'})


@admin_bp.route('/sessions/settings', methods=['GET', 'POST'])
def session_settings():
    """세션 설정"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        if request.method == 'POST':
            data = request.get_json() or {}
            
            conn = get_db_connection()
            cur = conn.cursor()
            _ensure_security_settings_table(cur)
            current = _load_security_settings(cur)
            absolute_timeout_hours = _to_int(
                data.get('absolute_timeout_hours', current.get('session_absolute_timeout_hours', 8)),
                8,
            )
            
            settings_to_save = {
                'session_timeout_minutes': data.get('session_timeout', 10),
                'session_absolute_timeout_hours': absolute_timeout_hours,
                'session_warn_before_timeout': data.get('warn_before_timeout', True),
                'concurrent_sessions': data.get('concurrent_sessions', 3),
                'remember_me': data.get('remember_me', True),
                'auto_cleanup': data.get('auto_cleanup', True),
            }
            for key, value in settings_to_save.items():
                cur.execute(
                    """
                    INSERT INTO security_settings (setting_key, setting_value, created_at, updated_at)
                    VALUES (%s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT (setting_key)
                    DO UPDATE SET
                        setting_value = EXCLUDED.setting_value,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (key, str(value)),
                )
            
            conn.commit()
            cur.close()
            conn.close()
            
            return jsonify({'success': True, 'message': '세션 설정이 저장되었습니다.'})
        
        else:  # GET
            conn = get_db_connection()
            cur = conn.cursor()
            _ensure_security_settings_table(cur)
            settings = _load_security_settings(cur)
            
            cur.close()
            conn.close()
            
            # 기본값 설정
            result = {
                'success': True,
                'session_timeout': _to_int(settings.get('session_timeout_minutes'), 10),
                'absolute_timeout_hours': _to_int(settings.get('session_absolute_timeout_hours'), 8),
                'warn_before_timeout': _to_bool(settings.get('session_warn_before_timeout'), True),
                'concurrent_sessions': _to_int(settings.get('concurrent_sessions'), 3),
                'remember_me': _to_bool(settings.get('remember_me'), True),
                'auto_cleanup': _to_bool(settings.get('auto_cleanup'), True),
                'ip_binding': _to_bool(settings.get('ip_binding'), False),
                'force_logout_on_password_change': _to_bool(settings.get('force_logout_on_password_change'), True),
                'suspicious_activity_detection': settings.get('suspicious_activity_detection', 'alert')
            }
            
            return jsonify(result)
    
    except Exception as e:
        print(f"세션 설정 오류: {str(e)}")
        return jsonify({'success': False, 'message': f'설정 처리 실패: {str(e)}'})


@admin_bp.route('/sessions/security_policy', methods=['POST'])
def save_security_policy():
    """보안 정책 저장"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        data = request.get_json() or {}
        
        conn = get_db_connection()
        cur = conn.cursor()
        _ensure_security_settings_table(cur)
        
        policy_settings = {
            'ip_binding': data.get('ip_binding', False),
            'force_logout_on_password_change': data.get('force_logout_on_password_change', True),
            'suspicious_activity_detection': data.get('suspicious_activity_detection', 'alert'),
        }
        for key, value in policy_settings.items():
            cur.execute(
                """
                INSERT INTO security_settings (setting_key, setting_value, created_at, updated_at)
                VALUES (%s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (setting_key)
                DO UPDATE SET
                    setting_value = EXCLUDED.setting_value,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (key, str(value)),
            )
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({'success': True, 'message': '보안 정책이 저장되었습니다.'})
    
    except Exception as e:
        print(f"보안 정책 저장 오류: {str(e)}")
        return jsonify({'success': False, 'message': f'저장 실패: {str(e)}'})


# ==================== 기타 유틸리티 API ====================

@admin_bp.route('/users/list', methods=['GET'])
def get_users_list():
    """사용자 목록 조회 (감사 로그 필터용)"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("""
            SELECT username, real_name, role 
            FROM users 
            WHERE is_active = TRUE 
            ORDER BY real_name ASC
        """)
        
        users = []
        for row in cur.fetchall():
            username, real_name, role = row
            users.append({
                'username': username,
                'real_name': real_name,
                'role': role
            })
        
        cur.close()
        conn.close()
        
        return jsonify({'success': True, 'users': users})
    
    except Exception as e:
        print(f"사용자 목록 조회 오류: {str(e)}")
        return jsonify({'success': False, 'message': f'조회 실패: {str(e)}'})


# ==================== 파일 스토리지 관리 ====================

@admin_bp.route('/storage/info', methods=['GET'])
def get_storage_info():
    """스토리지 정보 조회 (업로드 하위 폴더 기준)"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        import os
        from config import Config

        folders = []
        total_size_bytes = 0
        total_files = 0

        root_folder = Config.UPLOAD_FOLDER
        if os.path.exists(root_folder):
            for entry in sorted(os.listdir(root_folder)):
                folder_path = os.path.join(root_folder, entry)
                if not os.path.isdir(folder_path):
                    continue

                folder_size = 0
                folder_file_count = 0
                for dirpath, _dirnames, filenames in os.walk(folder_path):
                    for filename in filenames:
                        filepath = os.path.join(dirpath, filename)
                        if not os.path.exists(filepath):
                            continue
                        folder_size += os.path.getsize(filepath)
                        folder_file_count += 1

                total_size_bytes += folder_size
                total_files += folder_file_count

                if folder_size > 1024 * 1024 * 1024:
                    size_str = f"{folder_size / (1024**3):.2f} GB"
                elif folder_size > 1024 * 1024:
                    size_str = f"{folder_size / (1024**2):.2f} MB"
                else:
                    size_str = f"{folder_size / 1024:.2f} KB"

                folders.append({
                    'name': entry,
                    'file_count': folder_file_count,
                    'size': size_str,
                    'size_bytes': folder_size,
                    'percentage': 0
                })

        if total_size_bytes > 0:
            for folder in folders:
                folder['percentage'] = round((folder['size_bytes'] / total_size_bytes) * 100, 1)
        
        if total_size_bytes > 1024 * 1024 * 1024:
            total_size_str = f"{total_size_bytes / (1024**3):.2f} GB"
        elif total_size_bytes > 1024 * 1024:
            total_size_str = f"{total_size_bytes / (1024**2):.2f} MB"
        else:
            total_size_str = f"{total_size_bytes / 1024:.2f} KB"
        
        return jsonify({
            'success': True,
            'total_size': total_size_str,
            'total_files': total_files,
            'folder_count': len(folders),
            'folders': folders
        })
    
    except Exception as e:
        print(f"스토리지 정보 조회 오류: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'success': False, 'message': f'조회 실패: {str(e)}'})


@admin_bp.route('/storage/check-old-files', methods=['GET'])
def check_old_files():
    """오래된 파일 확인"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        import os
        from datetime import datetime, timedelta
        from config import Config
        
        days = int(request.args.get('days', 180))
        cutoff_date = datetime.now() - timedelta(days=days)
        
        old_files = []
        total_size = 0
        
        # uploads 폴더 스캔
        if os.path.exists(Config.UPLOAD_FOLDER):
            for root, dirs, files in os.walk(Config.UPLOAD_FOLDER):
                for filename in files:
                    filepath = os.path.join(root, filename)
                    
                    if os.path.exists(filepath):
                        mtime = datetime.fromtimestamp(os.path.getmtime(filepath))
                        
                        if mtime < cutoff_date:
                            file_size = os.path.getsize(filepath)
                            total_size += file_size
                            
                            # 크기 포맷팅
                            if file_size > 1024 * 1024:
                                size_str = f"{file_size / (1024**2):.2f} MB"
                            else:
                                size_str = f"{file_size / 1024:.2f} KB"
                            
                            old_files.append({
                                'name': os.path.relpath(filepath, Config.UPLOAD_FOLDER),
                                'size': size_str,
                                'modified': mtime.strftime('%Y-%m-%d %H:%M:%S')
                            })
        
        # 전체 크기 포맷팅
        if total_size > 1024 * 1024 * 1024:
            total_size_str = f"{total_size / (1024**3):.2f} GB"
        elif total_size > 1024 * 1024:
            total_size_str = f"{total_size / (1024**2):.2f} MB"
        else:
            total_size_str = f"{total_size / 1024:.2f} KB"
        
        return jsonify({
            'success': True,
            'file_count': len(old_files),
            'total_size': total_size_str,
            'files': old_files[:100]  # 최대 100개만 표시
        })
    
    except Exception as e:
        print(f"오래된 파일 확인 오류: {str(e)}")
        return jsonify({'success': False, 'message': f'확인 실패: {str(e)}'})


@admin_bp.route('/storage/delete-old-files', methods=['POST'])
def delete_old_files():
    """오래된 파일 삭제"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        import os
        from datetime import datetime, timedelta
        from config import Config
        
        data = request.get_json()
        days = int(data.get('days', 180))
        cutoff_date = datetime.now() - timedelta(days=days)
        
        deleted_count = 0
        freed_space = 0
        
        # uploads 폴더 스캔 및 삭제
        if os.path.exists(Config.UPLOAD_FOLDER):
            for root, dirs, files in os.walk(Config.UPLOAD_FOLDER):
                for filename in files:
                    filepath = os.path.join(root, filename)
                    
                    if os.path.exists(filepath):
                        mtime = datetime.fromtimestamp(os.path.getmtime(filepath))
                        
                        if mtime < cutoff_date:
                            file_size = os.path.getsize(filepath)
                            os.remove(filepath)
                            deleted_count += 1
                            freed_space += file_size
        
        # 빈 폴더 정리
        for root, dirs, files in os.walk(Config.UPLOAD_FOLDER, topdown=False):
            for dirname in dirs:
                dirpath = os.path.join(root, dirname)
                if os.path.exists(dirpath) and not os.listdir(dirpath):
                    os.rmdir(dirpath)
        
        # 크기 포맷팅
        if freed_space > 1024 * 1024 * 1024:
            freed_space_str = f"{freed_space / (1024**3):.2f} GB"
        elif freed_space > 1024 * 1024:
            freed_space_str = f"{freed_space / (1024**2):.2f} MB"
        else:
            freed_space_str = f"{freed_space / 1024:.2f} KB"
        
        # 감사 로그 기록
        log_audit(session.get('username'), 'delete', 
                 resource='오래된 파일',
                 details=f'{days}일 이상: {deleted_count}개 파일, {freed_space_str} 확보')
        
        return jsonify({
            'success': True,
            'deleted_count': deleted_count,
            'freed_space': freed_space_str
        })
    
    except Exception as e:
        print(f"파일 삭제 오류: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'success': False, 'message': f'삭제 실패: {str(e)}'})


@admin_bp.route('/storage/clean-temp', methods=['POST'])
def clean_temp_files():
    """임시 파일 정리"""
    if 'username' not in session or session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    
    try:
        import os
        import tempfile
        
        deleted_count = 0
        freed_space = 0
        
        # Python 임시 폴더
        temp_dir = tempfile.gettempdir()
        
        # 임시 파일 패턴
        temp_patterns = ['tmp', 'temp', 'cache', 'backup_temp']
        
        for pattern in temp_patterns:
            for root, dirs, files in os.walk(temp_dir):
                for filename in files:
                    if pattern in filename.lower():
                        filepath = os.path.join(root, filename)
                        try:
                            file_size = os.path.getsize(filepath)
                            os.remove(filepath)
                            deleted_count += 1
                            freed_space += file_size
                        except:
                            pass  # 접근 불가능한 파일은 건너뛰기
        
        # 크기 포맷팅
        if freed_space > 1024 * 1024:
            freed_space_str = f"{freed_space / (1024**2):.2f} MB"
        else:
            freed_space_str = f"{freed_space / 1024:.2f} KB"
        
        # 감사 로그 기록
        log_audit(session.get('username'), 'delete', 
                 resource='임시 파일',
                 details=f'{deleted_count}개 파일, {freed_space_str} 확보')
        
        return jsonify({
            'success': True,
            'deleted_count': deleted_count,
            'freed_space': freed_space_str
        })
    
    except Exception as e:
        print(f"임시 파일 정리 오류: {str(e)}")
        return jsonify({'success': False, 'message': f'정리 실패: {str(e)}'})


