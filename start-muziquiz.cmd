@echo off
setlocal
title MuziQuiz Server
cd /d "%~dp0"

rem Port comes from .env (PORT=...), default 3000.
set "PORT=3000"
if exist ".env" for /f "tokens=1,* delims==" %%A in ('findstr /b /i "PORT=" ".env"') do set "PORT=%%B"

echo ============================================
echo   MuziQuiz - starting on port %PORT%
echo ============================================

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Install Node.js 22.13 or newer before running MuziQuiz.
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=13)?0:1)"
if errorlevel 1 (
  echo [X] Node.js 22.13 or newer is required.
  pause
  exit /b 1
)
if not exist "server\dist\index.js" (
  echo [X] Build missing. Run npm install and npm run build with internet during setup.
  pause
  exit /b 1
)
if not exist "client\dist\index.html" (
  echo [X] Client build missing. Run npm run build during setup.
  pause
  exit /b 1
)

rem Stop the previous MuziQuiz still holding the port.
echo [1/3] Stopping any previous server on port %PORT%...
powershell -NoProfile -Command "$ids = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($ids) { foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Write-Host ('      stopped old process ' + $id) } } else { Write-Host '      nothing was running' }"
ping -n 2 127.0.0.1 >nul

rem Open the browser once the new server answers.
echo [2/3] Starting server...
start "" /b powershell -NoProfile -Command "for ($i=0; $i -lt 60; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 'http://localhost:%PORT%/' | Out-Null; Write-Host '[3/3] Ready - opening http://localhost:%PORT%/'; Start-Process 'http://localhost:%PORT%/'; break } catch { Start-Sleep -Milliseconds 500 } }"

echo       Keep this window open. Close it (or press Ctrl+C) to stop MuziQuiz.
echo.
call npm run start
echo.
echo MuziQuiz stopped.
pause
