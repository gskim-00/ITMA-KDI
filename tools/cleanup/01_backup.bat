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

set "BK=backups\before_test_cleanup_%TS%.sql"
echo Backing up %DB_NAME% to %BK% ...
docker exec %DB_CONTAINER% pg_dump -U %DB_USER% -d %DB_NAME% --clean --if-exists > "%BK%" 2> "%OUT%\01_backup_error.txt"
set "RC=%errorlevel%"
for %%A in ("%BK%") do set "SIZE=%%~zA"
(
  echo time=%TS%
  echo file=%BK%
  echo exit_code=%RC%
  echo size_bytes=%SIZE%
) > "%OUT%\01_backup_result.txt"
if not "%RC%"=="0" (
  echo [ERROR] Backup failed. See output\01_backup_error.txt
) else (
  echo [OK] Backup done: %BK% - %SIZE% bytes
)
timeout /t 5
