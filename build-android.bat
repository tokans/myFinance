@echo off
REM ----------------------------------------------------------------------
REM  myFinance - one-double-click Android build + emulator launcher.
REM  Builds the debug APK and runs it in an Android emulator with live
REM  reload (Tauri `android dev`). Close the emulator or press Ctrl+C to stop.
REM
REM  Prerequisites (one-time, already set up on the dev machine):
REM    Node.js, Rust + android targets, JDK 17, Android SDK + NDK,
REM    Docker Desktop (used once to cross-build libsodium for Android),
REM    and at least one AVD created in Android Studio's Device Manager.
REM ----------------------------------------------------------------------

setlocal enabledelayedexpansion
cd /d "%~dp0"

REM --- Toolchain on PATH for this session -------------------------------
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

REM --- Android SDK location ---------------------------------------------
if "%ANDROID_HOME%"=="" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not exist "%ANDROID_HOME%" (
  echo [ERROR] Android SDK not found at "%ANDROID_HOME%".
  echo         Set ANDROID_HOME to your SDK path and re-run.
  pause
  exit /b 1
)
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "PATH=%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\emulator;%ANDROID_HOME%\cmdline-tools\latest\bin;%PATH%"

REM --- NDK location (auto-pick the newest installed version) ------------
if "%NDK_HOME%"=="" (
  for /f "delims=" %%v in ('dir /b /ad /o-n "%ANDROID_HOME%\ndk" 2^>nul') do (
    set "NDK_HOME=%ANDROID_HOME%\ndk\%%v"
    goto :ndk_done
  )
)
:ndk_done
if "%NDK_HOME%"=="" (
  echo [ERROR] No NDK found under "%ANDROID_HOME%\ndk".
  echo         Install one via Android Studio ^> SDK Manager ^> SDK Tools ^> NDK.
  pause
  exit /b 1
)

REM --- JDK ---------------------------------------------------------------
if "%JAVA_HOME%"=="" (
  echo [ERROR] JAVA_HOME is not set. Point it at a JDK 17 install.
  pause
  exit /b 1
)

echo === Toolchain ===
echo   ANDROID_HOME = %ANDROID_HOME%
echo   NDK_HOME     = %NDK_HOME%
echo   JAVA_HOME    = %JAVA_HOME%
echo.

REM --- Sanity checks for required CLIs ----------------------------------
where cargo >nul 2>nul || ( echo [ERROR] Rust/cargo not installed. & pause & exit /b 1 )
where npm   >nul 2>nul || ( echo [ERROR] Node.js/npm not installed. & pause & exit /b 1 )

REM --- JS deps ----------------------------------------------------------
if not exist node_modules (
  echo === Installing JS deps ===
  call npm install --no-audit --no-fund || exit /b 1
)

REM --- libsodium.a for Android (built once via Docker) ------------------
REM  Stronghold's libsodium-sys-stable has no Android prebuilt and cannot
REM  autotools-build on Windows. We cross-build a version-exact static lib
REM  in a Linux container; the result is cached under src-tauri\vendor.
set "SODIUM_VENDOR=%CD%\src-tauri\vendor\libsodium"
set "SODIUM_IMAGE=myfinance-libsodium-android:1.0.22"
if exist "%SODIUM_VENDOR%\x86_64-linux-android\libsodium.a" (
  if exist "%SODIUM_VENDOR%\aarch64-linux-android\libsodium.a" goto :sodium_done
)

echo === Building Android libsodium.a (one-time, uses Docker) ===
where docker >nul 2>nul || ( echo [ERROR] Docker is required for the one-time libsodium build. Start Docker Desktop and re-run. & pause & exit /b 1 )
docker version >nul 2>nul || ( echo [ERROR] Docker daemon not reachable. Start Docker Desktop and re-run. & pause & exit /b 1 )

docker build -t "%SODIUM_IMAGE%" -f scripts\android\Dockerfile.libsodium scripts\android || ( echo [ERROR] Docker image build failed. & pause & exit /b 1 )

if not exist "%SODIUM_VENDOR%" mkdir "%SODIUM_VENDOR%"
docker run --rm -v "%SODIUM_VENDOR%:/out" "%SODIUM_IMAGE%" || ( echo [ERROR] Copying libsodium.a out of the container failed. & pause & exit /b 1 )
echo === libsodium.a ready under src-tauri\vendor\libsodium ===
echo.
:sodium_done

REM --- Ensure an emulator/device is connected ---------------------------
REM Count attached devices (lines after the "List of devices" header that say "device").
set "DEVICE_COUNT=0"
for /f "skip=1 tokens=2" %%s in ('adb devices 2^>nul') do (
  if "%%s"=="device" set /a DEVICE_COUNT+=1
)

if %DEVICE_COUNT% GTR 0 (
  echo === Emulator/device already running, reusing it ===
  goto :run
)

echo === No device connected - starting an emulator ===
set "AVD="
for /f "delims=" %%a in ('emulator -list-avds 2^>nul') do (
  if not defined AVD set "AVD=%%a"
)
if "%AVD%"=="" (
  echo [ERROR] No AVD found. Create one in Android Studio ^> Device Manager.
  pause
  exit /b 1
)
echo   Booting AVD: %AVD%
start "Android Emulator" emulator -avd "%AVD%"

echo   Waiting for the device to come online...
adb wait-for-device
:wait_boot
for /f "tokens=*" %%b in ('adb shell getprop sys.boot_completed 2^>nul') do set "BOOTED=%%b"
if not "%BOOTED%"=="1" (
  ping -n 3 127.0.0.1 >nul
  goto :wait_boot
)
echo   Emulator is ready.
echo.

:run
REM --- Match libsodium.a to the emulator's CPU ABI ---------------------
adb shell getprop ro.product.cpu.abi > "%TEMP%\mf_abi.txt" 2>nul
set "RUST_TARGET="
findstr /c:"arm64-v8a"   "%TEMP%\mf_abi.txt" >nul && set "RUST_TARGET=aarch64-linux-android"
if not defined RUST_TARGET findstr /c:"armeabi-v7a" "%TEMP%\mf_abi.txt" >nul && set "RUST_TARGET=armv7-linux-androideabi"
if not defined RUST_TARGET findstr /c:"x86_64"      "%TEMP%\mf_abi.txt" >nul && set "RUST_TARGET=x86_64-linux-android"
if not defined RUST_TARGET findstr /c:"x86"         "%TEMP%\mf_abi.txt" >nul && set "RUST_TARGET=i686-linux-android"
del "%TEMP%\mf_abi.txt" >nul 2>nul

if not defined RUST_TARGET (
  echo [ERROR] Could not determine the emulator's CPU ABI from `adb getprop`.
  pause
  exit /b 1
)

if not exist "%SODIUM_VENDOR%\%RUST_TARGET%\libsodium.a" (
  echo [ERROR] No libsodium.a for %RUST_TARGET% under "%SODIUM_VENDOR%".
  echo         Delete src-tauri\vendor\libsodium and re-run to rebuild it.
  pause
  exit /b 1
)

REM Tell libsodium-sys-stable to link our prebuilt static lib (no source build).
set "SODIUM_LIB_DIR=%SODIUM_VENDOR%\%RUST_TARGET%"
echo === Target ABI: %RUST_TARGET% ===
echo   SODIUM_LIB_DIR = %SODIUM_LIB_DIR%

echo   Ensuring Rust target is installed...
rustup target add %RUST_TARGET% >nul 2>nul

REM --- Dev-server routing -----------------------------------------------
REM An emulator sits behind a NAT (newer images use virtio-wifi/netsim),
REM so the WebView reaching the host's LAN IP can stall for minutes before
REM the UI appears. Forward the Vite ports over adb and force Tauri to use
REM localhost. NOTE: the TAURI_DEV_HOST env var is NOT enough -- `tauri
REM android dev` re-detects the LAN IP and overwrites it. The `--host` CLI
REM flag is authoritative (it sets devUrl AND exports TAURI_DEV_HOST), so we
REM pass that. Physical Wi-Fi devices keep the LAN-IP autodetection.
set "DEV_SERIAL="
for /f "delims=" %%s in ('adb get-serialno 2^>nul') do set "DEV_SERIAL=%%s"
set "DEV_HOST_ARG="
echo %DEV_SERIAL% | findstr /b /c:"emulator-" >nul
if not errorlevel 1 (
  echo === Emulator detected ^(%DEV_SERIAL%^) - forwarding dev server via adb reverse ===
  adb reverse tcp:1420 tcp:1420 >nul
  adb reverse tcp:1421 tcp:1421 >nul
  set "DEV_HOST_ARG=-- --host 127.0.0.1"
  echo   Dev server pinned to 127.0.0.1 ^(Vite 1420, HMR 1421 via adb reverse^)
) else (
  echo === Physical device ^(%DEV_SERIAL%^) - using LAN IP autodetection ===
)

echo.
echo === Building APK and launching on the emulator (first build is slow) ===
call npm run tauri:android:dev %DEV_HOST_ARG% || exit /b 1

endlocal
