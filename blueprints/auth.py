"""
Authentication blueprint.
"""
import hmac
import os
import re
import secrets
import string
from datetime import datetime

from flask import Blueprint, flash, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

from models import get_db_connection
from services import send_email
from utils import (
    get_client_ip,
    is_ip_in_entries,
    log_audit,
    normalize_ip_value,
)

auth_bp = Blueprint('auth', __name__)
USERNAME_PATTERN = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$')
LOGIN_CUSTOM_LOGO_STATIC_PATH = 'uploads/login_logo/custom_logo.png'
LOGIN_CUSTOM_LOGO_FILE_PATH = os.path.join('static', *LOGIN_CUSTOM_LOGO_STATIC_PATH.split('/'))
LOGIN_PAGE_DEFAULTS = {
    "login_site_name": None,
    "login_welcome_message": None,
    "login_site_name_font_size": None,
    "login_welcome_message_font_size": None,
}


def _normalize_login_font_size(value, minimum, maximum):
    if value is None or str(value).strip() == "":
        return None
    try:
        font_size = int(value)
    except (TypeError, ValueError):
        return None
    return min(max(font_size, minimum), maximum)


def _normalize_login_page_settings(values):
    source = values or {}
    site_name = str(source.get("login_site_name") or "").strip()[:100] or None
    welcome_message = str(source.get("login_welcome_message") or "").strip()[:300] or None
    return {
        "login_site_name": site_name,
        "login_welcome_message": welcome_message,
        "login_site_name_font_size": _normalize_login_font_size(
            source.get("login_site_name_font_size"), 12, 48
        ),
        "login_welcome_message_font_size": _normalize_login_font_size(
            source.get("login_welcome_message_font_size"), 10, 32
        ),
    }

def _get_login_logo_settings(values):
    enabled = str((values or {}).get("login_custom_logo_enabled") or "").strip().lower() in {"1", "true", "yes", "on"}
    if enabled and os.path.isfile(LOGIN_CUSTOM_LOGO_FILE_PATH):
        version = str((values or {}).get("login_custom_logo_updated_at") or "").strip()
        return {"login_logo_url": url_for("static", filename=LOGIN_CUSTOM_LOGO_STATIC_PATH, v=version), "has_custom_login_logo": True}
    return {"login_logo_url": url_for("static", filename="logo.png"), "has_custom_login_logo": False}


def _load_login_page_settings():
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT setting_key, setting_value
            FROM system_settings
            WHERE setting_key IN ('login_site_name', 'login_welcome_message', 'login_site_name_font_size', 'login_welcome_message_font_size', 'login_custom_logo_enabled', 'login_custom_logo_updated_at')
            """
        )
        values = {key: value for key, value in cur.fetchall()}
        settings = _normalize_login_page_settings(values)
        settings.update(_get_login_logo_settings(values))
        return settings
    except Exception:
        settings = _normalize_login_page_settings({})
        settings.update(_get_login_logo_settings({}))
        return settings
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


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


def _is_ip_allowed(ip_addr, settings):
    enabled = _to_bool(settings.get('ip_filter_enabled', False), False)
    if not enabled:
        return True

    filter_type = (settings.get('ip_filter_type') or 'blacklist').strip().lower()
    ip_list_raw = settings.get('ip_filter_list') or ''
    if not normalize_ip_value(ip_addr):
        # If IP parsing fails and filter is enabled, be conservative.
        return False

    if filter_type == 'whitelist' and not str(ip_list_raw).strip():
        return False

    matched = is_ip_in_entries(ip_addr, ip_list_raw)
    if filter_type == 'whitelist':
        return matched
    return not matched


def _is_account_ip_allowed(ip_addr, allowed_ip_list):
    allowed_ip_list = str(allowed_ip_list or '').strip()
    if not allowed_ip_list:
        return True
    return is_ip_in_entries(ip_addr, allowed_ip_list)


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


def _normalize_username(username):
    return str(username or '').strip()


def _is_valid_username(username):
    return bool(USERNAME_PATTERN.match(_normalize_username(username)))


def _generate_temporary_password(length=12):
    # Ensure policy-friendly temporary password composition.
    upper = secrets.choice(string.ascii_uppercase)
    lower = secrets.choice(string.ascii_lowercase)
    digit = secrets.choice(string.digits)
    special_chars = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`'
    special = secrets.choice(special_chars)

    remaining = ''.join(
        secrets.choice(string.ascii_letters + string.digits + special_chars)
        for _ in range(max(0, length - 4))
    )
    chars = list(upper + lower + digit + special + remaining)
    secrets.SystemRandom().shuffle(chars)
    return ''.join(chars)


def _has_itma_access(username, role):
    role_name = str(role or '').strip().lower()
    if role_name == 'admin':
        return True
    if role_name not in {'manager', 'user'}:
        return False

    username = _normalize_username(username)
    if not username:
        return False

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT 1
            FROM user_permission_groups upg
            JOIN permission_groups pg ON pg.id = upg.group_id
            JOIN permission_group_categories pgc ON pgc.group_id = pg.id
            WHERE upg.username = %s
              AND pg.target_role = %s
              AND pg.is_active = TRUE
              AND pgc.can_view = TRUE
            LIMIT 1
            """,
            (username, role_name),
        )
        return cur.fetchone() is not None
    except Exception:
        return False
    finally:
        cur.close()
        conn.close()


def _get_post_login_redirect_endpoint():
    username = session.get('username')
    role = (session.get('role') or '').strip().lower()
    if role == 'admin':
        if session.pop('admin_first_login_redirect', False):
            return url_for('admin.settings')
        return url_for('itma.page')
    if role in {'manager', 'user'}:
        if _has_itma_access(username, role):
            return url_for('itma.page')
        return url_for('auth.access_pending')
    return url_for('itma.page')


def _get_or_create_csrf_token():
    token = session.get('csrf_token')
    if not token:
        token = secrets.token_urlsafe(32)
        session['csrf_token'] = token
    return token


def _validate_csrf_token():
    session_token = session.get('csrf_token')
    form_token = request.form.get('csrf_token')
    if not session_token or not form_token:
        return False
    return hmac.compare_digest(session_token, form_token)


@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if not _validate_csrf_token():
            flash('잘못된 요청입니다. 다시 시도해주세요.', 'danger')
            return redirect(url_for('auth.login'))

        username = _normalize_username(request.form.get('username'))
        password = request.form['password']
        ip_addr = get_client_ip()

        conn = get_db_connection()
        cur = conn.cursor()

        settings = _load_security_settings(cur)

        if not _is_valid_username(username):
            cur.close()
            conn.close()
            log_audit(username or 'anonymous', 'login', details='로그인 실패 (아이디 형식 오류)', success=False, ip_address=ip_addr)
            flash('아이디 또는 비밀번호가 올바르지 않습니다.', 'danger')
            return redirect(url_for('auth.login'))

        # IP filter policy
        if not _is_ip_allowed(ip_addr, settings):
            cur.close()
            conn.close()
            log_audit(username, 'login', details='로그인 실패 (IP 필터 정책 차단)', success=False, ip_address=ip_addr)
            flash('허용되지 않은 IP 주소입니다.', 'danger')
            return redirect(url_for('auth.login'))

        # Brute-force protection by audit logs
        max_attempts = _to_int(settings.get('login_max_attempts', 5), 5)
        lockout_duration = _to_int(settings.get('login_lockout_duration_minutes', 15), 15)
        time_window = _to_int(settings.get('login_time_window_minutes', 10), 10)

        cur.execute(
            """
            SELECT COUNT(*)
            FROM audit_logs
            WHERE username = %s
              AND action = 'login'
              AND success = FALSE
              AND created_at >= NOW() - (%s * INTERVAL '1 minute')
            """,
            (username, time_window),
        )
        recent_failures = cur.fetchone()[0]
        if recent_failures >= max_attempts:
            cur.close()
            conn.close()
            flash(f'로그인 시도 횟수를 초과했습니다. {lockout_duration}분 후 다시 시도하세요.', 'danger')
            return redirect(url_for('auth.login'))

        # User lookup
        cur.execute(
            """
            SELECT username, password, role, is_active, COALESCE(must_change_password, FALSE), real_name, allowed_ip_list, last_login
            FROM users
            WHERE username = %s
            """,
            (username,),
        )
        user = cur.fetchone()

        if user and check_password_hash(user[1], password):
            if not user[3]:
                cur.close()
                conn.close()
                flash('이 계정은 비활성화 상태입니다.', 'danger')
                return redirect(url_for('auth.login'))

            if not _is_account_ip_allowed(ip_addr, user[6] if len(user) > 6 else ''):
                cur.close()
                conn.close()
                log_audit(username, 'login', details='로그인 실패 (계정 허용 IP 불일치)', success=False, ip_address=ip_addr)
                flash('이 계정은 등록된 허용 IP에서만 접속할 수 있습니다.', 'danger')
                return redirect(url_for('auth.login'))

            session['username'] = user[0]
            session['role'] = user[2]
            session['real_name'] = (user[5] or '').strip() if len(user) > 5 else ''
            session['admin_first_login_redirect'] = (
                (session.get('role') or '').strip().lower() == 'admin'
                and (user[7] if len(user) > 7 else None) is None
            )
            now = datetime.utcnow().isoformat()
            session['login_at'] = now
            session['last_activity_at'] = now
            if user[4]:
                session['force_password_change'] = True

            current_time = datetime.now()
            cur.execute("UPDATE users SET last_login = %s WHERE username = %s", (current_time, username))
            cur.execute("INSERT INTO access_logs (username, ip_address) VALUES (%s, %s)", (username, ip_addr))

            conn.commit()
            cur.close()
            conn.close()

            log_audit(username, 'login', details='로그인 성공', ip_address=ip_addr)
            if user[4]:
                flash('임시 비밀번호로 로그인했습니다.', 'warning')
                flash('새 비밀번호를 설정해주세요.', 'warning')
                return redirect(url_for('auth.password_setup'))
            return redirect(_get_post_login_redirect_endpoint())

        cur.close()
        conn.close()

        log_audit(username, 'login', details='로그인 실패 (잘못된 인증 정보)', success=False, ip_address=ip_addr)
        flash('아이디 또는 비밀번호가 올바르지 않습니다.', 'danger')
        return redirect(url_for('auth.login'))

    return render_template('login.html', csrf_token=_get_or_create_csrf_token(), **_load_login_page_settings())


@auth_bp.route('/forgot_password', methods=['POST'])
def forgot_password():
    if not _validate_csrf_token():
        flash('잘못된 요청입니다. 다시 시도해주세요.', 'danger')
        return redirect(url_for('auth.login'))

    email = (request.form.get('email') or '').strip().lower()
    generic_message = '입력하신 이메일로 계정이 존재하면 임시 비밀번호를 발송했습니다.'
    if not email:
        flash(generic_message, 'success')
        return redirect(url_for('auth.login'))

    conn = get_db_connection()
    cur = conn.cursor()
    ip_addr = get_client_ip()
    max_attempts = 5
    time_window_minutes = 10

    try:
        cur.execute(
            """
            SELECT COUNT(*)
            FROM audit_logs
            WHERE action = 'forgot_password'
              AND ip_address = %s
              AND created_at >= NOW() - (%s * INTERVAL '1 minute')
            """,
            (ip_addr, time_window_minutes),
        )
        request_count = cur.fetchone()[0]
        if request_count >= max_attempts:
            cur.close()
            conn.close()
            log_audit(
                username='anonymous',
                action='forgot_password',
                resource='password',
                details='요청 제한 초과',
                ip_address=ip_addr,
                success=False,
            )
            flash(generic_message, 'success')
            return redirect(url_for('auth.login'))

        cur.execute(
            """
            SELECT username, real_name, email
            FROM users
            WHERE LOWER(email) = %s AND is_active = TRUE
            ORDER BY username ASC
            LIMIT 1
            """,
            (email,),
        )
        user = cur.fetchone()

        if not user:
            cur.close()
            conn.close()
            log_audit(
                username='anonymous',
                action='forgot_password',
                resource='password',
                details='계정 없음 또는 비활성 계정',
                ip_address=ip_addr,
                success=False,
            )
            flash(generic_message, 'success')
            return redirect(url_for('auth.login'))

        username, real_name, recipient_email = user
        temporary_password = _generate_temporary_password(12)
        hashed_temp_password = generate_password_hash(temporary_password)

        cur.execute(
            """
            UPDATE users
            SET password = %s,
                must_change_password = TRUE
            WHERE username = %s
            """,
            (hashed_temp_password, username),
        )

        display_name = real_name or username
        subject = '[자산관리] 임시 비밀번호 안내'
        body = (
            f'안녕하세요, {display_name}님.\n\n'
            '비밀번호 재설정 요청으로 임시 비밀번호를 발급해드립니다.\n'
            f'아이디: {username}\n'
            f'임시 비밀번호: {temporary_password}\n\n'
            '보안을 위해 로그인 후 반드시 비밀번호를 변경해주세요.'
        )

        send_result = send_email(recipient_email, subject, body)
        if not send_result.get('success'):
            conn.rollback()
            cur.close()
            conn.close()
            log_audit(
                username=username,
                action='forgot_password',
                resource='password',
                details='임시 비밀번호 메일 발송 실패',
                ip_address=ip_addr,
                success=False,
            )
            flash(generic_message, 'success')
            return redirect(url_for('auth.login'))

        conn.commit()
        cur.close()
        conn.close()

        log_audit(username, 'forgot_password', resource='password', details='임시 비밀번호 발급', ip_address=ip_addr)
        flash(generic_message, 'success')
        return redirect(url_for('auth.login'))
    except Exception:
        conn.rollback()
        cur.close()
        conn.close()
        log_audit(
            username='anonymous',
            action='forgot_password',
            resource='password',
            details='비밀번호 재설정 처리 예외',
            ip_address=ip_addr,
            success=False,
        )
        flash(generic_message, 'success')
        return redirect(url_for('auth.login'))


@auth_bp.route('/logout')
def logout():
    username = session.get('username')
    if username:
        log_audit(username, 'logout', details='로그아웃')
    session.clear()
    return redirect(url_for('auth.login'))


@auth_bp.route('/access-pending')
def access_pending():
    if 'username' not in session:
        return redirect(url_for('auth.login'))

    username = session.get('username')
    role = (session.get('role') or '').strip().lower()
    if role == 'admin':
        return redirect(url_for('admin.settings'))
    if role in {'manager', 'user'} and _has_itma_access(username, role):
        return redirect(url_for('itma.page'))

    return render_template(
        'access_pending.html',
        username=username,
        real_name=(session.get('real_name') or '').strip(),
        role=role or 'user',
    )


def _handle_forced_password_setup():
    if 'username' not in session:
        return redirect(url_for('auth.login'))

    if not session.get('force_password_change'):
        return redirect(_get_post_login_redirect_endpoint())

    if request.method == 'GET':
        return render_template(
            'password_setup.html',
            csrf_token=_get_or_create_csrf_token(),
            token_valid=True,
            form_action=url_for('auth.password_setup'),
            mode='force_password_change',
        )

    if not _validate_csrf_token():
        flash('잘못된 요청입니다. 다시 시도해주세요.', 'danger')
        return redirect(url_for('auth.password_setup'))

    username = session['username']
    new_password = request.form.get('new_password', '')
    confirm_password = request.form.get('confirm_password', '')

    if new_password != confirm_password:
        flash('새 비밀번호가 일치하지 않습니다.', 'danger')
        return redirect(url_for('auth.password_setup'))

    conn = get_db_connection()
    cur = conn.cursor()

    settings = _load_security_settings(cur)
    is_valid, error_msg = _validate_password_by_policy(new_password, settings)
    if not is_valid:
        cur.close()
        conn.close()
        flash(error_msg, 'danger')
        return redirect(url_for('auth.password_setup'))

    hashed_new_password = generate_password_hash(new_password)
    cur.execute(
        """
        UPDATE users
        SET password = %s,
            must_change_password = FALSE
        WHERE username = %s
        """,
        (hashed_new_password, username),
    )
    conn.commit()
    cur.close()
    conn.close()

    session.pop('force_password_change', None)
    log_audit(username, 'update', resource='비밀번호', details='임시 비밀번호 로그인 후 비밀번호 변경')
    flash('비밀번호가 성공적으로 변경되었습니다.', 'success')
    return redirect(_get_post_login_redirect_endpoint())


@auth_bp.route('/password_setup', methods=['GET', 'POST'])
def password_setup():
    return _handle_forced_password_setup()


@auth_bp.route('/force_change_password', methods=['GET', 'POST'])
def force_change_password():
    return _handle_forced_password_setup()


@auth_bp.route('/profile', methods=['GET'])
def get_profile():
    if 'username' not in session:
        return jsonify({'success': False, 'message': '로그인이 필요합니다.'}), 401

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT email FROM users WHERE username = %s", (session['username'],))
        row = cur.fetchone()
        if not row:
            return jsonify({'success': False, 'message': '사용자를 찾을 수 없습니다.'}), 404
        return jsonify({'success': True, 'username': session['username'], 'email': row[0] or ''})
    finally:
        cur.close()
        conn.close()


@auth_bp.route('/profile/update', methods=['POST'])
def update_profile():
    if 'username' not in session:
        return redirect(url_for('auth.login'))
    if not _validate_csrf_token():
        flash('잘못된 요청입니다. 다시 시도해주세요.', 'danger')
        return redirect(url_for('itma.page'))

    username = session['username']
    email = (request.form.get('email') or '').strip()
    current_password = request.form.get('current_password', '')
    new_password = request.form.get('new_password', '')
    confirm_password = request.form.get('confirm_password', '')

    if email and not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', email):
        flash('이메일 형식이 올바르지 않습니다.', 'danger')
        return redirect(request.referrer or url_for('itma.page'))

    if (new_password or confirm_password) and new_password != confirm_password:
        flash('새 비밀번호가 일치하지 않습니다.', 'danger')
        return redirect(request.referrer or url_for('itma.page'))

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        if email:
            cur.execute(
                "SELECT username FROM users WHERE email = %s AND username != %s",
                (email, username),
            )
            if cur.fetchone():
                flash('이미 사용 중인 이메일 주소입니다.', 'danger')
                return redirect(request.referrer or url_for('itma.page'))

        settings = _load_security_settings(cur)

        if new_password:
            cur.execute("SELECT password FROM users WHERE username = %s", (username,))
            row = cur.fetchone()
            if not row or not check_password_hash(row[0], current_password):
                flash('현재 비밀번호가 올바르지 않습니다.', 'danger')
                return redirect(request.referrer or url_for('itma.page'))

            is_valid, error_msg = _validate_password_by_policy(new_password, settings)
            if not is_valid:
                flash(error_msg, 'danger')
                return redirect(request.referrer or url_for('itma.page'))

            hashed_new_password = generate_password_hash(new_password)
            cur.execute(
                """
                UPDATE users
                SET email = %s,
                    password = %s,
                    must_change_password = FALSE
                WHERE username = %s
                """,
                (email or None, hashed_new_password, username),
            )
            session.pop('force_password_change', None)
            log_audit(username, 'update', resource='내 정보', details='이메일/비밀번호 변경')
            flash('이메일 및 비밀번호가 변경되었습니다.', 'success')
        else:
            cur.execute(
                """
                UPDATE users
                SET email = %s
                WHERE username = %s
                """,
                (email or None, username),
            )
            log_audit(username, 'update', resource='내 정보', details='이메일 변경')
            flash('이메일이 변경되었습니다.', 'success')

        conn.commit()
        return redirect(request.referrer or url_for('itma.page'))
    except Exception:
        conn.rollback()
        flash('내 정보 변경 중 오류가 발생했습니다.', 'danger')
        return redirect(request.referrer or url_for('itma.page'))
    finally:
        cur.close()
        conn.close()


@auth_bp.route('/change_pw', methods=['POST'])
def change_password():
    if 'username' not in session:
        return redirect(url_for('auth.login'))
    if not _validate_csrf_token():
        flash('잘못된 요청입니다. 다시 시도해주세요.', 'danger')
        return redirect(url_for('itma.page'))

    username = session['username']
    current_password = request.form['current_password']
    new_password = request.form['new_password']
    confirm_password = request.form['confirm_password']

    if new_password != confirm_password:
        flash('새 비밀번호가 일치하지 않습니다.', 'danger')
        return redirect(url_for('itma.page'))

    conn = get_db_connection()
    cur = conn.cursor()

    settings = _load_security_settings(cur)
    is_valid, error_msg = _validate_password_by_policy(new_password, settings)
    if not is_valid:
        cur.close()
        conn.close()
        flash(error_msg, 'danger')
        return redirect(url_for('itma.page'))

    cur.execute("SELECT password FROM users WHERE username = %s", (username,))
    user = cur.fetchone()

    if not user or not check_password_hash(user[0], current_password):
        cur.close()
        conn.close()
        flash('현재 비밀번호가 올바르지 않습니다.', 'danger')
        return redirect(url_for('itma.page'))

    hashed_new_password = generate_password_hash(new_password)
    cur.execute(
        "UPDATE users SET password = %s, must_change_password = FALSE WHERE username = %s",
        (hashed_new_password, username),
    )
    conn.commit()
    cur.close()
    conn.close()

    log_audit(username, 'update', resource='비밀번호', details='비밀번호 변경')
    flash('비밀번호가 성공적으로 변경되었습니다.', 'success')
    return redirect(url_for('itma.page'))
