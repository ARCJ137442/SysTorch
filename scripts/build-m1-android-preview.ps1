param(
    [ValidateSet('aarch64','x86_64')][string]$Abi = 'aarch64',
    [string]$SdkRoot = (Join-Path $env:LOCALAPPDATA 'Android/Sdk'),
    [string]$NdkVersion = '27.3.13750724',
    [string]$BuildId
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $BuildId) { $BuildId = (Get-Content (Join-Path $PSScriptRoot 'm1-candidate.json') -Raw | ConvertFrom-Json).build_id }
if ($BuildId -notmatch '^[A-Za-z0-9.-]+$') { throw 'Invalid preview build identifier.' }
$env:SYSTORCH_BUILD_REVISION = $BuildId
$artifactStamp = $BuildId -replace '^m1-systorch-', ''
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:ANDROID_NDK_HOME = Join-Path $SdkRoot "ndk/$NdkVersion"
$env:NDK_HOME = $env:ANDROID_NDK_HOME
$env:TAURI_ANDROID_PROJECT_PATH = Join-Path $repo 'src-tauri/gen/android'
$env:WRY_ANDROID_PACKAGE = 'io.github.arcj137442.systorch'
$env:WRY_ANDROID_PACKAGE_UNESCAPED = $env:WRY_ANDROID_PACKAGE
$env:TAURI_ANDROID_PACKAGE_UNESCAPED = $env:WRY_ANDROID_PACKAGE
$env:WRY_ANDROID_LIBRARY = 'systorch_shell'
$kotlin = Join-Path $env:TAURI_ANDROID_PROJECT_PATH 'app/src/main/java/io/github/arcj137442/systorch/generated'
$env:TAURI_CONFIG = Get-Content -LiteralPath (Join-Path $repo 'src-tauri/tauri.android.conf.json') -Raw
New-Item -ItemType Directory -Force $kotlin | Out-Null
$env:WRY_ANDROID_KOTLIN_FILES_OUT_DIR = $kotlin
$target = if ($Abi -eq 'aarch64') { 'aarch64-linux-android' } else { 'x86_64-linux-android' }
$jniAbi = if ($Abi -eq 'aarch64') { 'arm64-v8a' } else { 'x86_64' }
$flavor = if ($Abi -eq 'aarch64') { 'Arm64' } else { 'X86_64' }
$clangPrefix = if ($Abi -eq 'aarch64') { 'aarch64-linux-android' } else { 'x86_64-linux-android' }
$ndkBin = Join-Path $env:ANDROID_NDK_HOME 'toolchains/llvm/prebuilt/windows-x86_64/bin'
$clang = Join-Path $ndkBin "${clangPrefix}24-clang.cmd"
if (-not (Test-Path -LiteralPath $clang)) { throw 'Install the configured Android NDK before building.' }
[Environment]::SetEnvironmentVariable("CARGO_TARGET_$($target.Replace('-','_').ToUpperInvariant())_LINKER",$clang,'Process')
[Environment]::SetEnvironmentVariable("CC_$($target.Replace('-','_'))",$clang,'Process')
[Environment]::SetEnvironmentVariable("AR_$($target.Replace('-','_'))",(Join-Path $ndkBin 'llvm-ar.exe'),'Process')
[Environment]::SetEnvironmentVariable("RANLIB_$($target.Replace('-','_'))",(Join-Path $ndkBin 'llvm-ranlib.exe'),'Process')
Push-Location $repo
try {
    & npm run build --prefix ui
    if ($LASTEXITCODE -ne 0) { throw 'UI build failed.' }
    # Clear only the retired generated namespace before Cargo. Tauri tracks its
    # generated output files, not these WRY env vars; missing old outputs trigger
    # its official Kotlin generator for the new package/library.
    & (Join-Path $PSScriptRoot 'android/prepare-android-project.ps1')
    & cargo build --manifest-path src-tauri/Cargo.toml --package systorch-shell --target $target --features tauri/custom-protocol,m1-preview --lib --release --offline -j 2
    if ($LASTEXITCODE -ne 0) { throw 'Android Rust build failed.' }
    & (Join-Path $PSScriptRoot 'android/prepare-android-project.ps1')
    $project = $env:TAURI_ANDROID_PROJECT_PATH
    # Keep the maintained namespace/JNI classes. Only the installed test identity
    # differs, so the test APK never overwrites the stable app or its data.
    $gradle = Join-Path $project 'app/build.gradle.kts'
    $source = [IO.File]::ReadAllText($gradle)
    if (-not $source.Contains('jevM1Preview')) {
        $anchor = 'applicationId = "io.github.arcj137442.jevswitch"'
        if (-not $source.Contains($anchor)) { throw 'Generated Android applicationId anchor changed; review the preview patch.' }
        $source = $source.Replace($anchor, "$anchor`n        if (providers.gradleProperty(`"jevM1Preview`").orNull == `"true`") { applicationIdSuffix = `".m1preview`" }")
        [IO.File]::WriteAllText($gradle,$source)
    }
    $strings = Join-Path $project 'app/src/main/res/values/strings.xml'
    [xml]$xml = Get-Content -LiteralPath $strings -Raw
    foreach ($name in @('app_name','main_activity_title')) { $xml.SelectSingleNode("/resources/string[@name='$name']").InnerText = 'SysTorch M1 Preview' }
    $xml.Save($strings)
    Get-ChildItem (Join-Path $project 'app/src/main/res') -Recurse -File -Filter 'systorch_keepalive.xml' | ForEach-Object {
        $content = [IO.File]::ReadAllText($_.FullName).Replace('SysTorch','SysTorch M1 Preview')
        [IO.File]::WriteAllText($_.FullName,$content)
    }
    $jni = Join-Path $project "app/src/main/jniLibs/$jniAbi"
    New-Item -ItemType Directory -Force $jni | Out-Null
    Copy-Item -LiteralPath "src-tauri/target/$target/release/libsystorch_shell.so" -Destination (Join-Path $jni 'libsystorch_shell.so') -Force
    $legacyLibrary = Join-Path $jni 'libjev_switch_shell.so'
    if (Test-Path -LiteralPath $legacyLibrary) { Remove-Item -LiteralPath $legacyLibrary -Force }
    Push-Location $project
    try {
        & .\gradlew.bat ":app:assemble${flavor}Release" '-x' "rustBuild${flavor}Release" '-PjevM1Preview=true' '-Pkotlin.incremental=false' '--offline' '--no-daemon'
        if ($LASTEXITCODE -ne 0) { throw 'Android packaging failed.' }
    } finally { Pop-Location }
    $signingDir = Join-Path $env:LOCALAPPDATA 'JevSwitchM1Build'
    New-Item -ItemType Directory -Force $signingDir | Out-Null
    $credentialsPath = Join-Path $signingDir 'preview-signing.json'
    if (-not (Test-Path -LiteralPath $credentialsPath)) { throw 'Existing M1 signing credentials are required for compatible updates; do not generate a replacement key.' }
    $credentials = Get-Content -LiteralPath $credentialsPath -Raw | ConvertFrom-Json
    $env:M1_KEYSTORE_PASSWORD = $credentials.password
    $keystore = Join-Path $signingDir 'jev-switch-m1-preview.jks'
    if (-not (Test-Path -LiteralPath $keystore)) { throw 'Restore the existing M1 signing keystore before building an update.' }
    $apk = Get-ChildItem (Join-Path $project 'app/build/outputs/apk') -Recurse -File -Filter '*release-unsigned.apk' | Where-Object FullName -Match $flavor | Select-Object -First 1
    if (-not $apk) { throw 'Expected an unsigned release APK.' }
    $tools = Join-Path $SdkRoot 'build-tools/35.0.0'
    $destination = Join-Path $repo '.tmp/systorch-delivery'
    New-Item -ItemType Directory -Force $destination | Out-Null
    $aligned = Join-Path $destination "m1-$Abi-aligned.apk"
    $signed = Join-Path $destination "SysTorch-m1-preview-$artifactStamp-$Abi.apk"
    & (Join-Path $tools 'zipalign.exe') -p -f 4 $apk.FullName $aligned
    if ($LASTEXITCODE -ne 0) { throw 'zipalign failed.' }
    & (Join-Path $tools 'apksigner.bat') sign --ks $keystore --ks-pass env:M1_KEYSTORE_PASSWORD --key-pass env:M1_KEYSTORE_PASSWORD --ks-key-alias m1-preview --out $signed $aligned
    if ($LASTEXITCODE -ne 0) { throw 'Preview APK signing failed.' }
    $verificationOutput = @(& (Join-Path $tools 'apksigner.bat') verify --verbose --print-certs $signed)
    if ($LASTEXITCODE -ne 0) { throw 'Preview APK signature verification failed.' }
    $verificationOutput | Write-Output
    $fingerprint = & (Join-Path $PSScriptRoot 'android/parse-apksigner-certificate-fingerprint.ps1') -VerificationOutput $verificationOutput
    if ($fingerprint -ne '2C15DAA0102605E959ABCA45BAC21AEC07FE38F48C59C7E43A2ABEFE05B5B685') { throw 'M1 signer changed; this APK cannot update the previously delivered M1 app.' }
    Remove-Item -LiteralPath $aligned -Force
    Write-Output "M1 preview APK: $signed"
    Write-Output "SHA256: $((Get-FileHash -LiteralPath $signed -Algorithm SHA256).Hash)"
} finally {
    Remove-Item Env:M1_KEYSTORE_PASSWORD,Env:TAURI_CONFIG -ErrorAction SilentlyContinue
    Pop-Location
}
