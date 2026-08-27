<#
.SYNOPSIS
  Ultimate Baby Tracker - installer and background-service manager for Windows.

.DESCRIPTION
  Everything here runs as you, with no administrator rights and no UAC prompt.

  Windows Services proper do need admin, so the "service" here is a per-user
  Scheduled Task that starts at logon and restarts itself if it falls over.
  That is the same thing in practice for a machine you log into, and it is the
  only kind of background job an unprivileged account may create.

  Your entries live outside the application directory, so an update can never
  touch them, and every update snapshots them first anyway.

.EXAMPLE
  .\install.ps1 install
  .\install.ps1 update
  .\install.ps1 service add
  .\install.ps1 service remove
  .\install.ps1 status
#>

[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'update', 'uninstall', 'status', 'start', 'stop', 'restart', 'logs', 'service', 'help')]
  [string]$Action = 'help',

  [Parameter(Position = 1)]
  [ValidateSet('add', 'remove', 'status')]
  [string]$Sub,

  [int]$Port = 8477,
  [string]$Listen = '0.0.0.0',
  [string]$Branch = 'main',
  [string]$Dir,
  [string]$Data,
  [string]$Backups,
  [switch]$NoService,
  [switch]$Purge
)

$ErrorActionPreference = 'Stop'

$AppName     = 'Ultimate Baby Tracker'
$TaskName    = 'UltimateBabyTracker'
$RepoUrl     = 'https://github.com/fqazzazee/ultimate-baby-tracker'
$MinNodeMajor = 18

$root      = Join-Path $env:LOCALAPPDATA 'UltimateBabyTracker'
$AppDir    = if ($Dir)  { $Dir }  else { Join-Path $root 'app' }
$DataDir   = if ($Data) { $Data } else { Join-Path $root 'data' }
# Snapshots live beside the data they protect, so moving the data moves them.
$BackupDir = if ($Backups) { $Backups }
             elseif ($Data) { Join-Path (Split-Path $DataDir -Parent) 'backups' }
             else { Join-Path $root 'backups' }
$LogFile   = Join-Path $root 'service.log'
$VbsShim   = Join-Path $root 'run-hidden.vbs'
$CmdShim   = Join-Path $root 'run.cmd'

# ------------------------------------------------------------------- output --

function Say  { param([string]$m) Write-Host $m }
function Step { param([string]$m) Write-Host "==> $m" -ForegroundColor White }
function Ok   { param([string]$m) Write-Host "  * $m" -ForegroundColor Green }
function Warn { param([string]$m) Write-Host "  ! $m" -ForegroundColor Yellow }
function Die  { param([string]$m) Write-Host "error: $m" -ForegroundColor Red; exit 1 }
function Have { param([string]$c) [bool](Get-Command $c -ErrorAction SilentlyContinue) }

# ------------------------------------------------------------------- checks --

function Get-NodePath {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Die @"
Node.js is not installed, or is not on PATH. Node $MinNodeMajor or newer is required.

  Without admin rights:  winget install OpenJS.NodeJS.LTS --scope user
  Or download the .zip:  https://nodejs.org/en/download  (unzip, add to PATH)
"@
  }
  $version = (& node -p 'process.versions.node' 2>$null)
  $major = [int]($version -split '\.')[0]
  if ($major -lt $MinNodeMajor) {
    Die "Node $version is too old; this needs $MinNodeMajor or newer."
  }
  Ok "Node v$version"
  return $node.Source
}

# -------------------------------------------------------------- fetch code --

# A git clone makes updating a fetch, and lets you see what changed. Without
# git, fall back to the branch zip - Windows has had Expand-Archive built in
# since PowerShell 5, so there is nothing else to install.
function Get-Source {
  param([string]$Dest)

  if (Test-Path (Join-Path $Dest '.git')) {
    Step 'Updating the existing checkout'
    & git -C $Dest remote set-url origin $RepoUrl
    & git -C $Dest fetch --depth 1 origin $Branch  2>&1 | Out-Null
    & git -C $Dest checkout -q -B $Branch "origin/$Branch"
    & git -C $Dest reset --hard -q "origin/$Branch"
    Ok ("At " + (& git -C $Dest rev-parse --short HEAD) + " on $Branch")
    return
  }

  $parent = Split-Path $Dest -Parent
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }

  if (Have git) {
    Step "Cloning $RepoUrl ($Branch)"
    if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
    & git clone --depth 1 --branch $Branch $RepoUrl $Dest 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Die "Could not clone $RepoUrl. Check the network, or the branch name." }
    Ok ("At " + (& git -C $Dest rev-parse --short HEAD))
    return
  }

  Step "Downloading $Branch (git is not installed, so this is a zip)"
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("ubt-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  try {
    $zip = Join-Path $tmp 'src.zip'
    Invoke-WebRequest -Uri "$RepoUrl/archive/refs/heads/$Branch.zip" -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    # The archive nests everything under <repo>-<branch>\.
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
    New-Item -ItemType Directory -Path $Dest -Force | Out-Null
    Copy-Item (Join-Path $inner.FullName '*') $Dest -Recurse -Force
    Ok "Unpacked to $Dest"
    Warn "Without git, 'update' re-downloads the whole zip each time."
  } finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Assert-App {
  if (-not (Test-Path (Join-Path $AppDir 'server.js'))) {
    Die "$AppDir does not look like the app (no server.js). Refusing to continue."
  }
}

function Get-InstalledVersion {
  $pkg = Join-Path $AppDir 'package.json'
  if (Test-Path $pkg) { return (Get-Content $pkg -Raw | ConvertFrom-Json).version }
  return $null
}

function Get-Revision {
  if (Test-Path (Join-Path $AppDir '.git')) {
    return (& git -C $AppDir rev-parse --short HEAD 2>$null)
  }
  return 'unknown'
}

# ------------------------------------------------------------------ backups --

# The data directory is not inside the application directory, so an update
# cannot reach it. This is belt and braces: a dated copy before anything moves.
function Backup-Data {
  if (-not (Test-Path $DataDir)) { return }
  if (-not (Get-ChildItem $DataDir -Force | Select-Object -First 1)) { return }
  if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $file  = Join-Path $BackupDir "data-$stamp.zip"
  Compress-Archive -Path (Join-Path $DataDir '*') -DestinationPath $file -Force
  Ok "Data snapshot: $file"
  # Keep the last ten; older ones are noise.
  Get-ChildItem $BackupDir -Filter 'data-*.zip' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 10 |
    Remove-Item -Force -ErrorAction SilentlyContinue
}

# ------------------------------------------------------------------ service --

# node.exe is a console program, so a logon task that runs it directly flashes a
# window and leaves one sitting in the taskbar. Two small files avoid that: a
# .cmd that sets the environment and redirects the log, and a one-line .vbs that
# starts the .cmd with the window hidden. Splitting them keeps the quoting in
# the batch file, where it behaves, instead of nested inside a VBScript string.
function Write-Shim {
  param([string]$NodePath)

  @"
@echo off
rem Generated by install.ps1 - do not edit; run 'install.ps1 service add' instead.
set "BT_PORT=$Port"
set "BT_HOST=$Listen"
set "BT_DATA_DIR=$DataDir"
cd /d "$AppDir"
"$NodePath" "server.js" >> "$LogFile" 2>&1
"@ | Set-Content -Path $CmdShim -Encoding ASCII

  @"
' Generated by install.ps1 - starts the tracker with no console window.
CreateObject("WScript.Shell").Run """$CmdShim""", 0, False
"@ | Set-Content -Path $VbsShim -Encoding ASCII

  Ok "Launcher written to $VbsShim"
}

function Add-Service {
  $node = Get-NodePath
  Assert-App
  Step 'Registering the logon task'
  Write-Shim -NodePath $node

  $action  = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$VbsShim`"" -WorkingDirectory $AppDir
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
      -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  # Interactive, running as you: this is what keeps it out of admin territory.
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
      -Settings $settings -Principal $principal -Description "$AppName ($RepoUrl)" -Force | Out-Null
  Ok "Task '$TaskName' registered for $env:USERNAME"

  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 2
  Show-Where
}

function Remove-Service {
  Step 'Removing the logon task'
  Stop-App
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Ok "Task '$TaskName' removed"
  } else {
    Warn "No task named '$TaskName' was registered"
  }
  Remove-Item $VbsShim, $CmdShim -Force -ErrorAction SilentlyContinue
  Ok 'The app and your data are untouched.'
}

function Get-AppProcess {
  # Only ever match the copy running out of this install directory.
  $target = (Join-Path $AppDir 'server.js')
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($target) }
}

function Stop-App {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  }
  foreach ($p in Get-AppProcess) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Show-Where {
  if (Get-AppProcess) {
    Ok "Running at http://localhost:$Port"
    if ($Listen -eq '0.0.0.0') {
      $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
             Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
             Select-Object -First 1).IPAddress
      if ($ip) { Say "    On your phone: http://${ip}:$Port" }
    }
  } else {
    Warn "Not running. See: .\install.ps1 logs"
  }
}

# ------------------------------------------------------------------ actions --

function Invoke-Install {
  Step "Installing $AppName"
  Get-NodePath | Out-Null
  Get-Source -Dest $AppDir
  Assert-App
  if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir -Force | Out-Null }
  Ok "Data directory: $DataDir"

  if ($NoService) {
    Say ''
    Ok 'Installed. Start it with:'
    Say "    `$env:BT_DATA_DIR='$DataDir'; `$env:BT_PORT=$Port; node '$AppDir\server.js'"
  } else {
    Add-Service
  }
  Say ''
  Say "  app  $AppDir"
  Say "  data $DataDir"
  Say "  update later with: .\install.ps1 update"
}

function Invoke-Update {
  Step "Updating $AppName"
  Get-NodePath | Out-Null
  Assert-App
  $before = Get-Revision
  Backup-Data

  $wasRunning = [bool](Get-AppProcess)
  if ($wasRunning) { Stop-App; Start-Sleep -Seconds 1 }

  Get-Source -Dest $AppDir
  Assert-App
  $after = Get-Revision

  if ($wasRunning) {
    # The shim pins the node path and the data directory, so rewrite it in case
    # either moved between releases.
    Write-Shim -NodePath (Get-Command node).Source
    Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }

  if ($before -eq $after) {
    Ok "Already at the latest revision ($after)"
  } else {
    Ok "Updated $before -> $after"
    if (Test-Path (Join-Path $AppDir '.git')) {
      & git -C $AppDir --no-pager log --oneline "$before..$after" 2>$null | Select-Object -First 10
    }
  }
  if ($wasRunning) { Show-Where }
}

function Invoke-Uninstall {
  Step "Uninstalling $AppName"
  Remove-Service
  if (Test-Path $AppDir) { Remove-Item $AppDir -Recurse -Force; Ok "Removed $AppDir" }
  if ($Purge) {
    Backup-Data
    Remove-Item $DataDir -Recurse -Force -ErrorAction SilentlyContinue
    Warn "Removed $DataDir - the snapshot in $BackupDir is all that is left."
  } else {
    Ok "Kept your entries in $DataDir (pass -Purge to delete them too)"
  }
}

function Invoke-Status {
  Say $AppName
  Say "  app     $AppDir  ($(Get-Revision))"
  Say "  data    $DataDir"
  Say "  version $(if (Get-InstalledVersion) { Get-InstalledVersion } else { 'not installed' })"
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Say "  task    $(if ($task) { "$TaskName ($($task.State))" } else { 'not registered' })"
  Say "  log     $LogFile"
  Show-Where
}

function Show-Usage {
  Say @"
$AppName - installer and service manager (no administrator rights needed)

  .\install.ps1 install              install, then run it in the background
  .\install.ps1 update               fetch the latest revision and restart
  .\install.ps1 service add          create (or recreate) the logon task
  .\install.ps1 service remove       stop and delete the task, keep everything else
  .\install.ps1 uninstall [-Purge]   remove the app; -Purge deletes your entries too
  .\install.ps1 status               where things are and whether it is running
  .\install.ps1 start|stop|restart
  .\install.ps1 logs                 tail the service log

Options
  -Port N            default $Port
  -Listen ADDR       default $Listen  (127.0.0.1 keeps it off the network)
  -Branch NAME       default main
  -Dir PATH          application directory
  -Data PATH         data directory
  -Backups PATH      where update snapshots go (default: beside the data)
  -NoService         install only; do not register the task
  -Purge             with uninstall, also delete the data directory

Windows Services proper need administrator rights, so this registers a per-user
Scheduled Task that starts at logon instead. It runs as you, in the background,
with no console window, and restarts itself if it falls over.

If PowerShell refuses to run this file, it is the execution policy, not a
permission problem. For the current user only:
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
"@
}

switch ($Action) {
  'install'   { Invoke-Install }
  'update'    { Invoke-Update }
  'uninstall' { Invoke-Uninstall }
  'status'    { Invoke-Status }
  'start'     { Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue; Start-Sleep 2; Show-Where }
  'stop'      { Stop-App; Ok 'Stopped' }
  'restart'   { Stop-App; Start-Sleep 1; Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue; Start-Sleep 2; Show-Where }
  'logs'      { if (Test-Path $LogFile) { Get-Content $LogFile -Tail 100 } else { Warn "No log yet at $LogFile" } }
  'service'   {
    switch ($Sub) {
      'add'    { Add-Service }
      'remove' { Remove-Service }
      'status' { Invoke-Status }
      default  { Die "service needs 'add', 'remove' or 'status'" }
    }
  }
  default { Show-Usage }
}
