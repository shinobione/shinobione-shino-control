[CmdletBinding()]
param(
  [int]$Port = 4177,
  [switch]$NoStart,
  [switch]$Hidden
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'This installer is for Windows only.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$nodeCommand = Get-Command node.exe -ErrorAction Stop
$nodePath = $nodeCommand.Source

$runtimeRoot = Join-Path $env:LOCALAPPDATA 'SHINO-Control'
$configPath = Join-Path $runtimeRoot 'startup.json'
$supervisorSource = Join-Path $PSScriptRoot 'control-supervisor.ps1'
$supervisorTarget = Join-Path $runtimeRoot 'control-supervisor.ps1'
$pidFile = Join-Path $runtimeRoot 'supervisor.pid'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runName = 'SHINO_CONTROL_Core'

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
Copy-Item -LiteralPath $supervisorSource -Destination $supervisorTarget -Force

$config = [ordered]@{
  repoRoot = $repoRoot
  nodePath = $nodePath
  port = $Port
  consoleVisible = (-not $Hidden)
  installedAt = (Get-Date).ToString('o')
}
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

$windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (Test-Path -LiteralPath $windowsPowerShell) {
  $powerShellPath = $windowsPowerShell
}
else {
  $powerShellPath = (Get-Process -Id $PID).Path
}

$windowStyle = if ($Hidden) { 'Hidden' } else { 'Normal' }
$arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle $windowStyle -File `"$supervisorTarget`" -ConfigPath `"$configPath`""
$runCommand = "`"$powerShellPath`" $arguments"

New-Item -Path $runKey -Force | Out-Null
Set-ItemProperty -Path $runKey -Name $runName -Value $runCommand -Type String

Write-Host ''
Write-Host 'SHINO // CONTROL Windows autostart installed.' -ForegroundColor Green
Write-Host "Repo       : $repoRoot"
Write-Host "Node       : $nodePath"
Write-Host "Port       : $Port"
Write-Host "Console    : $(if ($Hidden) { 'HIDDEN' } else { 'VISIBLE runtime status' })"
Write-Host "Run entry  : HKCU\\...\\Run\\$runName"
Write-Host "Runtime    : $runtimeRoot"

if (-not $NoStart) {
  # Upgrade/reinstall in place: stop only the existing supervisor, never the Core.
  # The replacement supervisor will immediately adopt an already-healthy Core.
  if (Test-Path -LiteralPath $pidFile) {
    $existingPid = 0
    try { $existingPid = [int](Get-Content -LiteralPath $pidFile -Raw) } catch {}
    if ($existingPid -gt 0) {
      $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$existingPid" -ErrorAction SilentlyContinue
      if ($existing -and [string]$existing.CommandLine -match 'control-supervisor\.ps1') {
        Write-Host "Supervisor : restarting old PID $existingPid" -ForegroundColor Yellow
        Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 800
      }
    }
  }

  Start-Process -FilePath $powerShellPath -ArgumentList $arguments -WindowStyle $windowStyle

  $healthUrl = "http://127.0.0.1:$Port/api/state"
  $healthy = $false
  for ($i = 0; $i -lt 20; $i++) {
    try {
      $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        $healthy = $true
        break
      }
    }
    catch {}
    Start-Sleep -Seconds 1
  }

  if ($healthy) {
    Write-Host 'Core       : HEALTHY now' -ForegroundColor Green
  }
  else {
    Write-Host 'Core       : supervisor installed; Core is still waiting for the repo/drive or Node.' -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host 'From now on CONTROL starts automatically at Windows sign-in.' -ForegroundColor Cyan
if (-not $Hidden) {
  Write-Host 'Runtime    : the SHINO // CONTROL Runtime window stays open and shows live status.'
  Write-Host '             Closing that window stops automatic Core restart until the next sign-in/reinstall.' -ForegroundColor DarkGray
}
Write-Host 'Status     : npm run startup:status'
Write-Host 'Uninstall  : npm run startup:uninstall'
Write-Host 'Hidden mode: npm run startup:install -- --Hidden'
