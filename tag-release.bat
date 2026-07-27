@echo off
REM One-click: (re)create a version tag and push it, triggering the GitHub
REM Actions release workflow (build + zip + publish Release from RELEASE_NOTES.md).
REM Run this AFTER push.bat. If the tag already exists (e.g. a failed run), it is
REM moved to the current commit automatically.

cd /d "%~dp0"

set "ver=%1"
if "%ver%"=="" set /p "ver=Tag version (e.g. v4.0.0): "
if "%ver%"=="" (
  echo No version given.
  pause
  exit /b 1
)

REM Make sure the tag starts with "v" (v4.0.0). Add it if the user typed 4.0.0.
echo %ver%| findstr /b "v" >nul || set "ver=v%ver%"

echo.
echo === Removing any existing tag %ver% ^(local + remote, if present^) ===
git tag -d %ver% 2>nul
git push origin :refs/tags/%ver% 2>nul

echo.
echo === Creating tag %ver% on the current commit and pushing ===
git tag %ver%
git push origin %ver%

echo.
echo Done. Watch the build at: your repo -^> Actions tab.
echo The Release will appear under: your repo -^> Releases.
pause
