@echo off
echo ===================================================
echo Updating Metro Alarm app icons...
echo ===================================================
python tools\generate-icons.py
if %ERRORLEVEL% EQU 0 (
    echo.
    echo [SUCCESS] Icons have been updated across Android, iOS, and in-app views!
) else (
    echo.
    echo [ERROR] Failed to update icons. Make sure Python is installed with Pillow.
)
echo.
pause
