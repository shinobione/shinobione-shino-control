$ErrorActionPreference = 'Stop'

$repair = Join-Path $PSScriptRoot 'repair-state.mjs'
if (-not (Test-Path $repair)) { throw "repair-state.mjs introuvable: $repair" }

Write-Host "SHINO // CONTROL - repair Unicode, duplicate projects and ChatGPT routing" -ForegroundColor Cyan
& node $repair
if ($LASTEXITCODE -ne 0) { throw "State repair failed with exit code $LASTEXITCODE" }
