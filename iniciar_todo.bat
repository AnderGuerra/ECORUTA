@echo off
title EcoRuta - Sistema NEXO
echo ===================================================
echo           Iniciando EcoRuta / NEXO
echo ===================================================
echo.

set "PG_DIR=%~dp0..\pgsql\pgsql\bin"
set "PG_DATA=%~dp0..\pgsql\data"

echo [1/3] Comprobando PostgreSQL...
tasklist /FI "IMAGENAME eq postgres.exe" 2>NUL | find /I /N "postgres.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo     ✅ PostgreSQL ya esta corriendo.
) else (
    echo     Iniciando PostgreSQL en puerto 5432...
    start "" /B "%PG_DIR%\postgres.exe" -D "%PG_DATA%" -p 5432
    timeout /t 3 /nobreak >nul
    echo     ✅ PostgreSQL iniciado.
)

echo.
echo [2/3] Configurando Java...
set "JAVA_HOME="
if exist "C:\Program Files\Eclipse Adoptium" (
    for /d %%d in ("C:\Program Files\Eclipse Adoptium\jdk-*") do (
        if exist "%%d\bin\javac.exe" set "JAVA_HOME=%%d"
    )
)
if defined JAVA_HOME (
    set "PATH=%JAVA_HOME%\bin;%PATH%"
    echo     ✅ JDK: %JAVA_HOME%
)

set "DB_PASSWORD=Zelaya11"
set "DB_USER=postgres"
set "DB_NAME=ruteo_db"
set "PORT=8080"
set "ORS_API_KEY=eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImE2Y2NjNjBiOTNiYjRlMTZiNmY2MDQxZGI3NWYyZTljIiwiaCI6Im11cm11cjY0In0="

echo.
echo [3/3] Iniciando Servidor Web Backend en puerto %PORT%...
cd /d "%~dp0backend"
start http://localhost:8080/
java -cp "target/classes;lib/*" com.ruteo.Main
pause
