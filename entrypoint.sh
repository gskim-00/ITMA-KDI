#!/bin/bash
set -e

echo "⏳ Waiting for DB..."
python - <<'PY'
import time
from models import init_db
from psycopg2 import OperationalError

for i in range(10):
    try:
        init_db()
        print("✅ DB initialized")
        break
    except Exception as e:
        print(f"⚠️ DB init failed ({i+1}/10): {e}")
        time.sleep(3)
else:
    raise SystemExit("❌ DB init failed after retries")
PY

echo "🚀 Starting Gunicorn..."
exec gunicorn --bind 0.0.0.0:5000 \
  --workers 4 \
  --timeout 120 \
  --access-logfile - \
  --error-logfile - \
  app:app
