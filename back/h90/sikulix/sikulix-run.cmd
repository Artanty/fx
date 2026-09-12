@echo off
setlocal enabledelayedexpansion
set "SX=%~dp0"
if not exist "%SX%jre\bin\java.exe" (
  echo JRE missing - run setup.ps1 first
  exit /b 1
)
if not exist "%SX%sikulixide-2.0.5-win.jar" (
  echo IDE jar missing - run setup.ps1 first
  exit /b 1
)
if "%~1"=="" (
  echo Usage: sikulix-run.cmd ^<path-to-.sikuli-folder^> [args after --]
  exit /b 1
)
set "PROJ=%~1"
set "REST="
:args
shift
if "%~1"=="" goto launch
set "REST=!REST! "%~1""
goto args
:launch
"%SX%jre\bin\java.exe" -Xms256m -Xmx1024m -XX:+UseG1GC -jar "%SX%sikulixide-2.0.5-win.jar" -r "%PROJ%" %REST%
exit /b %ERRORLEVEL%