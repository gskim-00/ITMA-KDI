# ============================================
# 자산 관리 시스템 - Flask Application
# ============================================

from datetime import datetime
import os
import secrets

from flask import Flask, flash, jsonify, redirect, request, session, url_for
from werkzeug.exceptions import RequestEntityTooLarge
from config import Config, email_config
from models import get_db_connection, init_db
from blueprints import auth_bp, admin_bp, itma_bp

# Flask 앱 초기화

app = Flask(__name__)
app.config.from_object(Config)
app.config['JSON_AS_ASCII'] = False  # 한글 JSON 응답 깨짐 방지
Config.init_app(app)
app.config.setdefault('SSL_CERT_PATH', '')
app.config.setdefault('SSL_KEY_PATH', '')
app.config.setdefault('FORCE_HTTPS_REDIRECT', False)

# 컨테이너/WSGI 환경에서도 항상 DB 테이블 자동 생성
try:
    init_db()
except Exception as e:
    print(f"[WARN] DB initialization failed: {e}")

# DB에서 웹서버 설정 로드 및 적용
try:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('server_name', 'url_scheme', 'max_file_size', 'ssl_cert_path', 'ssl_key_path', 'force_https_redirect')")
    rows = cur.fetchall()
    
    for key, value in rows:
        if key == 'server_name' and value:
            app.config['SERVER_NAME'] = value
            print(f"[INFO] Server name configured: {value}")
        elif key == 'url_scheme' and value:
            app.config['PREFERRED_URL_SCHEME'] = value
            print(f"[INFO] URL scheme configured: {value}")
        elif key == 'max_file_size' and value:
            try:
                max_size_mb = int(value)
                app.config['MAX_CONTENT_LENGTH'] = max_size_mb * 1024 * 1024  # MB to bytes
                print(f"[INFO] Max upload size configured: {max_size_mb}MB")
            except ValueError:
                print(f"[WARN] Invalid max upload size value: {value}")
        elif key == 'ssl_cert_path':
            app.config['SSL_CERT_PATH'] = value or ''
            if value:
                print(f"[INFO] SSL cert path: {value}")
        elif key == 'ssl_key_path':
            app.config['SSL_KEY_PATH'] = value or ''
            if value:
                print(f"[INFO] SSL key path: {value}")
        elif key == 'force_https_redirect':
            app.config['FORCE_HTTPS_REDIRECT'] = str(value).strip().lower() in ('1', 'true', 'yes', 'on')
            print(f"[INFO] Force HTTPS redirect: {app.config['FORCE_HTTPS_REDIRECT']}")

    
    cur.close()
    conn.close()
except Exception as e:
    print(f"[WARN] Failed to load server settings (using defaults): {e}")

# DB에서 이메일 설정 로드
try:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT smtp_server, smtp_port, smtp_username, smtp_password, sender_email, sender_name, use_tls FROM email_settings LIMIT 1")
    email_row = cur.fetchone()
    
    if email_row:
        email_config.update({
            'smtp_server': email_row[0],
            'smtp_port': email_row[1],
            'smtp_username': email_row[2],
            'smtp_password': email_row[3],
            'sender_email': email_row[4],
            'sender_name': email_row[5],
            'use_tls': email_row[6]
        })
        print(f"[INFO] Email settings loaded: {email_row[0]}:{email_row[1]}")
    else:
        print("[WARN] No email settings found in DB. Using defaults.")
    
    cur.close()
    conn.close()
except Exception as e:
    print(f"[WARN] Failed to load email settings (using defaults): {e}")

# Blueprint 등록
app.register_blueprint(auth_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(itma_bp)


@app.route('/')
def root():
    return redirect(url_for('itma.page'))


@app.context_processor
def inject_csrf_token():
    token = session.get('csrf_token')
    if not token:
        token = secrets.token_urlsafe(32)
        session['csrf_token'] = token
    max_content_length = app.config.get('MAX_CONTENT_LENGTH') or Config.MAX_CONTENT_LENGTH
    max_file_size_mb = max(1, int(max_content_length / (1024 * 1024)))
    return {
        'csrf_token': token,
        'app_max_file_size_mb': max_file_size_mb
    }


@app.errorhandler(RequestEntityTooLarge)
def handle_request_entity_too_large(_error):
    max_content_length = app.config.get('MAX_CONTENT_LENGTH') or Config.MAX_CONTENT_LENGTH
    max_file_size_mb = max(1, int(max_content_length / (1024 * 1024)))
    message = f'파일 크기가 너무 큽니다. 최대 {max_file_size_mb}MB까지 업로드할 수 있습니다.'
    is_api_request = (
        request.is_json
        or request.headers.get('X-Requested-With') == 'XMLHttpRequest'
        or 'application/json' in (request.headers.get('Accept') or '')
        or request.method in ('POST', 'PUT', 'PATCH', 'DELETE')
    )
    if is_api_request:
        return jsonify({
            'success': False,
            'message': message,
            'error': 'file_too_large',
            'max_file_size_mb': max_file_size_mb
        }), 413
    flash(message, 'danger')
    return redirect(request.referrer or url_for('itma.page'))


def _to_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _load_session_security_settings():
    settings = {
        'session_timeout_minutes': 10,
        'session_absolute_timeout_hours': 8,
    }
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT setting_key, setting_value
            FROM security_settings
            WHERE setting_key IN ('session_timeout_minutes', 'session_absolute_timeout_hours')
        """)
        for key, value in cur.fetchall():
            settings[key] = _to_int(value, settings.get(key, 0))
        cur.close()
        conn.close()
    except Exception:
        pass
    return settings


# 화면이 주기적으로 자동 호출하는 요청(서버 시간, 시스템 상태, 세션 목록 등)은
# 사용자 활동으로 보지 않는다. 그래야 비활성 타임아웃이 설정값대로 동작한다.
BACKGROUND_POLL_ENDPOINTS = {
    'itma.server_time',
    'itma.dashboard_summary',
    'admin.system_status',
    'admin.list_sessions',
    'admin.session_statistics',
}


@app.before_request
def enforce_session_security_policy():
    if request.endpoint is None:
        return None
    if request.endpoint.startswith('static'):
        return None
    if request.endpoint == 'auth.login':
        return None
    if session.get('force_password_change'):
        allowed_endpoints = {'auth.force_change_password', 'auth.password_setup', 'auth.logout'}
        if request.endpoint not in allowed_endpoints:
            return redirect(url_for('auth.password_setup'))

    if 'username' not in session:
        return None

    settings = _load_session_security_settings()
    idle_minutes = _to_int(settings.get('session_timeout_minutes', 10), 10)
    absolute_hours = _to_int(settings.get('session_absolute_timeout_hours', 8), 8)

    now = datetime.utcnow()
    login_at_raw = session.get('login_at')
    last_activity_raw = session.get('last_activity_at')

    try:
        login_at = datetime.fromisoformat(login_at_raw) if login_at_raw else now
    except (TypeError, ValueError):
        login_at = now
    try:
        last_activity = datetime.fromisoformat(last_activity_raw) if last_activity_raw else now
    except (TypeError, ValueError):
        last_activity = now

    idle_timed_out = (now - last_activity).total_seconds() > (idle_minutes * 60)
    absolute_timed_out = (now - login_at).total_seconds() > (absolute_hours * 3600)

    if idle_timed_out or absolute_timed_out:
        session.clear()
        # 화면 이동이 아닌 API·자동 호출 요청은 JSON 401로 응답하고, 화면(base_common.js)에서 로그인 페이지로 이동시킨다.
        is_api_request = (
            request.endpoint in BACKGROUND_POLL_ENDPOINTS
            or request.is_json
            or request.headers.get('X-Requested-With') == 'XMLHttpRequest'
            or 'application/json' in (request.headers.get('Accept') or '')
        )
        if is_api_request:
            return jsonify({
                "success": False,
                "message": "세션이 만료되었습니다. 다시 로그인해주세요.",
                "session_expired": True
            }), 401

        flash('세션이 만료되었습니다. 다시 로그인해주세요.', 'warning')
        return redirect(url_for('auth.login'))

    if request.endpoint not in BACKGROUND_POLL_ENDPOINTS:
        session['last_activity_at'] = now.isoformat()
    return None

@app.before_request
def enforce_https_redirect():
    if not app.config.get('FORCE_HTTPS_REDIRECT', False):
        return None
    if request.method == 'OPTIONS':
        return None

    forwarded_proto = (request.headers.get('X-Forwarded-Proto') or '').split(',')[0].strip().lower()
    is_secure_request = request.is_secure or forwarded_proto == 'https'
    if is_secure_request:
        return None

    https_url = request.url.replace('http://', 'https://', 1)
    return redirect(https_url, code=301)


# ============================================
# 공개 접근 라우트 (인증 불필요)
# ============================================

# 주의: 이 라우트는 프로젝트 블루프린트가 아닌 app.py에 위치합니다.
# 이유: 토큰 기반 공개 접근으로 프로젝트 컨텍스트가 필요하지 않으며,
# Google Calendar 등 외부 서비스에서 인증 없이 접근해야 하기 때문입니다.
@app.route('/public/calendar/<token>.ics')
def public_calendar_subscription(_token):
    return (
        "Project calendar subscriptions are no longer available. "
        "This service has been migrated to ITMA.",
        410,
    )


@app.route('/project/')
def legacy_project_root():
    return redirect(url_for('itma.page'))


@app.route('/project/<path:_path>')
def legacy_project_paths(_path):
    return redirect(url_for('itma.page'))


if __name__ == '__main__':
    init_db()
    ssl_context = None
    if app.config.get('PREFERRED_URL_SCHEME') == 'https':
        cert_path = app.config.get('SSL_CERT_PATH') or ''
        key_path = app.config.get('SSL_KEY_PATH') or ''
        if cert_path and key_path and os.path.isfile(cert_path) and os.path.isfile(key_path):
            ssl_context = (cert_path, key_path)
            app.config['SESSION_COOKIE_SECURE'] = True
            print(f"[INFO] HTTPS enabled. cert={cert_path}, key={key_path}")
        else:
            print('[WARN] HTTPS enable failed: SSL cert/key file not found. Starting with HTTP.')

    app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False, ssl_context=ssl_context)
