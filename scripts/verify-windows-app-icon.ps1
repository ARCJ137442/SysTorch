param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath,
    [string]$IconPath = (Join-Path $PSScriptRoot '../src-tauri/icons/icon.ico')
)

$ErrorActionPreference = 'Stop'
$sourceVerifier = Join-Path $PSScriptRoot 'verify-app-icon-source.ps1'
& $sourceVerifier -IcoPath $IconPath
$exePath = (Resolve-Path -LiteralPath $ExecutablePath).Path
$iconSourcePath = (Resolve-Path -LiteralPath $IconPath).Path

$expectedIcon = [System.Drawing.Icon]::new($iconSourcePath)
$embeddedIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($exePath)
if ($null -eq $embeddedIcon) {
    throw "Windows executable has no associated app icon: $exePath"
}

$expectedBitmap = $expectedIcon.ToBitmap()
$embeddedBitmap = $embeddedIcon.ToBitmap()
try {
    # Full-color app artwork is checked against the pinned SVG-derived ICO.
    # Only the separate small tray/status variant is required to be monochrome.
    if ($expectedBitmap.Size -ne $embeddedBitmap.Size) {
        throw "Windows executable icon dimensions do not match the SysTorch icon: $exePath"
    }

    for ($y = 0; $y -lt $expectedBitmap.Height; $y++) {
        for ($x = 0; $x -lt $expectedBitmap.Width; $x++) {
            if ($expectedBitmap.GetPixel($x, $y).ToArgb() -ne $embeddedBitmap.GetPixel($x, $y).ToArgb()) {
                throw "Windows executable icon does not match src-tauri/icons/icon.ico: $exePath"
            }
        }
    }
}
finally {
    $expectedBitmap.Dispose()
    $embeddedBitmap.Dispose()
    $expectedIcon.Dispose()
    $embeddedIcon.Dispose()
}

Write-Host "Verified SysTorch Windows app icon: $exePath"
