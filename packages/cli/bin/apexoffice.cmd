@echo off
rem apexoffice launcher for the packaged Windows app: <install>\resources\cli\apexoffice.cmd
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\Apex Office.exe" "%~dp0apexoffice.cjs" %*
endlocal
