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


(
echo ===== containers =====
docker ps -a --format "{{.Names}} | {{.Image}} | {{.Status}} | {{.CreatedAt}}"
echo ===== compose projects =====
docker compose ls -a
echo ===== web container labels/mounts =====
docker inspect flask_ITMA_WEB --format "project={{index .Config.Labels \"com.docker.compose.project\"}} workdir={{index .Config.Labels \"com.docker.compose.project.working_dir\"}} configfiles={{index .Config.Labels \"com.docker.compose.project.config_files\"}}"
docker inspect flask_ITMA_WEB --format "{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}"
echo ===== db container =====
docker inspect flask_ITMA_db --format "project={{index .Config.Labels \"com.docker.compose.project\"}} workdir={{index .Config.Labels \"com.docker.compose.project.working_dir\"}}"
echo ===== images =====
docker images --format "{{.Repository}}:{{.Tag}} | {{.ID}} | {{.CreatedAt}}"
) > "%OUT%\docker_info.txt" 2>&1
echo Done.
timeout /t 3
