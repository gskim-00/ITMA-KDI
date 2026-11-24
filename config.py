"""
Application configuration.
Loads environment variables and exposes global settings.
"""
import os

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    def load_dotenv(*args, **kwargs):
        return False


load_dotenv()

def _get_int_env(name, default):
    value = os.getenv(name, "")
    if value is None:
        return default
    value = str(value).strip()
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


class Config:
    """Default Flask config."""

    # Flask
    SECRET_KEY = os.getenv('SECRET_KEY')
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = os.getenv('SESSION_COOKIE_SAMESITE', 'Lax')
    SESSION_COOKIE_SECURE = os.getenv('SESSION_COOKIE_SECURE', 'False').lower() == 'true'

    # URL generation
    SERVER_NAME = os.getenv('SERVER_NAME', None)
    PREFERRED_URL_SCHEME = os.getenv('PREFERRED_URL_SCHEME', 'http')

    # Database
    DATABASE_URL = os.getenv('DATABASE_URL')

    # Uploads
    UPLOAD_FOLDER = 'uploads'
    MAX_CONTENT_LENGTH = 100 * 1024 * 1024  # 100MB
    ALLOWED_EXTENSIONS = {
        'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif',
        'xlsx', 'xls', 'csv', 'doc', 'docx', 'zip'
    }

    # SMTP
    SMTP_SERVER = os.getenv('SMTP_SERVER', 'smtp.your-company.com')
    SMTP_PORT = _get_int_env('SMTP_PORT', 587)
    SMTP_USERNAME = os.getenv('SMTP_USERNAME', 'your-email@company.com')
    SMTP_PASSWORD = os.getenv('SMTP_PASSWORD', 'your-password')
    SENDER_EMAIL = os.getenv('SENDER_EMAIL', SMTP_USERNAME)
    SENDER_NAME = os.getenv('SENDER_NAME', 'Project Management System')
    USE_TLS = os.getenv('USE_TLS', 'True').lower() == 'true'

    @staticmethod
    def init_app(app):
        if not os.path.exists(Config.UPLOAD_FOLDER):
            os.makedirs(Config.UPLOAD_FOLDER)


email_config = {
    'smtp_server': Config.SMTP_SERVER,
    'smtp_port': Config.SMTP_PORT,
    'smtp_username': Config.SMTP_USERNAME,
    'smtp_password': Config.SMTP_PASSWORD,
    'sender_email': Config.SENDER_EMAIL,
    'sender_name': Config.SENDER_NAME,
    'use_tls': Config.USE_TLS,
}
