param([string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path)
$ErrorActionPreference = 'Stop'
$master = Join-Path $ProjectRoot 'ui/src/brand/systorch.svg'
$output = Join-Path $ProjectRoot '.tmp/systorch-torch-icons'
& cargo tauri icon $master --output $output
if ($LASTEXITCODE -ne 0) { throw 'SVG icon derivation failed.' }
Copy-Item -LiteralPath $master -Destination (Join-Path $ProjectRoot 'src-tauri/app-icon.svg') -Force
Copy-Item -LiteralPath $master -Destination (Join-Path $ProjectRoot 'src-tauri/shell/icon.svg') -Force
Copy-Item -LiteralPath (Join-Path $output 'icon.png') -Destination (Join-Path $ProjectRoot 'src-tauri/app-icon.png') -Force
Get-ChildItem -LiteralPath $output -Force | Copy-Item -Destination (Join-Path $ProjectRoot 'src-tauri/icons') -Recurse -Force
# Android notification/tile masks use the same paths, without the icon canvas.
[xml]$svg = Get-Content -LiteralPath $master -Raw
$svgNs = [Xml.XmlNamespaceManager]::new($svg.NameTable)
$svgNs.AddNamespace('s', 'http://www.w3.org/2000/svg')
$paths = $svg.SelectNodes('/s:svg/s:g/s:path', $svgNs)
if ($paths.Count -ne 3) { throw 'Torch geometry changed; review notification mask derivation.' }
# Same paths, a compact monochrome tray variant. Main app assets stay in color.
[xml]$mono = $svg.OuterXml
$monoNs = [Xml.XmlNamespaceManager]::new($mono.NameTable)
$monoNs.AddNamespace('s', 'http://www.w3.org/2000/svg')
$defs = $mono.SelectSingleNode('/s:svg/s:defs', $monoNs)
if ($defs) { [void]$defs.ParentNode.RemoveChild($defs) }
$mono.SelectSingleNode('/s:svg/s:rect', $monoNs).SetAttribute('fill', '#101010')
foreach ($path in $mono.SelectNodes('/s:svg/s:g/s:path', $monoNs)) {
    $path.SetAttribute('fill', $(if ($path.GetAttribute('data-role') -eq 'flame') { '#f5f5f5' } else { 'none' }))
    if ($path.HasAttribute('stroke')) { $path.SetAttribute('stroke', '#f5f5f5') }
}
$monoSvg = Join-Path $ProjectRoot 'src-tauri/icons/tray.svg'
[IO.File]::WriteAllText($monoSvg, $mono.OuterXml, [Text.UTF8Encoding]::new($false))
$monoOutput = Join-Path $ProjectRoot '.tmp/systorch-torch-mono-icons'
& cargo tauri icon $monoSvg --output $monoOutput
if ($LASTEXITCODE -ne 0) { throw 'Monochrome torch derivation failed.' }
Copy-Item -LiteralPath (Join-Path $monoOutput '32x32.png') -Destination (Join-Path $ProjectRoot 'src-tauri/icons/tray.png') -Force
$rows = @('<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="48" android:viewportHeight="48">', '  <group android:translateX="8" android:translateY="4">')
foreach ($path in $paths) {
    $attributes = @('android:pathData="' + $path.GetAttribute('d') + '"')
    $attributes += if ($path.GetAttribute('data-role') -eq 'flame') { 'android:fillColor="#FFF5F5F5"' } else { 'android:fillColor="@android:color/transparent"' }
    if ($path.HasAttribute('stroke')) { $attributes += 'android:strokeColor="#FFF5F5F5"'; $attributes += 'android:strokeWidth="' + $path.GetAttribute('stroke-width') + '"' }
    if ($path.HasAttribute('stroke-linejoin')) { $attributes += 'android:strokeLineJoin="' + $path.GetAttribute('stroke-linejoin') + '"' }
    $rows += '    <path ' + ($attributes -join ' ') + ' />'
}
$rows += '  </group>'; $rows += '</vector>'
$mask = Join-Path $ProjectRoot 'src-tauri/android/keepalive/src/main/res/drawable/ic_stat_jev_switch.xml'
[IO.File]::WriteAllLines($mask, $rows, [Text.UTF8Encoding]::new($false))
Write-Output "Torch master SHA256: $((Get-FileHash -LiteralPath $master -Algorithm SHA256).Hash)"
Write-Output "Derived PNG SHA256: $((Get-FileHash -LiteralPath (Join-Path $ProjectRoot 'src-tauri/app-icon.png') -Algorithm SHA256).Hash)"
