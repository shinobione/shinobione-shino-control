[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'

$runtimeRoot = Split-Path -Parent $ConfigPath
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$startupLog = Join-Path $runtimeRoot 'startup.log'
$pidFile = Join-Path $runtimeRoot 'supervisor.pid'

function Write-ControlLog {
  param([string]$Message)
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -Path $startupLog -Value $line -Encoding UTF8
}

function Read-ControlConfig {
  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Startup config not found: $ConfigPath"
  }
  return Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
}

$config = Read-ControlConfig
$repoRoot = [string]$config.repoRoot
$nodePath = [string]$config.nodePath
$port = if ($config.port) { [int]$config.port } else { 4177 }
$consoleVisible = if ($null -ne $config.consoleVisible) { [bool]$config.consoleVisible } else { $false }
$healthUrl = "http://127.0.0.1:$port/api/state"
$supervisorStartedAt = Get-Date
$lastDisplaySignature = ''
$lastEvent = 'Supervisor started.'
$lastCoreStartedAt = $null

function Test-ControlHealth {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  }
  catch {
    return $false
  }
}

function Get-ControlListenerPid {
  try {
    return Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
      Select-Object -First 1 -ExpandProperty OwningProcess
  }
  catch {
    return $null
  }
}

function Show-ControlRuntime {
  param(
    [string]$CoreState,
    [Nullable[int]]$CorePid,
    [string]$Detail
  )

  if (-not $consoleVisible) { return }

  $signature = "$CoreState|$CorePid|$Detail|$lastEvent"
  if ($signature -eq $script:lastDisplaySignature) { return }
  $script:lastDisplaySignature = $signature

  try { $Host.UI.RawUI.WindowTitle = 'SHINO // CONTROL Runtime' } catch {}
  try { Clear-Host } catch {}

  $coreColor = switch ($CoreState) {
    'HEALTHY' { 'Green' }
    'STARTING' { 'Yellow' }
    'WAITING' { 'Yellow' }
    'RESTARTING' { 'Yellow' }
    'UNHEALTHY' { 'Red' }
    default { 'White' }
  }

  $uptime = [math]::Floor(((Get-Date) - $supervisorStartedAt).TotalMinutes)
  $coreText = if ($CorePid) { "$CoreState (PID $CorePid)" } else { $CoreState }

  Write-Host ''
  Write-Host 'SHINO // CONTROL Runtime' -ForegroundColor Cyan
  Write-Host '------------------------' -ForegroundColor DarkGray
  Write-Host "Autostart  : INSTALLED" -ForegroundColor Green
  Write-Host "Supervisor : RUNNING (PID $PID)" -ForegroundColor Green
  Write-Host "Core       : $coreText" -ForegroundColor $coreColor
  Write-Host "URL        : $healthUrl"
  Write-Host "Repo       : $repoRoot"
  Write-Host "Node       : $nodePath"
  Write-Host "Console    : VISIBLE"
  Write-Host "Uptime     : $uptime min"
  if ($lastCoreStartedAt) {
    Write-Host "Core start : $($lastCoreStartedAt.ToString('yyyy-MM-dd HH:mm:ss'))"
  }
  Write-Host "Last event : $lastEvent" -ForegroundColor DarkGray
  if ($Detail) {
    Write-Host "Status     : $Detail" -ForegroundColor $coreColor
  }
  Write-Host "Log        : $startupLog" -ForegroundColor DarkGray
  Write-Host ''
  Write-Host 'This window is the CONTROL supervisor. Keep it open for automatic restart.' -ForegroundColor DarkGray
}

# One supervisor per Windows session. A second launch exits immediately.
$mutexName = 'Local\SHINO_CONTROL_SUPERVISOR'
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
if (-not $mutex.WaitOne(0, $false)) {
  exit 0
}

try {
  Set-Content -LiteralPath $pidFile -Value $PID -Encoding ASCII
  Write-ControlLog "Supervisor started. Repo=$repoRoot Port=$port ConsoleVisible=$consoleVisible"
  Show-ControlRuntime -CoreState 'STARTING' -CorePid $null -Detail 'Checking CONTROL Core...'

  $lastWaitLog = [datetime]::MinValue

  while ($true) {
    if (Test-ControlHealth) {
      $listenerPid = Get-ControlListenerPid
      $lastEvent = 'Core health check passed.'
      Show-ControlRuntime -CoreState 'HEALTHY' -CorePid $listenerPid -Detail 'CONTROL Core is responding normally.'
      Start-Sleep -Seconds 15
      continue
    }

    if (-not (Test-Path -LiteralPath $repoRoot)) {
      $lastEvent = 'Waiting for repository path.'
      Show-ControlRuntime -CoreState 'WAITING' -CorePid $null -Detail "Drive/repo unavailable: $repoRoot"
      if (((Get-Date) - $lastWaitLog).TotalSeconds -ge 60) {
        Write-ControlLog "Repo unavailable; waiting for drive/path: $repoRoot"
        $lastWaitLog = Get-Date
      }
      Start-Sleep -Seconds 5
      continue
    }

    if (-not (Test-Path -LiteralPath $nodePath)) {
      $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
      if ($nodeCommand) {
        $nodePath = $nodeCommand.Source
        $lastEvent = "Node fallback selected: $nodePath"
        Write-ControlLog "Configured Node path was missing; using $nodePath"
      }
      else {
        $lastEvent = 'Waiting for Node.js.'
        Show-ControlRuntime -CoreState 'WAITING' -CorePid $null -Detail 'Node.js is unavailable.'
        if (((Get-Date) - $lastWaitLog).TotalSeconds -ge 60) {
          Write-ControlLog 'Node.js is unavailable; waiting.'
          $lastWaitLog = Get-Date
        }
        Start-Sleep -Seconds 15
        continue
      }
    }

    $serverEntry = Join-Path $repoRoot 'server-entry.mjs'
    if (-not (Test-Path -LiteralPath $serverEntry)) {
      $lastEvent = 'Waiting for server-entry.mjs.'
      Show-ControlRuntime -CoreState 'WAITING' -CorePid $null -Detail 'Repository is present, but server-entry.mjs is unavailable.'
      if (((Get-Date) - $lastWaitLog).TotalSeconds -ge 60) {
        Write-ControlLog 'server-entry.mjs unavailable; waiting for repo sync.'
        $lastWaitLog = Get-Date
      }
      Start-Sleep -Seconds 10
      continue
    }

    # Refresh the build label before each actual Core start. Failure here must not prevent startup.
    $buildInfoScript = Join-Path $repoRoot 'scripts\generate-build-info.mjs'
    if (Test-Path -LiteralPath $buildInfoScript) {
      try {
        & $nodePath $buildInfoScript *> $null
      }
      catch {
        Write-ControlLog "Build metadata refresh failed: $($_.Exception.Message)"
      }
    }

    if (Test-ControlHealth) {
      continue
    }

    Get-ChildItem -LiteralPath $runtimeRoot -Filter 'core-*.log' -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -Skip 12 |
      Remove-Item -Force -ErrorAction SilentlyContinue

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdoutLog = Join-Path $runtimeRoot "core-$stamp.out.log"
    $stderrLog = Join-Path $runtimeRoot "core-$stamp.err.log"

    Write-ControlLog 'CONTROL Core is down; starting Node.'
    $process = Start-Process `
      -FilePath $nodePath `
      -ArgumentList @("`"$serverEntry`"") `
      -WorkingDirectory $repoRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutLog `
      -RedirectStandardError $stderrLog `
      -PassThru

    $lastCoreStartedAt = Get-Date
    $lastEvent = "CONTROL Core started by supervisor. PID=$($process.Id)"
    Write-ControlLog "CONTROL Core started. PID=$($process.Id)"
    Show-ControlRuntime -CoreState 'STARTING' -CorePid $process.Id -Detail 'Node started; waiting for the health endpoint.'

    $healthyLogged = $false
    while ($true) {
      $process.Refresh()
      if ($process.HasExited) { break }

      if (Test-ControlHealth) {
        if (-not $healthyLogged) {
          Write-ControlLog "CONTROL Core healthy. PID=$($process.Id)"
          $healthyLogged = $true
        }
        $lastEvent = 'Core health check passed.'
        Show-ControlRuntime -CoreState 'HEALTHY' -CorePid $process.Id -Detail 'CONTROL Core is responding normally.'
      }
      else {
        $age = ((Get-Date) - $lastCoreStartedAt).TotalSeconds
        if ($age -lt 15) {
          Show-ControlRuntime -CoreState 'STARTING' -CorePid $process.Id -Detail 'Waiting for CONTROL Core to become healthy.'
        }
        else {
          $lastEvent = 'Core process is running but health check is failing.'
          Show-ControlRuntime -CoreState 'UNHEALTHY' -CorePid $process.Id -Detail 'Node is alive, but /api/state is not responding.'
        }
      }
      Start-Sleep -Seconds 5
    }

    $lastEvent = "Core exited with code $($process.ExitCode); restart scheduled."
    Write-ControlLog "CONTROL Core exited. PID=$($process.Id) ExitCode=$($process.ExitCode). Restarting in 5s."
    Show-ControlRuntime -CoreState 'RESTARTING' -CorePid $null -Detail "Core exited (code $($process.ExitCode)). Restarting in 5 seconds."
    Start-Sleep -Seconds 5
  }
}
catch {
  Write-ControlLog "Supervisor fatal error: $($_.Exception.Message)"
  $lastEvent = "Supervisor fatal error: $($_.Exception.Message)"
  Show-ControlRuntime -CoreState 'UNHEALTHY' -CorePid $null -Detail $lastEvent
  exit 1
}
finally {
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  try { $mutex.ReleaseMutex() } catch {}
  $mutex.Dispose()
}
