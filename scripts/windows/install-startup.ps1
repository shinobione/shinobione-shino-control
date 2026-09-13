[CmdletBinding()]
param(
  [int]$Port = 4177,
  [switch]$NoStart
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
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runName = 'SHINO_CONTROL_Core'

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
Copy-Item -LiteralPath $supervisorSource -Destination $supervisorTarget -Force

$config = [ordered]@{
  repoRoot = $repoRoot
  nodePath = $nodePath
  port = $Port
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

$arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$supervisorTarget`" -ConfigPath `"$configPath`""
$runCommand = "`"$powerShellPath`" $arguments"

New-Item -Path $runKey -Force | Out-Null
Set-ItemProperty -Path $runKey -Name $runName -Value $runCommand -Type String

Write-Host ''
Write-Host 'SHINO // CONTROL Windows autostart installed.' -ForegroundColor Green
Write-Host "Repo       : $repoRoot"
Write-Host "Node       : $nodePath"
Write-Host "Port       : $Port"
Write-Host "Run entry  : HKCU\\...\\Run\\$runName"
Write-Host "Runtime    : $runtimeRoot"

if (-not $NoStart) {
  Start-Process -FilePath $powerShellPath -ArgumentList $arguments -WindowStyle Hidden

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
Write-Host 'Status     : npm run startup:status'
Write-Host 'Uninstall  : npm run startup:uninstall'
