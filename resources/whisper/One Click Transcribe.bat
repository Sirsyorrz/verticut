@echo off
color 0A
echo.
echo.
echo      8""""                                    8   8  8                                       8   8 8   8 8     
echo      8     eeeee eeeee eeeee eeee eeeee       8   8  8 e   e e  eeeee eeeee eeee eeeee        8 8   8 8  8     
echo      8eeee 8   8 8   "   8   8    8   8       8e  8  8 8   8 8  8   " 8   8 8    8   8        eee   eee  8e    
echo      88    8eee8 8eeee   8e  8eee 8eee8e eeee 88  8  8 8eee8 8e 8eeee 8eee8 8eee 8eee8e eeee 88  8 88  8 88    
echo      88    88  8    88   88  88   88   8      88  8  8 88  8 88    88 88    88   88   8      88  8 88  8 88    
echo      88    88  8 8ee88   88  88ee 88   8      88ee8ee8 88  8 88 8ee88 88    88ee 88   8      88  8 88  8 88eee 
echo.
echo.                                                                                                            

:: Localize variables, enable extended syntax
setlocal enableextensions

:: Check if files were dropped onto the batch file
if "%~1"=="" (
    echo Nothing to do. Read usage instruction at this link:
    echo https://github.com/Purfview/whisper-standalone-win/discussions/337
    echo.
    pause
    color
    exit /b
)

:: Tool's path
set "dp=%~dp0"

:: Initialize file list
set "file_list="

:: Enquote all file paths
:while
for %%F in ("%~1") do set "file_list=%file_list% "%%~F""
shift
if "%~1" neq "" goto while

:: Start processing
"%dp%faster-whisper-xxl.exe" %file_list% -pp -o source --batch_recursive --check_files --standard -f json srt -m medium


pause
color
exit /b