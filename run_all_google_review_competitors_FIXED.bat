@echo off
setlocal EnableExtensions EnableDelayedExpansion

title All Google Reviews Competitor Scraper FIXED

echo.
echo ============================================================
echo All Google Reviews Competitor Scraper FIXED
echo ============================================================
echo.

set "BASE_DIR=%USERPROFILE%\Downloads\reviews-main"
set "MAX_SCROLL_ATTEMPTS=350"
set "SCROLL_IDLE_LIMIT=35"

if not exist "!BASE_DIR!" (
    echo Search folder was not found:
    echo !BASE_DIR!
    echo.
    echo Expected the unzipped reviews repo at:
    echo !BASE_DIR!
    pause
    exit /b 1
)

cd /d "!BASE_DIR!"

echo Searching for google-reviews-scraper-pro repo under:
echo !BASE_DIR!
echo.

set "REPO_DIR="

for /f "delims=" %%F in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Path '!BASE_DIR!' -Filter start.py -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like '*google-reviews-scraper-pro*' } | Select-Object -First 1 -ExpandProperty DirectoryName"') do (
    set "REPO_DIR=%%F"
)

if not defined REPO_DIR (
    echo Could not find start.py inside any google-reviews-scraper-pro folder.
    echo.
    echo Open !BASE_DIR! and check that the scraper is extracted.
    echo You need a folder containing start.py somewhere under that path.
    echo.
    pause
    exit /b 1
)

echo Found repo folder:
echo !REPO_DIR!
echo.

cd /d "!REPO_DIR!"

if not exist "start.py" (
    echo start.py was not found in:
    echo !REPO_DIR!
    pause
    exit /b 1
)

echo Checking Python virtual environment...
echo.

if not exist ".venv\Scripts\activate.bat" (
    echo Existing .venv was not found.
    echo Creating a new virtual environment...
    echo.

    py -3 -m venv ".venv"

    if errorlevel 1 (
        echo Failed using py -3. Trying python...
        python -m venv ".venv"

        if errorlevel 1 (
            echo Failed to create Python virtual environment.
            echo Python may not be installed or visible in PATH.
            pause
            exit /b 1
        )
    )
)

call ".venv\Scripts\activate.bat"

echo.
echo Checking if required Python packages are installed...
echo.

python -c "import seleniumbase, yaml, rich, requests" >nul 2>nul

if errorlevel 1 (
    echo Requirements are missing or incomplete.
    echo Installing requirements now...
    echo.

    python -m pip install --upgrade pip setuptools wheel

    if errorlevel 1 (
        echo Failed to update pip.
        pause
        exit /b 1
    )

    if exist "requirements.txt" (
        python -m pip install -r requirements.txt
    ) else (
        python -m pip install "seleniumbase>=4.34.9" "googletrans==4.0.2" "tqdm>=4.66.3" "pymongo==4.12.0" "boto3==1.35.1" "fastapi==0.104.1" "uvicorn==0.24.0" "botocore~=1.35.99" "pydantic>=2.11.5,<3" "requests>=2.31.0" "rich>=13.7.0" "PyYAML>=6.0"
    )

    if errorlevel 1 (
        echo Failed to install requirements.
        pause
        exit /b 1
    )
) else (
    echo Required Python packages appear to be installed.
)

if not exist "configs" mkdir "configs"
if not exist "dbs" mkdir "dbs"
if not exist "exports" mkdir "exports"
if not exist "logs" mkdir "logs"
if not exist "review_images" mkdir "review_images"

set "RUN_SUMMARY_FILE=exports\all_google_reviews_run_summary_FIXED.txt"

echo All Google Reviews Competitor Scraper FIXED > "!RUN_SUMMARY_FILE!"
echo Started at: %DATE% %TIME% >> "!RUN_SUMMARY_FILE!"
echo Repo folder: !REPO_DIR! >> "!RUN_SUMMARY_FILE!"
echo. >> "!RUN_SUMMARY_FILE!"

set "POTTERS_URL=https://www.google.com/maps/search/?api=1&query=Potters+Pharmacy+St+Julians&query_place_id=ChIJ3dCu7mtFDhMRYBPbRR0pgtE"
set "MEDINA_URL=https://maps.google.com/?cid=9097653800733849470"
set "MELITA_URL=https://www.google.com/maps/place/?q=place_id:ChIJpcp202tFDhMR_b3Xh4kYZoY"
set "STELLA_MARIS_URL=https://www.google.com/maps/search/?api=1&query=Stella+Maris+Pharmacy+Sliema&query_place_id=ChIJ-whkjzxFDhMRhZJhSPuM0fo"
set "DRUGSHOP_QORMI_URL=https://www.google.com/maps/search/?api=1&query=Drugshop+Dispensary+Qormi+Vjal+De+La+Cruz&query_place_id=ChIJmyXHJTpbDhMRy2w3lg7cf68"
set "REMEDIES_CAMPUS_HUB_URL=https://www.google.com/maps/search/?api=1&query=Remedies+Pharmacy+and+Clinic+Campus+Hub+University+of+Malta+Tal+Qroqq+Msida&query_place_id=ChIJccmTIUtFDhMRjGNsW0mHJIE"
set "ST_MATTHEWS_URL=https://www.google.com/maps/search/?api=1&query=St+Matthews+Pharmacy+by+SkyPharma+Gzira&query_place_id=ChIJDX9R30lFDhMRzFU-qXOIt7w"
set "MEDICAID_GUDJA_URL=https://www.google.com/maps/search/?api=1&query=Medicaid+Pharmacy+62+Vjal+It+Torri+Gudja"
set "SPRINGS_MRABAT_URL=https://www.google.com/maps/search/?api=1&query=Springs+Mrabat+Pharmacy+5+Triq+L+Mrabat+Sliema"
set "BROWNS_ST_JULIANS_URL=https://www.google.com/maps/search/?api=1&query=Browns+Pharmacy+St+Julians+6+Pjazza+Qalb+ta+Gesu&query_place_id=ChIJO7Cl-ENFDhMRNXu2NypEd28"
set "KRYPTON_SWIEQI_URL=https://www.google.com/maps/search/?api=1&query=Krypton+Pharmacy+Triq+Ta+L+Ibrag+Swieqi&query_place_id=ChIJ6XEhd2BFDhMRnmiq1vMoQQc"
set "JVS_SWIEQI_URL=https://www.google.com/maps/search/?api=1&query=JVs+Pharmacy+8+Swieqi+Road+Swieqi&query_place_id=ChIJQUUeW2hFDhMRdestWdr9Poo"
set "ST_JULIANS_FIXED_URL=https://maps.google.com/?cid=3563888329817583384"

echo.
echo ============================================================
echo Starting all pharmacy scrapes
echo ============================================================
echo.
echo NOTE: Chrome runs in headless mode (no visible window). To give you a
echo clear "it is running" signal, a separate "Live progress" window will
echo open for each pharmacy with a live tail of the scraper log. That
echo window closes automatically when the pharmacy finishes and the next
echo one opens.
echo.
echo Do not click inside this CMD window while it runs.
echo If Google opens the wrong listing for a pharmacy, press Ctrl+C.
echo.

call :SCRAPE_ONE "potters_google_reviews" "Potters Google Reviews" "!POTTERS_URL!" "Potters Pharmacy St Julians"
call :SCRAPE_ONE "medina_google_reviews" "Medina Google Reviews" "!MEDINA_URL!" "El Medina Pharmacy"
call :SCRAPE_ONE "melita_google_reviews" "Melita Google Reviews" "!MELITA_URL!" "Melita Pharmacy St Julians"
call :SCRAPE_ONE "stella_maris_google_reviews" "Stella Maris Google Reviews" "!STELLA_MARIS_URL!" "Stella Maris Pharmacy Sliema"
call :SCRAPE_ONE "drugshop_dispensary_qormi_google_reviews" "Drugshop Dispensary Qormi Google Reviews" "!DRUGSHOP_QORMI_URL!" "Drugshop Dispensary Qormi"
call :SCRAPE_ONE "remedies_campus_hub_google_reviews" "Remedies Campus Hub Google Reviews" "!REMEDIES_CAMPUS_HUB_URL!" "Remedies Pharmacy and Clinic Campus Hub"
call :SCRAPE_ONE "st_matthews_google_reviews" "St Matthews Google Reviews" "!ST_MATTHEWS_URL!" "St Matthews Pharmacy by SkyPharma"
call :SCRAPE_ONE "medicaid_gudja_google_reviews" "Medicaid Gudja Google Reviews" "!MEDICAID_GUDJA_URL!" "Medicaid Pharmacy Gudja"
call :SCRAPE_ONE "springs_mrabat_sliema_google_reviews" "Springs Mrabat Sliema Google Reviews" "!SPRINGS_MRABAT_URL!" "Springs+ Mrabat Pharmacy Sliema"
call :SCRAPE_ONE "browns_pharmacy_st_julians_google_reviews" "Browns Pharmacy St Julians Google Reviews" "!BROWNS_ST_JULIANS_URL!" "Browns Pharmacy St Julians"
call :SCRAPE_ONE "krypton_pharmacy_swieqi_google_reviews" "Krypton Pharmacy Swieqi Google Reviews" "!KRYPTON_SWIEQI_URL!" "Krypton Pharmacy Swieqi"
call :SCRAPE_ONE "jvs_pharmacy_swieqi_google_reviews" "JVs Pharmacy Swieqi Google Reviews" "!JVS_SWIEQI_URL!" "JVs Pharmacy Swieqi"
call :SCRAPE_ONE "st_julians_pharmacy_fixed_google_reviews" "St Julians Pharmacy Fixed Google Reviews" "!ST_JULIANS_FIXED_URL!" "St Julians Pharmacy Fixed"

goto FINISHED_ALL

:SCRAPE_ONE
setlocal EnableDelayedExpansion

set "PHARMACY_SLUG=%~1"
set "PHARMACY_LABEL=%~2"
set "PHARMACY_URL=%~3"
set "PHARMACY_COMPANY=%~4"

set "CONFIG_PATH=configs\!PHARMACY_SLUG!_config.yaml"
set "DB_PATH=dbs\!PHARMACY_SLUG!_reviews.db"
set "EXPORT_DIR=exports\!PHARMACY_SLUG!"
set "IMAGE_DIR=review_images\!PHARMACY_SLUG!"
set "JSON_BACKUP_PATH=exports\!PHARMACY_SLUG!\!PHARMACY_SLUG!_backup.json"
set "JSON_EXPORT_PATH=exports\!PHARMACY_SLUG!\!PHARMACY_SLUG!.json"
set "LOG_FILE=!PHARMACY_SLUG!_scraper.log"
set "LIVE_WINDOW_TITLE=Live progress: !PHARMACY_SLUG!"

if not exist "!EXPORT_DIR!" mkdir "!EXPORT_DIR!"
if not exist "!IMAGE_DIR!" mkdir "!IMAGE_DIR!"
if not exist "logs" mkdir "logs"

echo.
echo ============================================================
echo Scraping: !PHARMACY_LABEL!
echo ============================================================
echo.
echo Company:
echo !PHARMACY_COMPANY!
echo.
echo URL:
echo !PHARMACY_URL!
echo.
echo Config:
echo !CD!\!CONFIG_PATH!
echo.
echo Database:
echo !CD!\!DB_PATH!
echo.
echo Export folder:
echo !CD!\!EXPORT_DIR!
echo.
echo A "Live progress" window will open shortly for this pharmacy so you
echo can see scraper activity in real time. Chrome runs headless.
echo.

echo ------------------------------------------------------------ >> "!RUN_SUMMARY_FILE!"
echo !PHARMACY_LABEL! >> "!RUN_SUMMARY_FILE!"
echo Company: !PHARMACY_COMPANY! >> "!RUN_SUMMARY_FILE!"
echo URL: !PHARMACY_URL! >> "!RUN_SUMMARY_FILE!"
echo Started: %DATE% %TIME% >> "!RUN_SUMMARY_FILE!"

(
echo headless: true
echo sort_by: 'newest'
echo scrape_mode: 'full'
echo stop_threshold: 0
echo max_reviews: 0
echo max_scroll_attempts: !MAX_SCROLL_ATTEMPTS!
echo scroll_idle_limit: !SCROLL_IDLE_LIMIT!
echo db_path: '!DB_PATH!'
echo convert_dates: true
echo download_images: false
echo image_dir: '!IMAGE_DIR!'
echo download_threads: 4
echo max_width: 1200
echo max_height: 1200
echo use_mongodb: false
echo use_s3: false
echo backup_to_json: true
echo json_path: '!JSON_BACKUP_PATH!'
echo replace_urls: false
echo preserve_original_urls: true
echo store_local_paths: false
echo log_level: 'INFO'
echo log_dir: 'logs'
echo log_file: '!LOG_FILE!'
echo custom_params:
echo   company: '!PHARMACY_COMPANY!'
echo   source: 'Google Maps'
echo url: '!PHARMACY_URL!'
) > "!CONFIG_PATH!"

echo Validating generated config...
python -c "import yaml; data=yaml.safe_load(open(r'!CONFIG_PATH!', encoding='utf-8')); print('CONFIG HEADLESS =', data.get('headless')); print('CONFIG URL =', data.get('url'))"

echo.
echo Opening Live progress window for !PHARMACY_LABEL!...
type nul > "logs\!LOG_FILE!"
start "!LIVE_WINDOW_TITLE!" cmd /c powershell -NoProfile -ExecutionPolicy Bypass -Command "$Host.UI.RawUI.WindowTitle='!LIVE_WINDOW_TITLE!'; Write-Host 'Live progress for !PHARMACY_LABEL!' -ForegroundColor Cyan; Write-Host '(this window closes automatically when this pharmacy finishes)' -ForegroundColor DarkGray; Write-Host ''; Get-Content -Path 'logs\!LOG_FILE!' -Wait -Tail 200 -ErrorAction SilentlyContinue"

echo.
echo Running scrape command now...
echo.

python -u start.py scrape --config "!CONFIG_PATH!" --db-path "!DB_PATH!" --url "!PHARMACY_URL!" --scrape-mode full --sort newest --max-scroll-attempts !MAX_SCROLL_ATTEMPTS! --scroll-idle-limit !SCROLL_IDLE_LIMIT! --download-images false --use-mongodb false --convert-dates true

set "SCRAPE_EXIT_CODE=!ERRORLEVEL!"

taskkill /FI "WINDOWTITLE eq !LIVE_WINDOW_TITLE!*" /F >nul 2>&1

if not "!SCRAPE_EXIT_CODE!"=="0" (
    echo.
    echo WARNING: Scrape failed or partially failed for !PHARMACY_LABEL!.
    echo Exit code: !SCRAPE_EXIT_CODE!
    echo Export will still be attempted in case partial data was saved.
    echo.
    echo Scrape result: FAILED OR PARTIAL, exit code !SCRAPE_EXIT_CODE! >> "!RUN_SUMMARY_FILE!"
) else (
    echo.
    echo Scrape finished for !PHARMACY_LABEL!.
    echo.
    echo Scrape result: FINISHED >> "!RUN_SUMMARY_FILE!"
)

echo.
echo Database stats for !PHARMACY_LABEL!:
echo.

python start.py db-stats --config "!CONFIG_PATH!" --db-path "!DB_PATH!"

echo.
echo Exporting CSV for !PHARMACY_LABEL!:
echo.

python start.py export --config "!CONFIG_PATH!" --db-path "!DB_PATH!" --format csv --output "!EXPORT_DIR!"

set "CSV_EXIT_CODE=!ERRORLEVEL!"

if not "!CSV_EXIT_CODE!"=="0" (
    echo CSV export failed for !PHARMACY_LABEL!.
    echo CSV export: FAILED, exit code !CSV_EXIT_CODE! >> "!RUN_SUMMARY_FILE!"
) else (
    echo CSV export finished for !PHARMACY_LABEL!.
    echo CSV export: FINISHED >> "!RUN_SUMMARY_FILE!"
)

echo.
echo Exporting JSON for !PHARMACY_LABEL!:
echo.

python start.py export --config "!CONFIG_PATH!" --db-path "!DB_PATH!" --format json --output "!JSON_EXPORT_PATH!"

set "JSON_EXIT_CODE=!ERRORLEVEL!"

if not "!JSON_EXIT_CODE!"=="0" (
    echo JSON export failed for !PHARMACY_LABEL!.
    echo JSON export: FAILED, exit code !JSON_EXIT_CODE! >> "!RUN_SUMMARY_FILE!"
) else (
    echo JSON export finished for !PHARMACY_LABEL!.
    echo JSON export: FINISHED >> "!RUN_SUMMARY_FILE!"
)

if exist "!JSON_EXPORT_PATH!" (
    copy /Y "!JSON_EXPORT_PATH!" "!JSON_BACKUP_PATH!" >nul
    echo Explicit backup JSON created:
    echo !CD!\!JSON_BACKUP_PATH!
    echo Explicit backup JSON: CREATED >> "!RUN_SUMMARY_FILE!"
) else (
    echo.
    echo WARNING: JSON export file was not found after export:
    echo !CD!\!JSON_EXPORT_PATH!
    echo Explicit backup JSON: NOT CREATED, JSON export missing >> "!RUN_SUMMARY_FILE!"
)

echo.
echo Checking created files for !PHARMACY_LABEL!...
echo.

if exist "!DB_PATH!" (
    echo DB OK: !CD!\!DB_PATH!
    echo DB file: EXISTS >> "!RUN_SUMMARY_FILE!"
) else (
    echo DB MISSING: !CD!\!DB_PATH!
    echo DB file: MISSING >> "!RUN_SUMMARY_FILE!"
)

if exist "!JSON_EXPORT_PATH!" (
    echo JSON OK: !CD!\!JSON_EXPORT_PATH!
    echo JSON file: EXISTS >> "!RUN_SUMMARY_FILE!"
) else (
    echo JSON MISSING: !CD!\!JSON_EXPORT_PATH!
    echo JSON file: MISSING >> "!RUN_SUMMARY_FILE!"
)

if exist "!JSON_BACKUP_PATH!" (
    echo BACKUP JSON OK: !CD!\!JSON_BACKUP_PATH!
    echo Backup JSON file: EXISTS >> "!RUN_SUMMARY_FILE!"
) else (
    echo BACKUP JSON MISSING: !CD!\!JSON_BACKUP_PATH!
    echo Backup JSON file: MISSING >> "!RUN_SUMMARY_FILE!"
)

echo Finished: %DATE% %TIME% >> "!RUN_SUMMARY_FILE!"
echo Export folder: !CD!\!EXPORT_DIR! >> "!RUN_SUMMARY_FILE!"
echo Database: !CD!\!DB_PATH! >> "!RUN_SUMMARY_FILE!"
echo JSON: !CD!\!JSON_EXPORT_PATH! >> "!RUN_SUMMARY_FILE!"
echo Backup JSON: !CD!\!JSON_BACKUP_PATH! >> "!RUN_SUMMARY_FILE!"
echo Log: !CD!\logs\!LOG_FILE! >> "!RUN_SUMMARY_FILE!"
echo. >> "!RUN_SUMMARY_FILE!"

endlocal
exit /b 0

:FINISHED_ALL

echo.
echo ============================================================
echo Finished all Google review scrapes
echo ============================================================
echo.
echo Repo folder:
echo !REPO_DIR!
echo.
echo Main exports folder:
echo !REPO_DIR!\exports
echo.
echo Run summary:
echo !REPO_DIR!\exports\all_google_reviews_run_summary_FIXED.txt
echo.

echo Finished at: %DATE% %TIME% >> "!RUN_SUMMARY_FILE!"

start "" "!REPO_DIR!\exports"

pause
endlocal
exit /b 0