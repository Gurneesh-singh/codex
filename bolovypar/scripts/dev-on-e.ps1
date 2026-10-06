param(
  [ValidateSet('api', 'mobile', 'web', 'android', 'android-build')]
  [string]$Target = 'web',
  [int]$Port = 8082
)

$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodeDir = Join-Path $workspace '.tools\node-v24.19.0-win-x64'
if (-not (Test-Path -LiteralPath (Join-Path $nodeDir 'node.exe'))) {
  throw 'Install the Node.js 24 ZIP under .tools on E: before starting the project.'
}

$androidSdk = Join-Path $workspace '.android-sdk'
$androidUser = Join-Path $workspace '.android-avd'
$env:PATH = "$nodeDir;$(Join-Path $androidSdk 'platform-tools');$env:PATH"
$env:TEMP = Join-Path $workspace '.tmp'
$env:TMP = $env:TEMP
$env:npm_config_cache = Join-Path $workspace '.npm-cache'
$env:DOTSLASH_CACHE = Join-Path $workspace '.dotslash-cache'
$env:__UNSAFE_EXPO_HOME_DIRECTORY = Join-Path $workspace '.expo-home'
$env:SUPABASE_TELEMETRY_DISABLED = '1'
$env:ANDROID_HOME = $androidSdk
$env:ANDROID_SDK_ROOT = $androidSdk
$env:ANDROID_USER_HOME = $androidUser
$env:ANDROID_EMULATOR_HOME = $androidUser
$env:ANDROID_AVD_HOME = Join-Path $androidUser 'avd'
$env:ANDROID_SDK_HOME = $androidUser
New-Item -ItemType Directory -Force -Path $env:TEMP, $env:npm_config_cache, $env:DOTSLASH_CACHE, $env:__UNSAFE_EXPO_HOME_DIRECTORY, $androidUser | Out-Null

Push-Location $workspace
try {
  if ($Target -in @('android', 'android-build')) {
    $adb = Join-Path $androidSdk 'platform-tools\adb.exe'
    $emulator = Join-Path $androidSdk 'emulator\emulator.exe'
    if (-not (Test-Path -LiteralPath $adb) -or -not (Test-Path -LiteralPath $emulator)) {
      throw 'The Android SDK and emulator must be installed under .android-sdk on E:.'
    }
    if ($Target -eq 'android-build') {
      # Compile before starting the emulator so the native compiler has memory.
      # Gradle rejects the legacy SDK_HOME variable used by ADB.
      Remove-Item Env:ANDROID_SDK_HOME -ErrorAction SilentlyContinue
      $env:GRADLE_USER_HOME = Join-Path $workspace '.gradle-cache'
      $env:CMAKE_BUILD_PARALLEL_LEVEL = '1'
      New-Item -ItemType Directory -Force $env:GRADLE_USER_HOME | Out-Null
      $mobileDir = Join-Path $workspace 'mobile'
      $nativeDir = Join-Path $mobileDir 'android'
      if (-not (Test-Path -LiteralPath (Join-Path $nativeDir 'gradlew.bat'))) {
        Push-Location $mobileDir
        try {
          & (Join-Path $workspace 'node_modules\.bin\expo.cmd') prebuild --platform android --no-install
          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        } finally { Pop-Location }
      }
      Push-Location $nativeDir
      try {
        & (Join-Path $nativeDir 'gradlew.bat') app:assembleDebug -x lint -x test --configure-on-demand --build-cache "-PreactNativeDevServerPort=$Port" -PreactNativeArchitectures=x86_64 --max-workers=1 --no-parallel --no-daemon
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
      } finally { Pop-Location }
      $env:ANDROID_SDK_HOME = $androidUser
    }
    $devices = & $adb devices
    if (-not ($devices -match '^emulator-\d+\s+device$')) {
      $emulatorProcess = Start-Process -FilePath $emulator -ArgumentList @(
        '-avd', 'BoloVyapar_API35', '-no-window', '-no-audio',
        '-gpu', 'swiftshader', '-feature', '-Vulkan', '-no-snapshot', '-no-metrics'
      ) -WindowStyle Hidden -PassThru
      $ready = $false
      for ($attempt = 0; $attempt -lt 90; $attempt++) {
        if ($emulatorProcess.HasExited) { throw 'Android emulator exited before boot completed.' }
        if ((& $adb shell getprop sys.boot_completed 2>$null) -eq '1') {
          $ready = $true
          break
        }
        Start-Sleep -Seconds 2
      }
      if (-not $ready) { throw 'Android emulator did not finish booting within 3 minutes.' }
    }
    if ($Target -eq 'android-build') {
      $apk = Join-Path $workspace 'mobile\android\app\build\outputs\apk\debug\app-debug.apk'
      if (-not (Test-Path -LiteralPath $apk)) { throw 'Android build completed without an APK.' }
      & $adb install -r $apk
      exit $LASTEXITCODE
    }
    # VPN adapters can make Expo advertise a LAN address the emulator cannot reach.
    # Keep Metro on IPv4 LAN binding, then open it through ADB's localhost reverse tunnel.
    $env:REACT_NATIVE_PACKAGER_HOSTNAME = '127.0.0.1'
    & $adb reverse "tcp:$Port" "tcp:$Port" | Out-Null
    & (Join-Path $nodeDir 'npm.cmd') run start -w mobile -- --dev-client --android --port $Port --lan
    exit $LASTEXITCODE
  }
  & (Join-Path $nodeDir 'npm.cmd') run "dev:$Target"
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
