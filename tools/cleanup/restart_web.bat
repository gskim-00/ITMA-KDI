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


echo Restarting web and nginx containers ...
(
echo ===== restart =====
docker compose restart web nginx
echo exit_code=%errorlevel%
timeout /t 8 >nul
echo ===== status =====
docker compose ps
echo ===== web log tail =====
docker logs --tail 25 flask_ITMA_WEB
) > "%OUT%\restart.txt" 2>&1
echo Done.
timeout /t 3
