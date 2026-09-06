@echo off
setlocal
set "SX=%~dp0"
if not exist "%SX%jre\bin\java.exe" (
  echo JRE missing - run setup.ps1 first
  exit /b 1
)
if not exist "%SX%sikulixide-2.0.5-win.jar" (
  echo IDE jar missing - run setup.ps1 first
  exit /b 1
)
REM Detach with javaw so the IDE runs without a console window.
start "" "%SX%jre\bin\javaw.exe" -Xms256m -Xmx1024m -XX:+UseG1GC -jar "%SX%sikulixide-2.0.5-win.jar" %*
exit /b 0