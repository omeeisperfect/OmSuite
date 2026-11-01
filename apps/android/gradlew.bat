@echo off
REM OmSuite bootstrap wrapper for Windows: downloads Gradle 8.7 once, then runs it.
REM Requires PowerShell + network. CI may instead use gradle/gradle-build-action.
setlocal
set "CACHE_DIR=%USERPROFILE%\.gradle\wrapper\omsuite-gradle-8.7"
if not exist "%CACHE_DIR%\gradle-8.7\bin\gradle.bat" (
  if not exist "%CACHE_DIR%" mkdir "%CACHE_DIR%"
  powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://services.gradle.org/distributions/gradle-8.7-bin.zip' -OutFile '%CACHE_DIR%\gradle-8.7-bin.zip'"
  powershell -NoProfile -Command "Expand-Archive -Force '%CACHE_DIR%\gradle-8.7-bin.zip' '%CACHE_DIR%'"
)
"%CACHE_DIR%\gradle-8.7\bin\gradle.bat" %*
