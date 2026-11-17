# 접속 정보
- admin / Admin123$
- Web : 38008
- HTTPS 구동

# ITMA - Flask 기반 프로젝트 관리 시스템

프로젝트 생명주기 관리, 일정 추적, 협력사 관리를 위한 엔터프라이즈급 웹 애플리케이션입니다.

## 📋 목차
- [주요 기능](#주요-기능)
- [기술 스택](#기술-스택)
- [프로젝트 구조](#프로젝트-구조)
- [설치 및 실행](#설치-및-실행)
- [환경 설정](#환경-설정)
- [데이터베이스](#데이터베이스)
- [개발 가이드](#개발-가이드)
- [배포](#배포)

## 주요 기능

### 👤 인증 및 권한 관리
- **로그인 시스템**: 사용자 인증 및 세션 관리
- **역할 기반 접근 제어 (RBAC)**: admin, manager, user 3단계 권한
- **강제 비밀번호 변경**: 초기 로그인 시 비밀번호 변경 강제
- **감사 로깅**: 모든 작업에 대한 접근 이력 기록

### 📊 ITMA 모듈 (핵심 기능)
- **프로젝트 관리**: 프로젝트 생성, 수정, 상태 추적
- **일정 관리**: Excel 파일 기반 프로젝트 일정 업로드 및 파싱
- **협력사 관리**: 프로젝트 참여 협력사 및 담당자 정보 관리
- **파일 관리**: 프로젝트별 문서 및 산출물 업로드/다운로드
- **Excel 연동**: `.xlsx`, `.xls` 파일 자동 파싱 및 DB 저장

### ⚙️ 관리자 기능
- **사용자 관리**: 사용자 추가, 수정, 삭제, 비활성화
- **시스템 설정**: 
  - 서버명, URL 스킴 설정
  - 최대 파일 업로드 크기 설정
  - HTTPS/SSL 인증서 관리
  - SMTP 이메일 설정
- **이메일 설정**: 이메일 템플릿 관리 및 발송 설정
- **데이터베이스 백업**: 자동/수동 백업 기능

### 📧 이메일 기능
- **템플릿 기반 발송**: 맞춤형 이메일 템플릿
- **SMTP 설정**: DB에서 동적 설정 가능
- **이메일 로깅**: 발송 이력 추적

## 기술 스택

### Backend
| 항목 | 기술 |
|------|------|
| 웹 프레임워크 | Flask 2.x |
| ORM | SQLAlchemy |
| 데이터베이스 | PostgreSQL 15 |
| 서버 | Gunicorn 25.x |
| 역프록시 | Nginx (HTTPS 지원) |

### Frontend
| 항목 | 기술 |
|------|------|
| UI 프레임워크 | Bootstrap 5.x |
| 템플릿 엔진 | Jinja2 |
| JavaScript | Vanilla JS (Dropzone, iCalendar) |

### DevOps
| 항목 | 기술 |
|------|------|
| 컨테이너 | Docker |
| 오케스트레이션 | Docker Compose |
| SSL/TLS | Nginx + OpenSSL |

### 라이브러리
```
Flask              # 웹 프레임워크
pandas             # Excel 데이터 처리
openpyxl           # Excel 파일 조작
psycopg2-binary    # PostgreSQL 드라이버
SQLAlchemy         # ORM
icalendar          # iCal 형식 처리
werkzeug           # WSGI 유틸리티
python-dotenv      # 환경 변수 관리
python-dateutil    # 날짜/시간 처리
geopy              # 지오코딩
folium             # 지도 시각화
psutil             # 시스템 정보
gunicorn           # WSGI 서버
```

## 프로젝트 구조

```
Project_flask_ITMA/
├── app.py                    # Flask 메인 애플리케이션
├── config.py                 # 설정 및 환경 변수
├── requirements.txt          # Python 의존성
├── docker-compose.yml        # Docker Compose 설정
├── Dockerfile                # Flask 애플리케이션 이미지
├── entrypoint.sh             # 컨테이너 시작 스크립트
├── .env                      # 환경 변수 (git 제외)
├── AGENTS.md                 # 개발 가이드
│
├── blueprints/               # Flask Blueprint (라우트)
│   ├── __init__.py
│   ├── auth.py               # 인증 관련 라우트
│   ├── admin.py              # 관리자 기능 라우트
│   └── ITMA.py               # ITMA 핵심 기능 라우트
│
├── models/                   # 데이터모델
│   ├── __init__.py
│   └── database.py           # DB 연결 및 테이블 정의
│
├── services/                 # 비즈니스 로직
│   ├── __init__.py
│   └── email_service.py      # 이메일 발송 로직
│
├── utils/                    # 유틸리티 함수
│   ├── __init__.py
│   └── helpers.py            # 공용 함수
│
├── templates/                # Jinja2 템플릿
│   ├── base.html             # 기본 레이아웃
│   ├── login.html            # 로그인 페이지
│   ├── admin.html            # 관리자 페이지
│   ├── force_change_password.html  # 강제 비밀번호 변경
│   ├── admin/                # 관리자 서브 템플릿
│   └── ITMA/                 # ITMA 서브 템플릿
│
├── static/                   # 정적 파일
│   ├── css/                  # 스타일시트
│   │   ├── common.css
│   │   ├── login.css
│   │   ├── admin.css
│   │   └── itma.css
│   └── js/                   # JavaScript
│       ├── base_common.js
│       ├── admin.js
│       ├── email-handler.js
│       ├── file_storage.js
│       └── ...
│
├── infra/                    # 인프라 설정
│   └── nginx/                # Nginx 설정
│       ├── Dockerfile        # Nginx 이미지
│       ├── conf.d/           # 설정 파일
│       ├── scripts/          # 초기화 스크립트
│       ├── ssl/              # SSL 인증서 (생성됨)
│       └── templates/        # Nginx 템플릿
│
├── uploads/                  # 업로드된 파일 저장소
├── backups/                  # 데이터베이스 백업
└── README.md                 # 프로젝트 문서
```

## 설치 및 실행

### 📦 사전 요구사항
- Docker & Docker Compose
- 또는 Python 3.8+, PostgreSQL 12+

### 🚀 Docker를 사용한 실행 (권장)

#### 1. 환경 설정
```bash
# .env 파일 생성
cp .env.example .env  # (있는 경우)

# 또는 직접 생성
cat > .env << EOF
SECRET_KEY=your-secret-key-here
DATABASE_URL=postgresql://jininfra:netkti00@db:5432/project_db
FLASK_ENV=development
SMTP_SERVER=mail.your-company.com
SMTP_PORT=465
SMTP_USERNAME=your-email@company.com
SMTP_PASSWORD=your-password
SENDER_EMAIL=noreply@company.com
SENDER_NAME=ITMA System
USE_TLS=True
DB_USER=jininfra
DB_PASSWORD=netkti00
DB_NAME=project_db
TLS_MODE=internal
EOF
```

#### 2. 컨테이너 시작
```bash
# 이미지 빌드 및 컨테이너 시작
docker-compose up -d --build

# 로그 확인
docker-compose logs -f web

# 상태 확인
docker-compose ps
```

#### 3. 서비스 접속
```
웹 애플리케이션: https://localhost:30080 또는 https://localhost:30443
PostgreSQL:     localhost:5432
```

### 💻 로컬 개발 환경 (Windows)

#### 1. Python 가상환경 설정
```bash
# 가상환경 생성
python -m venv venv

# 활성화
.\\venv\\Scripts\\activate

# 의존성 설치
pip install -r requirements.txt
```

#### 2. PostgreSQL 설정
```bash
# 데이터베이스 생성 및 마이그레이션
psql -U postgres -c "CREATE DATABASE project_db OWNER jininfra"
```

#### 3. 애플리케이션 실행
```bash
# Flask 개발 서버 시작
python app.py
```

## 환경 설정

### 필수 환경 변수 (.env)

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `SECRET_KEY` | Flask 세션 시크릿 | (필수) |
| `DATABASE_URL` | PostgreSQL 연결 URL | (필수) |
| `FLASK_ENV` | 실행 환경 | development |
| `SMTP_SERVER` | SMTP 서버 주소 | smtp.your-company.com |
| `SMTP_PORT` | SMTP 포트 | 587 |
| `SMTP_USERNAME` | SMTP 사용자명 | (선택) |
| `SMTP_PASSWORD` | SMTP 비밀번호 | (선택) |
| `TLS_MODE` | Nginx TLS 모드 | internal |
| `NGINX_SERVER_NAME` | 서버명 | _ (모든 호스트) |

### Docker 환경 변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `DB_USER` | DB 사용자 | jininfra |
| `DB_PASSWORD` | DB 비밀번호 | netkti00 |
| `DB_NAME` | DB 이름 | project_db |
| `DB_HOST` | DB 호스트 | db |
| `DB_PORT` | DB 포트 | 5432 |
| `WEB_HTTP_PORT` | HTTP 포트 | 30080 |
| `WEB_HTTPS_PORT` | HTTPS 포트 | 30443 |

## 데이터베이스

### 주요 테이블

#### users
사용자 정보 및 인증
```sql
CREATE TABLE users (
    username TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',  -- admin, manager, user
    real_name TEXT,
    email TEXT,
    last_login TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    must_change_password BOOLEAN DEFAULT FALSE
);
```

#### projects
프로젝트 정보
```sql
CREATE TABLE projects (
    id SERIAL PRIMARY KEY,
    project_code VARCHAR(20),
    client_name VARCHAR(100),
    project_name VARCHAR(200),
    start_date DATE,
    end_date DATE,
    status VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### project_members
프로젝트 참여 인원
```sql
CREATE TABLE project_members (
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    username VARCHAR(50) REFERENCES users(username) ON DELETE CASCADE,
    role_in_project VARCHAR(20),
    PRIMARY KEY (project_id, username)
);
```

#### project_files
프로젝트 파일 (문서, 산출물)
```sql
CREATE TABLE project_files (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    filename VARCHAR(255),
    file_path VARCHAR(550),
    file_type VARCHAR(20),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    uploaded_by VARCHAR(50)
);
```

### DB 초기화

```bash
# Docker 컨테이너에서 DB 초기화
docker-compose exec -T web python -c "from models.database import init_db; init_db()"

# 로컬에서 (venv 활성화 필수)
python -c "from models.database import init_db; init_db()"
```

## 개발 가이드

### 코드 스타일
- **Python**: PEP 8, 4칸 들여쓰기
- **JavaScript**: ES6+, 함수 표현식
- **CSS**: BEM 네이밍 규칙
- **한글**: UTF-8 인코딩 필수

### 파일 명명 규칙
| 항목 | 규칙 | 예제 |
|------|------|------|
| Python 모듈 | snake_case | `email_service.py` |
| JavaScript | snake_case 또는 kebab-case | `admin.js`, `email-handler.js` |
| CSS | kebab-case | `common.css`, `admin.css` |
| Jinja 템플릿 | snake_case | `admin.html`, `project_list.html` |

### 개발 워크플로우

#### 1. 기능 추가
```bash
# 1. 관련 라우트 확인
grep -r "function_name" blueprints/

# 2. 라우트 추가 (blueprints/*.py)
@app.route('/path', methods=['GET', 'POST'])
def handler():
    pass

# 3. 템플릿 작성 (templates/*.html)
# 4. JavaScript 추가 (static/js/*.js)
# 5. CSS 스타일 (static/css/*.css)
```

#### 2. 문법 검사
```bash
# Python 검사
python -m py_compile blueprints/your_module.py
python -m py_compile models/database.py

# JavaScript 검사
node --check static/js/your_script.js
```

#### 3. 테스트
```bash
# 컨테이너 로그 확인
docker-compose logs -f web

# 수동 테스트
curl http://localhost:30080/api/endpoint
```

### Blueprint 구조

각 Blueprint는 다음 구조를 따릅니다:

```python
# blueprints/auth.py
from flask import Blueprint, render_template, request, jsonify
from models import get_db_connection

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    """로그인 핸들러"""
    if request.method == 'GET':
        return render_template('login.html')
    # POST 처리
    return jsonify({'success': True})
```

## 배포

### 📦 프로덕션 배포

#### 1. HTTPS/SSL 설정

**외부 인증서 사용:**
```bash
# SSL 인증서 복사
cp /path/to/fullchain.pem infra/nginx/ssl/
cp /path/to/privkey.pem infra/nginx/ssl/

# .env 설정
TLS_MODE=external
```

**자체 서명 인증서 생성:**
```bash
TLS_MODE=internal  # .env에 설정
# Nginx가 자동으로 생성
```

#### 2. 환경 변수 설정
```bash
# 프로덕션 .env
FLASK_ENV=production
SECRET_KEY=<strong-random-key>
SESSION_COOKIE_SECURE=True
SESSION_COOKIE_HTTPONLY=True
DATABASE_URL=postgresql://user:password@prod-db.com:5432/itma_db
SMTP_SERVER=smtp.company.com
SMTP_PORT=465
```

#### 3. 데이터베이스 백업
```bash
# 자동 백업 설정 (cron)
0 2 * * * docker-compose exec -T db pg_dump -U jininfra project_db > backups/backup_$(date +\%Y\%m\%d).sql

# 수동 백업
docker-compose exec -T db pg_dump -U jininfra project_db > backups/manual_backup.sql
```

#### 4. 모니터링
```bash
# 컨테이너 상태 확인
docker-compose ps

# 로그 확인
docker-compose logs -f web --tail=100

# 디스크 사용량
du -sh uploads/ backups/
```

### 🔒 보안 체크리스트
- [ ] `.env` 파일 git 제외 (`.gitignore`)
- [ ] SECRET_KEY 강력한 난수로 설정
- [ ] DATABASE_URL 환경 변수로 관리
- [ ] SMTP 비밀번호 환경 변수로 관리
- [ ] HTTPS 인증서 유효성 확인
- [ ] 정기적 백업 스케줄 설정
- [ ] 접근 로그 모니터링 활성화

## 기본 계정

| 역할 | 사용자명 | 초기 비밀번호 | 설명 |
|------|---------|-------------|------|
| 관리자 | admin | Admin123# | 시스템 전체 관리 권한 |

⚠️ **보안 주의**: 프로덕션 배포 시 초기 비밀번호 반드시 변경하세요.

## 문제 해결

### 🔴 데이터베이스 연결 오류
```bash
# DB 상태 확인
docker-compose logs db

# DB 서비스 재시작
docker-compose restart db

# 컨테이너 재빌드
docker-compose down
docker-compose up -d --build
```

### 🔴 포트 충돌
```bash
# 사용 중인 포트 확인
netstat -ano | findstr :30080
lsof -i :30443

# docker-compose.yml에서 포트 변경
WEB_HTTP_PORT=30888
WEB_HTTPS_PORT=30889
```

### 🔴 SSL 인증서 오류
```bash
# Nginx SSL 폴더 확인
docker-compose exec nginx ls -la /etc/nginx/ssl/

# 인증서 다시 생성
rm infra/nginx/ssl/*.pem
docker-compose up -d nginx
```

## 라이선스

내부 사용 전용

## 지원

문제 발생 시 AGENTS.md의 개발 가이드를 참고하세요.#   T e s t i n g R e p o  
 