param(
    [string]$IconPath = (Join-Path $PSScriptRoot '../src-tauri/app-icon.png'),
    [string]$GeneratedPngPath = (Join-Path $PSScriptRoot '../src-tauri/icons/icon.png'),
    [string]$IcoPath = (Join-Path $PSScriptRoot '../src-tauri/icons/icon.ico')
)

$ErrorActionPreference = 'Stop'
$canonicalTorchIconSha256 = '75279A8A77CDE421EDFF56C79255A8C12366FFA424CD8918E05CB8535606B5A0'
$masterSvg = Join-Path $PSScriptRoot '../ui/src/brand/systorch.svg'
$canonicalMasterSvgSha256 = '567E4C4F50D11FEAD18A922F8BA4425BBEF677035F131F5CE77DDF5E3BF6A122'
function Get-NormalizedTextSha256([string]$Path) {
    # Git may check out text files with CRLF on Windows even when the committed
    # source uses LF. Hash normalized UTF-8 text so line-ending conversion is
    # not mistaken for a visual change to the canonical logo.
    $content = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $Path).Path)
    $normalized = $content -replace "`r`n?", "`n"
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($normalized)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToHexString($sha256.ComputeHash($bytes)) }
    finally { $sha256.Dispose() }
}
if ((Get-NormalizedTextSha256 $masterSvg) -ne $canonicalMasterSvgSha256) { throw 'The canonical routing-torch SVG changed; review and regenerate all icon surfaces.' }
if ((Get-FileHash -LiteralPath $IcoPath -Algorithm SHA256).Hash -ne '9568D66714075814CEB8775CC0BF67A7179411436FE8483200C4AF0BACCB0B7A') { throw 'ICO frames differ from the SVG-derived color master.' }
if ((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot '../src-tauri/icons/tray.png') -Algorithm SHA256).Hash -ne '3493EE4B44ECD1FDA968AE9FEE2D0D25A2F774C4AC69862171043753930EED4C') { throw 'Tray icon differs from the derived monochrome torch.' }
foreach ($derivedSvg in @('../src-tauri/app-icon.svg','../src-tauri/shell/icon.svg')) {
    if ((Get-NormalizedTextSha256 (Join-Path $PSScriptRoot $derivedSvg)) -ne (Get-NormalizedTextSha256 $masterSvg)) { throw 'Native SVG differs from the shared product master.' }
}

function Assert-MonochromeBitmap([System.Drawing.Bitmap]$Bitmap, [string]$Description) {
    for ($y = 0; $y -lt $Bitmap.Height; $y++) {
        for ($x = 0; $x -lt $Bitmap.Width; $x++) {
            $pixel = $Bitmap.GetPixel($x, $y)
            if ($pixel.A -gt 8 -and ($pixel.R -ne $pixel.G -or $pixel.G -ne $pixel.B)) {
                throw "$Description contains a colored pixel at ($x, $y); this small-system-icon variant must remain monochrome."
            }
        }
    }
}

$sourcePath = (Resolve-Path -LiteralPath $IconPath).Path
$sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
if ($sourceHash -ne $canonicalTorchIconSha256) {
    throw "The canonical app icon is not the canonical SVG-derived SysTorch routing torch master. SHA-256=$sourceHash"
}

Add-Type -AssemblyName System.Drawing
$trayBitmap = [System.Drawing.Bitmap]::FromFile((Join-Path $PSScriptRoot '../src-tauri/icons/tray.png'))
try { Assert-MonochromeBitmap $trayBitmap 'The small monochrome tray variant' } finally { $trayBitmap.Dispose() }
$sourceBitmap = [System.Drawing.Bitmap]::FromFile($sourcePath)
try {
    if ($sourceBitmap.Width -ne 512 -or $sourceBitmap.Height -ne 512) {
        throw 'The canonical SVG-derived SysTorch routing torch master must be 512x512 pixels.'
    }
}
finally {
    $sourceBitmap.Dispose()
}

$generatedPath = (Resolve-Path -LiteralPath $GeneratedPngPath).Path
$generatedBitmap = [System.Drawing.Bitmap]::FromFile($generatedPath)
$sourceBitmap = [System.Drawing.Bitmap]::FromFile($sourcePath)
try {
    if ($generatedBitmap.Size -ne $sourceBitmap.Size) {
        throw 'src-tauri/icons/icon.png must use the same 512x512 canvas as app-icon.png.'
    }
    for ($y = 0; $y -lt $sourceBitmap.Height; $y++) {
        for ($x = 0; $x -lt $sourceBitmap.Width; $x++) {
            if ($sourceBitmap.GetPixel($x, $y).ToArgb() -ne $generatedBitmap.GetPixel($x, $y).ToArgb()) {
                throw "src-tauri/icons/icon.png differs from app-icon.png at ($x, $y). Regenerate platform resources from the canonical master."
            }
        }
    }
}
finally {
    $sourceBitmap.Dispose()
    $generatedBitmap.Dispose()
}

$icoBytes = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $IcoPath).Path)
if ($icoBytes.Length -lt 22 -or [BitConverter]::ToUInt16($icoBytes, 0) -ne 0 -or [BitConverter]::ToUInt16($icoBytes, 2) -ne 1) {
    throw 'The Windows app ICO has an invalid header.'
}
$frameCount = [BitConverter]::ToUInt16($icoBytes, 4)
if ($frameCount -lt 6) {
    throw "The Windows app ICO contains only $frameCount frame(s); expected the standard small and large icon sizes."
}
$requiredSizes = @(16, 24, 32, 48, 64, 256)
$availableSizes = [Collections.Generic.HashSet[int]]::new()
for ($index = 0; $index -lt $frameCount; $index++) {
    $entryOffset = 6 + ($index * 16)
    $width = if ($icoBytes[$entryOffset] -eq 0) { 256 } else { [int]$icoBytes[$entryOffset] }
    $height = if ($icoBytes[$entryOffset + 1] -eq 0) { 256 } else { [int]$icoBytes[$entryOffset + 1] }
    if ($width -ne $height) { throw "ICO frame $index is not square ($width x $height)." }
    [void]$availableSizes.Add($width)
    $imageLength = [BitConverter]::ToUInt32($icoBytes, $entryOffset + 8)
    $imageOffset = [BitConverter]::ToUInt32($icoBytes, $entryOffset + 12)
    if ($imageLength -eq 0 -or $imageOffset + $imageLength -gt $icoBytes.Length) {
        throw "ICO frame $index has an invalid image range."
    }

    $imageBytes = [byte[]]::new([int]$imageLength)
    [Array]::Copy($icoBytes, [int]$imageOffset, $imageBytes, 0, [int]$imageLength)
    $payloadStream = [IO.MemoryStream]::new($imageBytes, $false)
    $frameStream = $null
    $writer = $null
    $frameIcon = $null
    $frameBitmap = $null
    try {
        # Modern icon generators embed PNG frames. Decode those payloads
        # directly; System.Drawing.Icon cannot reliably decode PNG-backed ICO
        # entries on every Windows runner. Keep the ICO wrapper fallback for
        # legacy DIB frames.
        if ($imageBytes.Length -ge 8 -and $imageBytes[0] -eq 0x89 -and $imageBytes[1] -eq 0x50 -and $imageBytes[2] -eq 0x4E -and $imageBytes[3] -eq 0x47) {
            $frameBitmap = [System.Drawing.Bitmap]::new($payloadStream)
        }
        else {
            $frameStream = [IO.MemoryStream]::new()
            $writer = [IO.BinaryWriter]::new($frameStream)
            $writer.Write([UInt16]0)
            $writer.Write([UInt16]1)
            $writer.Write([UInt16]1)
            $writer.Write($icoBytes, $entryOffset, 8)
            $writer.Write([UInt32]$imageLength)
            $writer.Write([UInt32]22)
            $writer.Write($imageBytes)
            $writer.Flush()
            $frameStream.Position = 0
            $frameIcon = [System.Drawing.Icon]::new($frameStream)
            $frameBitmap = $frameIcon.ToBitmap()
        }
        try {
            if ($frameBitmap.Width -ne $width -or $frameBitmap.Height -ne $height) {
                throw "ICO frame $index declared as $width x $height but decodes as $($frameBitmap.Width) x $($frameBitmap.Height)."
            }
        }
        finally {
            if ($null -ne $frameBitmap) { $frameBitmap.Dispose() }
            if ($null -ne $frameIcon) { $frameIcon.Dispose() }
        }
    }
    finally {
        if ($null -ne $writer) { $writer.Dispose() }
        if ($null -ne $frameStream) { $frameStream.Dispose() }
        $payloadStream.Dispose()
    }
}
foreach ($size in $requiredSizes) {
    if (-not $availableSizes.Contains($size)) {
        throw "The Windows app ICO is missing its $size x $size frame."
    }
}

Write-Host "Verified canonical SVG-derived SysTorch routing torch icon source: $sourceHash"
Write-Host "Verified color ICO frames: $((@($availableSizes) | Sort-Object -Unique) -join ', ')"
