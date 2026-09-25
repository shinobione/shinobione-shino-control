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
$configuredExtensionId = if ($config.extensionId) { [string]$config.extensionId } else { '' }
$extensionId = if (-not [string]::IsNullOrWhiteSpace($configuredExtensionId)) {
  $configuredExtensionId.Trim().ToLowerInvariant()
}
else {
  ([string]$env:SHINO_CONTROL_EXTENSION_ID).Trim().ToLowerInvariant()
}
if (-not [string]::IsNullOrWhiteSpace($extensionId)) {
  if ($extensionId -notmatch '^[a-p]{32}$') {
    throw "Invalid Collector extension ID in startup configuration: $extensionId"
  }
  $env:SHINO_CONTROL_EXTENSION_ID = $extensionId
}
$healthUrl = "http://127.0.0.1:$port/api/state"

function Test-ControlHealth {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  }
  catch {
    return $false
  }
}

# One supervisor per Windows session. A second launch exits immediately.
$mutexName = 'Local\SHINO_CONTROL_SUPERVISOR'
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
if (-not $mutex.WaitOne(0, $false)) {
  exit 0
}

try {
  Set-Content -LiteralPath $pidFile -Value $PID -Encoding ASCII
  Write-ControlLog "Supervisor started. Repo=$repoRoot Port=$port Collector=$(if ($extensionId) { $extensionId } else { 'NOT_CONFIGURED' })"

  $lastWaitLog = [datetime]::MinValue

  while ($true) {
    if (Test-ControlHealth) {
      Start-Sleep -Seconds 15
      continue
    }

    if (-not (Test-Path -LiteralPath $repoRoot)) {
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
        Write-ControlLog "Configured Node path was missing; using $nodePath"
      }
      else {
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
      if (((Get-Date) - $lastWaitLog).TotalSeconds -ge 60) {
        Write-ControlLog "server-entry.mjs unavailable; waiting for repo sync."
        $lastWaitLog = Get-Date
      }
      Start-Sleep -Seconds 10
      continue
    }

    $buildInfoScript = Join-Path $repoRoot 'scripts\generate-build-info.mjs'
    if (Test-Path -LiteralPath $buildInfoScript) {
      try { & $nodePath $buildInfoScript *> $null }
      catch { Write-ControlLog "Build metadata refresh failed: $($_.Exception.Message)" }
    }

    if (Test-ControlHealth) { continue }

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

    Write-ControlLog "CONTROL Core started. PID=$($process.Id)"
    $process.WaitForExit()
    Write-ControlLog "CONTROL Core exited. PID=$($process.Id) ExitCode=$($process.ExitCode). Restarting in 5s."
    Start-Sleep -Seconds 5
  }
}
catch {
  Write-ControlLog "Supervisor fatal error: $($_.Exception.Message)"
  exit 1
}
finally {
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  try { $mutex.ReleaseMutex() } catch {}
  $mutex.Dispose()
}
