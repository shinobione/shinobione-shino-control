[CmdletBinding()]
param()

$ErrorActionPreference = 'SilentlyContinue'

$runtimeRoot = Join-Path $env:LOCALAPPDATA 'SHINO-Control'
$configPath = Join-Path $runtimeRoot 'startup.json'
$pidFile = Join-Path $runtimeRoot 'supervisor.pid'
$trayPath = Join-Path $runtimeRoot 'SHINO-Control-Tray.exe'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$coreRunName = 'SHINO_CONTROL_Core'
$trayRunName = 'SHINO_CONTROL_Tray'

$coreRunValue = (Get-ItemProperty -Path $runKey -Name $coreRunName).$coreRunName
$coreInstalled = -not [string]::IsNullOrWhiteSpace([string]$coreRunValue)
$trayRunValue = (Get-ItemProperty -Path $runKey -Name $trayRunName).$trayRunName
$trayInstalled = -not [string]::IsNullOrWhiteSpace([string]$trayRunValue)

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

$trayProcess = Get-Process -Name 'SHINO-Control-Tray' -ErrorAction SilentlyContinue | Select-Object -First 1
$trayRunning = $null -ne $trayProcess
$trayPid = if ($trayRunning) { $trayProcess.Id } else { $null }

$port = if ($config -and $config.port) { [int]$config.port } else { 4177 }
$configuredExtensionId = if ($config -and $config.extensionId) { [string]$config.extensionId } else { '' }
$userExtensionId = [string][Environment]::GetEnvironmentVariable('SHINO_CONTROL_EXTENSION_ID', 'User')
if ($configuredExtensionId -match '^[a-p]{32}$') {
  $collectorStatus = "CONFIGURED ($configuredExtensionId)"
  $collectorColor = 'Green'
}
elseif ($userExtensionId -match '^[a-p]{32}$') {
  $collectorStatus = "LEGACY ENV ONLY ($userExtensionId) - rerun startup:install to persist"
  $collectorColor = 'Yellow'
}
else {
  $collectorStatus = 'NOT CONFIGURED'
  $collectorColor = 'Yellow'
}
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

Write-Host ''
Write-Host 'SHINO // CONTROL startup status' -ForegroundColor Cyan
Write-Host ('Autostart  : ' + $(if ($coreInstalled) { 'INSTALLED' } else { 'NOT INSTALLED' })) -ForegroundColor $(if ($coreInstalled) { 'Green' } else { 'Yellow' })
Write-Host ('Supervisor : ' + $(if ($supervisorRunning) { "RUNNING (PID $supervisorPid)" } else { 'NOT RUNNING' })) -ForegroundColor $(if ($supervisorRunning) { 'Green' } else { 'Yellow' })
Write-Host ('Core       : ' + $(if ($coreHealthy) { "HEALTHY (PID $corePid)" } else { 'DOWN / WAITING' })) -ForegroundColor $(if ($coreHealthy) { 'Green' } else { 'Yellow' })
Write-Host ('Tray       : ' + $(if ($trayRunning) { "RUNNING (PID $trayPid)" } elseif ($trayInstalled) { 'INSTALLED / NOT RUNNING' } else { 'DISABLED' })) -ForegroundColor $(if ($trayRunning) { 'Green' } elseif ($trayInstalled) { 'Yellow' } else { 'DarkGray' })
Write-Host "Collector  : $collectorStatus" -ForegroundColor $collectorColor
Write-Host "URL        : $healthUrl"

if ($config) {
  Write-Host "Repo       : $($config.repoRoot)"
  Write-Host "Node       : $($config.nodePath)"
  Write-Host "Installed  : $($config.installedAt)"
}

if (Test-Path -LiteralPath $trayPath) {
  Write-Host "Tray EXE   : $trayPath"
}
if (Test-Path -LiteralPath (Join-Path $runtimeRoot 'startup.log')) {
  Write-Host "Log        : $(Join-Path $runtimeRoot 'startup.log')"
}
Write-Host ''
