# 1. 최신 안정화 버전인 3.11-slim 사용
FROM python:3.11-slim-bookworm

# 2. 컨테이너 내 환경 변수 설정 (파이썬 로그 출력 최적화 + UTF-8 인코딩)
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV PYTHONIOENCODING=utf-8

# 3. 필수 패키지 설치 및 로케일 설정
RUN apt-get update && apt-get install -y \
    gcc \
    python3-dev \
    libpq-dev \
    postgresql-client-15 \
    locales \
    && echo "en_US.UTF-8 UTF-8" > /etc/locale.gen \
    && locale-gen \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 4. 라이브러리 설치 (캐시 활용을 위해 복사 먼저 수행)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# 5. 소스 복사
COPY . .

EXPOSE 5000

# 6. 운영 환경: Gunicorn으로 실행 (워커 4개, 타임아웃 120초)
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "4", "--timeout", "120", "--access-logfile", "-", "--error-logfile", "-", "app:app"]

# 7. 개발 환경 실행 시
#CMD ["python", "app.py"]

# 엔트리포인트 스크립트 복사
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
