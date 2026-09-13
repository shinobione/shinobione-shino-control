[CmdletBinding()]
param(
  [switch]$StopCore
)

$ErrorActionPreference = 'SilentlyContinue'

$runtimeRoot = Join-Path $env:LOCALAPPDATA 'SHINO-Control'
$configPath = Join-Path $runtimeRoot 'startup.json'
$pidFile = Join-Path $runtimeRoot 'supervisor.pid'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runName = 'SHINO_CONTROL_Core'

$config = $null
if (Test-Path -LiteralPath $configPath) {
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
}

Remove-ItemProperty -Path $runKey -Name $runName -ErrorAction SilentlyContinue

if (Test-Path -LiteralPath $pidFile) {
  $supervisorPid = [int](Get-Content -LiteralPath $pidFile -Raw)
  if ($supervisorPid -and $supervisorPid -ne $PID) {
    Stop-Process -Id $supervisorPid -Force -ErrorAction SilentlyContinue
  }
}

if ($StopCore -and $config) {
  $serverEntry = Join-Path ([string]$config.repoRoot) 'server-entry.mjs'
  $escapedEntry = [regex]::Escape($serverEntry)
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match $escapedEntry } |
    ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null }
}

Remove-Item -LiteralPath (Join-Path $runtimeRoot 'control-supervisor.ps1') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host 'SHINO // CONTROL Windows autostart removed.' -ForegroundColor Green
if ($StopCore) {
  Write-Host 'Current CONTROL Core process was also stopped.' -ForegroundColor Yellow
}
else {
  Write-Host 'Any CONTROL Core already running is left untouched until you stop it or sign out.' -ForegroundColor Cyan
}
if (Test-Path -LiteralPath $runtimeRoot) {
  Write-Host "Logs kept in: $runtimeRoot"
}
Write-Host ''
