@echo off
rem Double-click to start PillCheck on Windows. Keep this window open; close it to stop.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22 or newer is required: https://nodejs.org & pause & exit /b 1)
if not exist node_modules\onnxruntime-web\dist\ort.wasm.bundle.min.mjs (
  call npm ci || (pause & exit /b 1)
)
node server.mjs --open
pause
