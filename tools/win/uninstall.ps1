# Removes the installed Keyframe Studio: its folder, its shortcuts and its entry in Settings > Apps.
# Projects and settings in %LOCALAPPDATA%\Keyframe Studio stay (delete that folder by hand to
# remove them too). It runs from a temporary copy, so it can remove its own folder.
param([string]$Target = $PSScriptRoot, [switch]$Here)
$ErrorActionPreference = 'Stop'
$Name = 'Keyframe Studio'
if (-not $Here) {
  $Copy = Join-Path $env:TEMP 'keyframe-studio-uninstall.ps1'
  Copy-Item -LiteralPath $PSCommandPath -Destination $Copy -Force
  Start-Process (Join-Path $PSHOME 'powershell.exe') -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$Copy`"", '-Here', '-Target', "`"$Target`"")
  exit 0
}
$Target = $Target.TrimEnd('\')
# Only a Keyframe Studio install folder is ever removed.
$IsInstall = (Test-Path -LiteralPath (Join-Path $Target 'current')) -and ((Test-Path -LiteralPath (Join-Path $Target 'Keyframe Studio.exe')) -or (Test-Path -LiteralPath (Join-Path $Target 'Keyframe Studio.cmd')))
if (-not $IsInstall) { throw "$Target is not a Keyframe Studio install folder." }

Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='Keyframe Studio.exe'" |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($Target + '\', [StringComparison]::OrdinalIgnoreCase) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

foreach ($Dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
  $Link = Join-Path $Dir "$Name.lnk"
  if (Test-Path -LiteralPath $Link) { Remove-Item -LiteralPath $Link -Force }
}
Remove-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\KeyframeStudio' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $Target -Recurse -Force

Add-Type -AssemblyName System.Windows.Forms
$Data = Join-Path $env:LOCALAPPDATA $Name
[System.Windows.Forms.MessageBox]::Show("Keyframe Studio is removed. Your projects and settings are still in $Data.", $Name) | Out-Null
