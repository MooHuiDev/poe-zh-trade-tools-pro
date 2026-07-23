@echo off
REM One-click: stage all changes, commit, and push to GitHub.
REM Double-click this file (it lives in the project folder).

cd /d "%~dp0"

set "msg=%*"
if "%msg%"=="" set /p "msg=Commit message (press Enter for default): "
if "%msg%"=="" set "msg=Update"

echo.
echo === git add -A ===
git add -A

echo.
echo === git commit ===
git commit -m "%msg%"

echo.
echo === git push ===
git push
if errorlevel 1 (
  echo.
  echo Push was rejected - pulling remote changes then retrying...
  git pull origin main --no-rebase --no-edit
  git push
)

echo.
echo Done.
pause
