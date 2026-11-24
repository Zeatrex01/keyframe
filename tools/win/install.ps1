# Installs Keyframe Studio for this Windows user (no administrator rights): the package goes to
# %LOCALAPPDATA%\Programs\Keyframe Studio, with Start menu and desktop shortcuts and an entry in
# Settings > Apps to remove it. Projects and settings live in %LOCALAPPDATA%\Keyframe Studio and
# are never touched. Run by Install.cmd (from the unpacked package) or by the setup .exe.
param(
  [string]$Source = (Join-Path $PSScriptRoot '..\..'),
  [switch]$NoLaunch,
  [switch]$NoShortcuts
)
$ErrorActionPreference = 'Stop'
$Name = 'Keyframe Studio'
$Source = (Resolve-Path -LiteralPath $Source).Path.TrimEnd('\')
$Dest = Join-Path $env:LOCALAPPDATA "Programs\$Name"
$Current = (Get-Content -LiteralPath (Join-Path $Source 'current') -Raw).Trim()
if ($Current -notmatch '^app-[0-9A-Za-z.\-]+$') { throw "The package names no version in 'current'." }
$Version = $Current -replace '^app-', ''

# A studio running from the install folder holds its files: stop it first.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($Dest + '\', [StringComparison]::OrdinalIgnoreCase) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
if ($Source -ne $Dest.TrimEnd('\')) {
  $Target = Join-Path $Dest $Current
  if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }
  Copy-Item -LiteralPath (Join-Path $Source $Current) -Destination $Dest -Recurse -Force
  foreach ($f in @('Keyframe Studio.exe', 'Keyframe Studio.cmd', 'keyframe.ico', 'keyframe-mcp.cmd', 'README.txt')) {
    $p = Join-Path $Source $f
    if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $Dest -Force }
  }
}
Copy-Item -LiteralPath (Join-Path $Source "$Current\install\uninstall.ps1") -Destination (Join-Path $Dest 'uninstall.ps1') -Force

# The version installed before stays as 'previous', so the launcher can go back to it.
$CurrentFile = Join-Path $Dest 'current'
if (Test-Path -LiteralPath $CurrentFile) {
  $Was = (Get-Content -LiteralPath $CurrentFile -Raw).Trim()
  if ($Was -and $Was -ne $Current -and (Test-Path -LiteralPath (Join-Path $Dest $Was))) {
    [IO.File]::WriteAllText((Join-Path $Dest 'previous'), "$Was`r`n")
  }
}
[IO.File]::WriteAllText($CurrentFile, "$Current`r`n")
Get-ChildItem -LiteralPath $Dest -Recurse -File | Unblock-File

$Exe = Join-Path $Dest 'Keyframe Studio.exe'
if (-not (Test-Path -LiteralPath $Exe)) { $Exe = Join-Path $Dest 'Keyframe Studio.cmd' }
$Icon = Join-Path $Dest 'keyframe.ico'
if (-not $NoShortcuts) {
  $Shell = New-Object -ComObject WScript.Shell
  foreach ($Dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
    $Link = $Shell.CreateShortcut((Join-Path $Dir "$Name.lnk"))
    $Link.TargetPath = $Exe
    $Link.WorkingDirectory = $Dest
    $Link.IconLocation = "$Icon,0"
    $Link.Description = 'Describe it. Watch it move.'
    $Link.Save()
  }
}

$Key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\KeyframeStudio'
New-Item -Path $Key -Force | Out-Null
$Uninstall = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $Dest 'uninstall.ps1') + '"'
$Strings = @{ DisplayName = $Name; DisplayVersion = $Version; Publisher = 'Keyframe Studio contributors'; DisplayIcon = $Icon;
  InstallLocation = $Dest; UninstallString = $Uninstall; URLInfoAbout = 'https://github.com/Zeatrex01/keyframe' }
foreach ($k in $Strings.Keys) { New-ItemProperty -Path $Key -Name $k -Value $Strings[$k] -PropertyType String -Force | Out-Null }
foreach ($k in @('NoModify', 'NoRepair')) { New-ItemProperty -Path $Key -Name $k -Value 1 -PropertyType DWord -Force | Out-Null }

Write-Host "Keyframe Studio $Version is installed in $Dest"
if (-not $NoLaunch) { Start-Process -FilePath $Exe -WorkingDirectory $Dest }
