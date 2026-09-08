$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$repair = Join-Path $PSScriptRoot 'repair-state.mjs'

if (-not (Test-Path $repair)) { throw "repair-state.mjs introuvable: $repair" }

Write-Host "SHINO // CONTROL - UTF-8 safe project registration + repair" -ForegroundColor Cyan
& node $repair
if ($LASTEXITCODE -ne 0) { throw "State repair failed with exit code $LASTEXITCODE" }
