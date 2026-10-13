@echo off
setlocal
echo ========================================
echo  Respaldo local EcoRuta (pg_dump)
echo ========================================

if "%DB_NAME%"=="" set "DB_NAME=ruteo_db"
if "%PG_BIN%"=="" set "PG_BIN=E:\postgre\bin"
if "%DB_USER%"=="" set "DB_USER=postgres"
if "%DB_PASSWORD%"=="" set "DB_PASSWORD=Zelaya11"

set "OUT_DIR=%~dp0dumps"
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"
set "STAMP=%DATE:~-4%%DATE:~3,2%%DATE:~0,2%_%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%"
set "STAMP=%STAMP: =0%"
set "OUT_FILE=%OUT_DIR%\%DB_NAME%_%STAMP%.sql"

set PGPASSWORD=%DB_PASSWORD%
echo Dump de %DB_NAME% a %OUT_FILE% ...
"%PG_BIN%\pg_dump.exe" -U %DB_USER% -h localhost -p 5432 -d %DB_NAME% --no-owner --no-privileges -f "%OUT_FILE%"
if errorlevel 1 (
    echo ERROR: fallo el respaldo.
    pause
    exit /b 1
)
echo.
echo OK: respaldo creado en %OUT_FILE%
pause
