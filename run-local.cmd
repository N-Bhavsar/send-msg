@echo off
setlocal

set ROOT=%~dp0

if not exist "%ROOT%backend\node_modules" (
  echo Installing backend dependencies...
  pushd "%ROOT%backend"
  call npm install
  popd
)

if not exist "%ROOT%frontend\node_modules" (
  echo Installing frontend dependencies...
  pushd "%ROOT%frontend"
  call npm install
  popd
)

start "backend" cmd /k "cd /d %ROOT%backend && npm run dev"
start "frontend" cmd /k "cd /d %ROOT%frontend && npm run dev"

echo Started backend and frontend in separate windows.
endlocal
