[CmdletBinding()]
param()

$ErrorActionPreference = 'SilentlyContinue'

$runtimeRoot = Join-Path $env:LOCALAPPDATA 'SHINO-Control'
$configPath = Join-Path $runtimeRoot 'startup.json'
$pidFile = Join-Path $runtimeRoot 'supervisor.pid'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runName = 'SHINO_CONTROL_Core'

$runValue = (Get-ItemProperty -Path $runKey -Name $runName).$runName
$installed = -not [string]::IsNullOrWhiteSpace([string]$runValue)

$config = $null
if (Test-Path -LiteralPath $configPath) {
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
}

$supervisorRunning = $false
$supervisorPid = $null
if (Test-Path -LiteralPath $pidFile) {
  $supervisorPid = [int](Get-Content -LiteralPath $pidFile -Raw)
  $proc = Get-Process -Id $supervisorPid -ErrorAction SilentlyContinue
  if ($proc) { $supervisorRunning = $true }
}

$port = if ($config -and $config.port) { [int]$config.port } else { 4177 }
$healthUrl = "http://127.0.0.1:$port/api/state"
$coreHealthy = $false
try {
  $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
  $coreHealthy = $response.StatusCode -eq 200
}
catch {}

$corePid = $null
try {
  $corePid = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
    Select-Object -First 1 -ExpandProperty OwningProcess
}
catch {}

$consoleMode = if ($config -and $null -ne $config.consoleVisible -and [bool]$config.consoleVisible) { 'VISIBLE' } else { 'HIDDEN' }

Write-Host ''
Write-Host 'SHINO // CONTROL startup status' -ForegroundColor Cyan
Write-Host ('Autostart  : ' + $(if ($installed) { 'INSTALLED' } else { 'NOT INSTALLED' })) -ForegroundColor $(if ($installed) { 'Green' } else { 'Yellow' })
Write-Host ('Supervisor : ' + $(if ($supervisorRunning) { "RUNNING (PID $supervisorPid)" } else { 'NOT RUNNING' })) -ForegroundColor $(if ($supervisorRunning) { 'Green' } else { 'Yellow' })
Write-Host ('Core       : ' + $(if ($coreHealthy) { "HEALTHY (PID $corePid)" } else { 'DOWN / WAITING' })) -ForegroundColor $(if ($coreHealthy) { 'Green' } else { 'Yellow' })
Write-Host "URL        : $healthUrl"
Write-Host "Console    : $consoleMode" -ForegroundColor $(if ($consoleMode -eq 'VISIBLE') { 'Green' } else { 'DarkGray' })

if ($config) {
  Write-Host "Repo       : $($config.repoRoot)"
  Write-Host "Node       : $($config.nodePath)"
  Write-Host "Installed  : $($config.installedAt)"
}

if (Test-Path -LiteralPath (Join-Path $runtimeRoot 'startup.log')) {
  Write-Host "Log        : $(Join-Path $runtimeRoot 'startup.log')"
}
Write-Host ''
