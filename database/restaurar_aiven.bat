@echo off
setlocal
echo ========================================
echo  Restaurar respaldo en Aiven
echo ========================================

if "%AIVEN_DATABASE_URL%"=="" (
    echo ERROR: define AIVEN_DATABASE_URL primero, por ejemplo:
    echo   set AIVEN_DATABASE_URL=postgresql://avnadmin:PASS@host-aiven:port/defaultdb?sslmode=require
    pause
    exit /b 1
)
if "%PG_BIN%"=="" set "PG_BIN=E:\postgre\bin"

set "RESTORE_FILE=%~1"
if "%RESTORE_FILE%"=="" (
    for /f "delims=" %%f in ('dir /b /o-d "%~dp0dumps\*.sql" 2^>nul') do (
        if not defined RESTORE_FILE set "RESTORE_FILE=%~dp0dumps\%%f"
    )
)
if "%RESTORE_FILE%"=="" (
    echo ERROR: no hay dumps en database\dumps. Ejecuta primero respaldo_local.bat
    pause
    exit /b 1
)

echo Restaurando: %RESTORE_FILE%
echo Destino: %AIVEN_DATABASE_URL%
"%PG_BIN%\psql.exe" "%AIVEN_DATABASE_URL%" -v ON_ERROR_STOP=1 -q -f "%RESTORE_FILE%"
if errorlevel 1 (
    echo ERROR: fallo la restauracion.
    pause
    exit /b 1
)
echo.
echo OK: restauracion completada.
pause
