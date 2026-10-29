param([string]$BuildId)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $BuildId) { $BuildId = (Get-Content (Join-Path $PSScriptRoot 'm1-candidate.json') -Raw | ConvertFrom-Json).build_id }
if ($BuildId -notmatch '^[A-Za-z0-9.-]+$') { throw 'Invalid preview build identifier.' }
$env:SYSTORCH_BUILD_REVISION = $BuildId
$artifactStamp = $BuildId -replace '^m1-systorch-', ''
Push-Location $repo
try {
    & npm run build --prefix ui
    if ($LASTEXITCODE -ne 0) { throw 'UI build failed.' }
    & cargo build --release --manifest-path rs/Cargo.toml -p systorch-daemon --locked --offline -j 2
    if ($LASTEXITCODE -ne 0) { throw 'Daemon build failed.' }
    $root = [IO.Path]::GetFullPath((Join-Path $repo '.tmp/systorch-windows-assets'))
    $allowed = [IO.Path]::GetFullPath((Join-Path $repo '.tmp')).TrimEnd('\') + '\'
    if (-not $root.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)) { throw 'Asset directory escaped the workspace temporary root.' }
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
    $ui = Join-Path $root 'ui/dist'
    New-Item -ItemType Directory -Force $ui | Out-Null
    Copy-Item -LiteralPath 'rs/target/release/systorch-daemon.exe' -Destination (Join-Path $root 'systorch-daemon.exe')
    Get-ChildItem 'ui/dist' -Force | Copy-Item -Destination $ui -Recurse
    New-Item -ItemType Directory -Force 'src-tauri/binaries' | Out-Null
    Copy-Item -LiteralPath 'rs/target/release/systorch-daemon.exe' -Destination 'src-tauri/binaries/systorch-daemon-x86_64-pc-windows-msvc.exe' -Force
    $env:SYSTORCH_STANDALONE_ASSET_DIR = $root
    $env:TAURI_CONFIG = '{"identifier":"io.github.arcj137442.jevswitch.m1preview","app":{"windows":[{"label":"main","title":"SysTorch · M1 Preview","url":"waiting.html","width":1100,"height":760,"minWidth":760,"minHeight":480,"visible":false,"resizable":true}]}}'
    $previewConfig = $env:TAURI_CONFIG | ConvertFrom-Json
    Add-Member -InputObject $previewConfig -NotePropertyName version -NotePropertyValue ((Get-Content ui/package.json -Raw | ConvertFrom-Json).version + '+' + $BuildId.Replace('-','.'))
    $env:TAURI_CONFIG = $previewConfig | ConvertTo-Json -Depth 8 -Compress
    & cargo test --manifest-path src-tauri/Cargo.toml --features standalone,m1-preview --release --locked --offline -j 2
    if ($LASTEXITCODE -ne 0) { throw 'Native shell tests failed.' }
    & cargo build --release --manifest-path src-tauri/Cargo.toml --features standalone,m1-preview --locked --offline -j 2
    if ($LASTEXITCODE -ne 0) { throw 'Standalone build failed.' }
    $destination = Join-Path $repo ".tmp/systorch-delivery/SysTorch-m1-preview-$artifactStamp-windows-x64.exe"
    New-Item -ItemType Directory -Force (Split-Path $destination) | Out-Null
    Copy-Item -LiteralPath 'src-tauri/target/release/systorch.exe' -Destination $destination -Force
    & (Join-Path $PSScriptRoot 'verify-windows-app-icon.ps1') -ExecutablePath $destination
    Write-Output "M1 preview EXE: $destination"
    Write-Output "SHA256: $((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash)"
} finally {
    Remove-Item Env:SYSTORCH_STANDALONE_ASSET_DIR,Env:TAURI_CONFIG,Env:SYSTORCH_BUILD_REVISION -ErrorAction SilentlyContinue
    Pop-Location
}
