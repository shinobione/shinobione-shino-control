[CmdletBinding()]
param(
  [int]$Port = 4177,
  [ValidatePattern('^[a-p]{32}

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
$traySource = Join-Path $PSScriptRoot 'ShinoControlTray.cs'
$trayTarget = Join-Path $runtimeRoot 'SHINO-Control-Tray.exe'
$pidFile = Join-Path $runtimeRoot 'supervisor.pid'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$coreRunName = 'SHINO_CONTROL_Core'
$trayRunName = 'SHINO_CONTROL_Tray'

$existingConfig = $null
if (Test-Path -LiteralPath $configPath) {
  try {
    $existingConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  }
  catch {
    throw "Existing startup config is unreadable: $configPath"
  }
}

$previousExtensionId = if ($existingConfig -and $existingConfig.extensionId) {
  [string]$existingConfig.extensionId
}
else {
  ''
}
$inheritedExtensionId = [string]$env:SHINO_CONTROL_EXTENSION_ID
$userExtensionId = [string][Environment]::GetEnvironmentVariable('SHINO_CONTROL_EXTENSION_ID', 'User')
$resolvedExtensionId = ''

foreach ($candidate in @($ExtensionId, $previousExtensionId, $inheritedExtensionId, $userExtensionId)) {
  if ([string]::IsNullOrWhiteSpace([string]$candidate)) { continue }
  $candidateText = ([string]$candidate).Trim().ToLowerInvariant()
  if ($candidateText -notmatch '^[a-p]{32}
Copy-Item -LiteralPath $supervisorSource -Destination $supervisorTarget -Force

$config = [ordered]@{
  repoRoot = $repoRoot
  nodePath = $nodePath
  port = $Port
  extensionId = $resolvedExtensionId
  trayEnabled = (-not $NoTray)
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

$coreArguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$supervisorTarget`" -ConfigPath `"$configPath`""
$coreRunCommand = "`"$powerShellPath`" $coreArguments"

New-Item -Path $runKey -Force | Out-Null
Set-ItemProperty -Path $runKey -Name $coreRunName -Value $coreRunCommand -Type String

# Stop the old tray before replacing the executable.
Get-Process -Name 'SHINO-Control-Tray' -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 250

if (-not $NoTray) {
  if (-not (Test-Path -LiteralPath $traySource)) {
    throw "Tray source not found: $traySource"
  }

  Remove-Item -LiteralPath $trayTarget -Force -ErrorAction SilentlyContinue
  $trayCode = Get-Content -LiteralPath $traySource -Raw
  Add-Type `
    -TypeDefinition $trayCode `
    -Language CSharp `
    -ReferencedAssemblies @('System.Windows.Forms','System.Drawing') `
    -OutputAssembly $trayTarget `
    -OutputType WindowsApplication

  if (-not (Test-Path -LiteralPath $trayTarget)) {
    throw 'Tray executable compilation failed.'
  }

  Set-ItemProperty -Path $runKey -Name $trayRunName -Value "`"$trayTarget`"" -Type String
}
else {
  Remove-ItemProperty -Path $runKey -Name $trayRunName -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $trayTarget -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'SHINO // CONTROL Windows autostart installed.' -ForegroundColor Green
Write-Host "Repo       : $repoRoot"
Write-Host "Node       : $nodePath"
Write-Host "Port       : $Port"
Write-Host "Collector  : $(if ($resolvedExtensionId) { "CONFIGURED ($resolvedExtensionId)" } else { 'NOT CONFIGURED - use -ExtensionId <chrome-extension-id>' })" -ForegroundColor $(if ($resolvedExtensionId) { 'Green' } else { 'Yellow' })
Write-Host "Supervisor : HIDDEN background process"
Write-Host "Tray       : $(if ($NoTray) { 'DISABLED' } else { 'ENABLED - notification area icon' })" -ForegroundColor $(if ($NoTray) { 'Yellow' } else { 'Green' })
Write-Host "Runtime    : $runtimeRoot"

if (-not $NoStart) {
  $healthUrl = "http://127.0.0.1:$Port/api/state"
  $coreWasHealthy = $false
  try {
    $before = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    $coreWasHealthy = $before.StatusCode -eq 200
  }
  catch {}

  # Upgrade/reinstall in place: stop only the existing supervisor, never the Core.
  # The replacement supervisor immediately adopts an already-healthy Core.
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

  Start-Process -FilePath $powerShellPath -ArgumentList $coreArguments -WindowStyle Hidden
  if (-not $NoTray) {
    Start-Process -FilePath $trayTarget
  }

  $coreRestartRequested = $false
  if ($extensionIdChanged -and $coreWasHealthy) {
    try {
      $restart = Invoke-WebRequest `
        -Uri "http://127.0.0.1:$Port/api/control/restart" `
        -Method Post `
        -ContentType 'application/json' `
        -Body '{}' `
        -UseBasicParsing `
        -TimeoutSec 3
      if ($restart.StatusCode -eq 200) {
        $coreRestartRequested = $true
        Write-Host 'Core       : restarting to apply Collector ID' -ForegroundColor Yellow
        Start-Sleep -Milliseconds 750
      }
    }
    catch {
      Write-Host 'Collector  : config saved; automatic Core restart failed. Restart CONTROL Core once to apply it.' -ForegroundColor Yellow
    }
  }

  $healthy = $false
  $healthAttempts = if ($coreRestartRequested) { 35 } else { 20 }
  for ($i = 0; $i -lt $healthAttempts; $i++) {
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
Write-Host 'CONTROL now starts automatically at Windows sign-in.' -ForegroundColor Cyan
if (-not $NoTray) {
  Write-Host 'Tray icon  : double-click opens CONTROL; right-click shows status/actions.' -ForegroundColor Cyan
}
Write-Host 'Status     : npm run startup:status'
Write-Host 'Uninstall  : npm run startup:uninstall'
Write-Host 'No tray    : npm run startup:install -- --NoTray'
Write-Host 'Collector  : npm run startup:install -- -ExtensionId <chrome-extension-id>'
)]
  [string]$ExtensionId = '',
  [switch]$NoStart,
  [switch]$NoTray
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
$traySource = Join-Path $PSScriptRoot 'ShinoControlTray.cs'
$trayTarget = Join-Path $runtimeRoot 'SHINO-Control-Tray.exe'
$pidFile = Join-Path $runtimeRoot 'supervisor.pid'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$coreRunName = 'SHINO_CONTROL_Core'
$trayRunName = 'SHINO_CONTROL_Tray'

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
Copy-Item -LiteralPath $supervisorSource -Destination $supervisorTarget -Force

$config = [ordered]@{
  repoRoot = $repoRoot
  nodePath = $nodePath
  port = $Port
  trayEnabled = (-not $NoTray)
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

$coreArguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$supervisorTarget`" -ConfigPath `"$configPath`""
$coreRunCommand = "`"$powerShellPath`" $coreArguments"

New-Item -Path $runKey -Force | Out-Null
Set-ItemProperty -Path $runKey -Name $coreRunName -Value $coreRunCommand -Type String

# Stop the old tray before replacing the executable.
Get-Process -Name 'SHINO-Control-Tray' -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 250

if (-not $NoTray) {
  if (-not (Test-Path -LiteralPath $traySource)) {
    throw "Tray source not found: $traySource"
  }

  Remove-Item -LiteralPath $trayTarget -Force -ErrorAction SilentlyContinue
  $trayCode = Get-Content -LiteralPath $traySource -Raw
  Add-Type `
    -TypeDefinition $trayCode `
    -Language CSharp `
    -ReferencedAssemblies @('System.Windows.Forms','System.Drawing') `
    -OutputAssembly $trayTarget `
    -OutputType WindowsApplication

  if (-not (Test-Path -LiteralPath $trayTarget)) {
    throw 'Tray executable compilation failed.'
  }

  Set-ItemProperty -Path $runKey -Name $trayRunName -Value "`"$trayTarget`"" -Type String
}
else {
  Remove-ItemProperty -Path $runKey -Name $trayRunName -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $trayTarget -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'SHINO // CONTROL Windows autostart installed.' -ForegroundColor Green
Write-Host "Repo       : $repoRoot"
Write-Host "Node       : $nodePath"
Write-Host "Port       : $Port"
Write-Host "Supervisor : HIDDEN background process"
Write-Host "Tray       : $(if ($NoTray) { 'DISABLED' } else { 'ENABLED - notification area icon' })" -ForegroundColor $(if ($NoTray) { 'Yellow' } else { 'Green' })
Write-Host "Runtime    : $runtimeRoot"

if (-not $NoStart) {
  # Upgrade/reinstall in place: stop only the existing supervisor, never the Core.
  # The replacement supervisor immediately adopts an already-healthy Core.
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

  Start-Process -FilePath $powerShellPath -ArgumentList $coreArguments -WindowStyle Hidden
  if (-not $NoTray) {
    Start-Process -FilePath $trayTarget
  }

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
Write-Host 'CONTROL now starts automatically at Windows sign-in.' -ForegroundColor Cyan
if (-not $NoTray) {
  Write-Host 'Tray icon  : double-click opens CONTROL; right-click shows status/actions.' -ForegroundColor Cyan
}
Write-Host 'Status     : npm run startup:status'
Write-Host 'Uninstall  : npm run startup:uninstall'
Write-Host 'No tray    : npm run startup:install -- --NoTray'
) {
    throw "Invalid Chrome extension ID '$candidateText'. Expected 32 lowercase letters in the a-p range."
  }
  $resolvedExtensionId = $candidateText
  break
}

$extensionIdChanged = $resolvedExtensionId -ne $previousExtensionId

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
Copy-Item -LiteralPath $supervisorSource -Destination $supervisorTarget -Force

$config = [ordered]@{
  repoRoot = $repoRoot
  nodePath = $nodePath
  port = $Port
  trayEnabled = (-not $NoTray)
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

$coreArguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$supervisorTarget`" -ConfigPath `"$configPath`""
$coreRunCommand = "`"$powerShellPath`" $coreArguments"

New-Item -Path $runKey -Force | Out-Null
Set-ItemProperty -Path $runKey -Name $coreRunName -Value $coreRunCommand -Type String

# Stop the old tray before replacing the executable.
Get-Process -Name 'SHINO-Control-Tray' -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 250

if (-not $NoTray) {
  if (-not (Test-Path -LiteralPath $traySource)) {
    throw "Tray source not found: $traySource"
  }

  Remove-Item -LiteralPath $trayTarget -Force -ErrorAction SilentlyContinue
  $trayCode = Get-Content -LiteralPath $traySource -Raw
  Add-Type `
    -TypeDefinition $trayCode `
    -Language CSharp `
    -ReferencedAssemblies @('System.Windows.Forms','System.Drawing') `
    -OutputAssembly $trayTarget `
    -OutputType WindowsApplication

  if (-not (Test-Path -LiteralPath $trayTarget)) {
    throw 'Tray executable compilation failed.'
  }

  Set-ItemProperty -Path $runKey -Name $trayRunName -Value "`"$trayTarget`"" -Type String
}
else {
  Remove-ItemProperty -Path $runKey -Name $trayRunName -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $trayTarget -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'SHINO // CONTROL Windows autostart installed.' -ForegroundColor Green
Write-Host "Repo       : $repoRoot"
Write-Host "Node       : $nodePath"
Write-Host "Port       : $Port"
Write-Host "Supervisor : HIDDEN background process"
Write-Host "Tray       : $(if ($NoTray) { 'DISABLED' } else { 'ENABLED - notification area icon' })" -ForegroundColor $(if ($NoTray) { 'Yellow' } else { 'Green' })
Write-Host "Runtime    : $runtimeRoot"

if (-not $NoStart) {
  # Upgrade/reinstall in place: stop only the existing supervisor, never the Core.
  # The replacement supervisor immediately adopts an already-healthy Core.
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

  Start-Process -FilePath $powerShellPath -ArgumentList $coreArguments -WindowStyle Hidden
  if (-not $NoTray) {
    Start-Process -FilePath $trayTarget
  }

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
Write-Host 'CONTROL now starts automatically at Windows sign-in.' -ForegroundColor Cyan
if (-not $NoTray) {
  Write-Host 'Tray icon  : double-click opens CONTROL; right-click shows status/actions.' -ForegroundColor Cyan
}
Write-Host 'Status     : npm run startup:status'
Write-Host 'Uninstall  : npm run startup:uninstall'
Write-Host 'No tray    : npm run startup:install -- --NoTray'
)]
  [string]$ExtensionId = '',
  [switch]$NoStart,
  [switch]$NoTray
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
$traySource = Join-Path $PSScriptRoot 'ShinoControlTray.cs'
$trayTarget = Join-Path $runtimeRoot 'SHINO-Control-Tray.exe'
$pidFile = Join-Path $runtimeRoot 'supervisor.pid'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$coreRunName = 'SHINO_CONTROL_Core'
$trayRunName = 'SHINO_CONTROL_Tray'

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
Copy-Item -LiteralPath $supervisorSource -Destination $supervisorTarget -Force

$config = [ordered]@{
  repoRoot = $repoRoot
  nodePath = $nodePath
  port = $Port
  trayEnabled = (-not $NoTray)
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

$coreArguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$supervisorTarget`" -ConfigPath `"$configPath`""
$coreRunCommand = "`"$powerShellPath`" $coreArguments"

New-Item -Path $runKey -Force | Out-Null
Set-ItemProperty -Path $runKey -Name $coreRunName -Value $coreRunCommand -Type String

# Stop the old tray before replacing the executable.
Get-Process -Name 'SHINO-Control-Tray' -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 250

if (-not $NoTray) {
  if (-not (Test-Path -LiteralPath $traySource)) {
    throw "Tray source not found: $traySource"
  }

  Remove-Item -LiteralPath $trayTarget -Force -ErrorAction SilentlyContinue
  $trayCode = Get-Content -LiteralPath $traySource -Raw
  Add-Type `
    -TypeDefinition $trayCode `
    -Language CSharp `
    -ReferencedAssemblies @('System.Windows.Forms','System.Drawing') `
    -OutputAssembly $trayTarget `
    -OutputType WindowsApplication

  if (-not (Test-Path -LiteralPath $trayTarget)) {
    throw 'Tray executable compilation failed.'
  }

  Set-ItemProperty -Path $runKey -Name $trayRunName -Value "`"$trayTarget`"" -Type String
}
else {
  Remove-ItemProperty -Path $runKey -Name $trayRunName -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $trayTarget -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'SHINO // CONTROL Windows autostart installed.' -ForegroundColor Green
Write-Host "Repo       : $repoRoot"
Write-Host "Node       : $nodePath"
Write-Host "Port       : $Port"
Write-Host "Supervisor : HIDDEN background process"
Write-Host "Tray       : $(if ($NoTray) { 'DISABLED' } else { 'ENABLED - notification area icon' })" -ForegroundColor $(if ($NoTray) { 'Yellow' } else { 'Green' })
Write-Host "Runtime    : $runtimeRoot"

if (-not $NoStart) {
  # Upgrade/reinstall in place: stop only the existing supervisor, never the Core.
  # The replacement supervisor immediately adopts an already-healthy Core.
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

  Start-Process -FilePath $powerShellPath -ArgumentList $coreArguments -WindowStyle Hidden
  if (-not $NoTray) {
    Start-Process -FilePath $trayTarget
  }

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
Write-Host 'CONTROL now starts automatically at Windows sign-in.' -ForegroundColor Cyan
if (-not $NoTray) {
  Write-Host 'Tray icon  : double-click opens CONTROL; right-click shows status/actions.' -ForegroundColor Cyan
}
Write-Host 'Status     : npm run startup:status'
Write-Host 'Uninstall  : npm run startup:uninstall'
Write-Host 'No tray    : npm run startup:install -- --NoTray'
