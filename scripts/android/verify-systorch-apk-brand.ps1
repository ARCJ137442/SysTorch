param(
    [Parameter(Mandatory=$true)][string]$Apk,
    [string]$BuildTools = "$env:LOCALAPPDATA/Android/Sdk/build-tools/35.0.0"
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$aapt = Join-Path $BuildTools 'aapt2.exe'
$resources = @(& $aapt dump resources $Apk)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect compiled APK resources.' }
$badging = @(& $aapt dump badging $Apk)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect APK package identity.' }
if (-not ($badging -match "application-label:'SysTorch'")) { throw 'Wrong APK display name.' }
if (-not ($badging -match "name='io.github.arcj137442.jevswitch'")) { throw 'Stable installed identity changed; check in-place upgrade compatibility.' }

function Get-PixelDigest([IO.Stream]$Stream) {
    $bitmap = [Drawing.Bitmap]::new($Stream)
    try {
        # Compare decoded pixels, independent of aapt PNG compression/palettes.
        $copy = $bitmap.Clone([Drawing.Rectangle]::new(0,0,$bitmap.Width,$bitmap.Height), [Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $bits = $copy.LockBits([Drawing.Rectangle]::new(0,0,$copy.Width,$copy.Height), [Drawing.Imaging.ImageLockMode]::ReadOnly, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
            try {
                $bytes = [byte[]]::new($bits.Stride * $copy.Height)
                [Runtime.InteropServices.Marshal]::Copy($bits.Scan0,$bytes,0,$bytes.Length)
                for ($i=0; $i -lt $bytes.Length; $i+=4) { if ($bytes[$i+3] -eq 0) { $bytes[$i]=0; $bytes[$i+1]=0; $bytes[$i+2]=0 } }
                return "$($copy.Width)x$($copy.Height):$([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)))"
            } finally { $copy.UnlockBits($bits) }
        } finally { $copy.Dispose() }
    } finally { $bitmap.Dispose() }
}

$expectedRoot = Join-Path ([IO.Path]::GetTempPath()) ('systorch-apk-icon-check-' + [Guid]::NewGuid().ToString('N'))
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Apk).Path)
try {
    & (Join-Path $repo 'scripts/verify-app-icon-source.ps1')
    New-Item -ItemType Directory -Path $expectedRoot -Force | Out-Null
    & cargo tauri icon (Join-Path $repo 'src-tauri/app-icon.png') --output $expectedRoot *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot derive the canonical Android raster variants.' }
    if (-not @($zip.Entries | Where-Object FullName -Match '^lib/[^/]+/libsystorch_shell\.so$').Count) { throw 'Missing renamed SysTorch native library.' }
    if (@($zip.Entries | Where-Object FullName -Match 'libjev_switch_shell\.so$').Count) { throw 'Retired native library is still packaged.' }
    $name = ''; $checked = 0; $adaptive = 0
    foreach ($line in $resources) {
        if ($line -match '^\s+resource \S+ (\S+)') { $name = $Matches[1] }
        if ($name -notmatch '^(drawable/ic_task|mipmap/ic_launcher(?:_round|_foreground)?)$') { continue }
        if ($line -notmatch '\(([^)]*)\) \(file\) (res/\S+) type=(PNG|XML)') { continue }
        $qualifier = $Matches[1]; $entryPath = $Matches[2]; $type = $Matches[3]
        if ($type -eq 'XML') {
            if ($qualifier -eq 'anydpi-v33') {
                $xml = @(& $aapt dump xmltree --file $entryPath $Apk)
                if ($LASTEXITCODE -ne 0 -or -not ($xml -match 'E: monochrome')) { throw 'Android themed icon is missing its torch mask.' }
                $adaptive++
            }
            continue
        }
        $source = if ($name -eq 'drawable/ic_task') { Join-Path $repo 'src-tauri/app-icon.png' } else { Join-Path $expectedRoot "android/mipmap-$qualifier/$($name.Split('/')[1]).png" }
        $entry = $zip.GetEntry($entryPath)
        if (-not $entry) { throw "Compiled icon resource missing: $entryPath" }
        $packed = $entry.Open(); $original = [IO.File]::OpenRead($source)
        try { if ((Get-PixelDigest $packed) -ne (Get-PixelDigest $original)) { throw "APK icon differs from canonical SVG derivative: $name ($qualifier)" } }
        finally { $packed.Dispose(); $original.Dispose() }
        $checked++
    }
    # Tauri supplies the primary launcher as adaptive and round launchers as
    # five raster densities. Verify that actual contract rather than assuming
    # a second adaptive resource exists in the generator's output.
    if ($checked -ne 16 -or $adaptive -ne 1) { throw "Incomplete icon surfaces: $checked raster resources, $adaptive Android 13 masks." }
    Write-Output "Verified SysTorch APK identity, native library, $checked canonical raster icons and $adaptive themed adaptive icons: $Apk"
} finally {
    $zip.Dispose()
    # Only the exact directory just created by this verification is disposable.
    if (Test-Path -LiteralPath $expectedRoot) { Remove-Item -LiteralPath $expectedRoot -Recurse -Force }
}
