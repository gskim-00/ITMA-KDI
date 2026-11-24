@echo off
setlocal
rem ITMA test data cleanup - common settings
set "DB_CONTAINER=flask_ITMA_db"
set "DB_USER=jininfra"
set "DB_NAME=project_db"
cd /d "%~dp0..\.."
set "OUT=%~dp0output"
if not exist "%OUT%" mkdir "%OUT%"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TS=%%i"
docker version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker is not running. > "%OUT%\%~n0_result.txt"
  echo [ERROR] Docker is not running. Start Docker Desktop first.
  pause
  exit /b 1
)
docker inspect -f "{{.State.Running}}" %DB_CONTAINER% 2>nul | findstr /i "true" >nul
if errorlevel 1 (
  echo [ERROR] Container %DB_CONTAINER% is not running. > "%OUT%\%~n0_result.txt"
  echo [ERROR] Container %DB_CONTAINER% is not running.
  pause
  exit /b 1
)


echo Resetting SMTP settings ...
docker exec -i %DB_CONTAINER% psql -U %DB_USER% -d %DB_NAME% -P pager=off < "%~dp0email_reset.sql" > "%OUT%\email_reset.txt" 2>&1
echo reset_exit_code=%errorlevel% >> "%OUT%\email_reset.txt"
echo Restarting web to recreate default settings ...
docker compose restart web >> "%OUT%\email_reset.txt" 2>&1
timeout /t 10 >nul
(
echo ===== after restart =====
docker exec %DB_CONTAINER% psql -U %DB_USER% -d %DB_NAME% -P pager=off -c "SELECT id, smtp_server, smtp_port, smtp_username, CASE WHEN COALESCE(smtp_password,'')='' THEN '(none)' ELSE '(set)' END AS pw, sender_email, sender_name, use_tls, updated_at FROM email_settings;"
docker logs --tail 8 flask_ITMA_WEB
) >> "%OUT%\email_reset.txt" 2>&1
echo Done. See output\email_reset.txt
timeout /t 3
