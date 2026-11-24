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

echo Collecting data list ...
docker exec -i %DB_CONTAINER% psql -U %DB_USER% -d %DB_NAME% -P pager=off < "%~dp0inspect.sql" > "%OUT%\inspect.txt" 2>&1
echo exit_code=%errorlevel% time=%TS% > "%OUT%\02_inspect_result.txt"
echo [OK] Saved to output\inspect.txt
timeout /t 5
