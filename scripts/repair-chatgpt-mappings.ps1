$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$statePath = Join-Path $root 'data\state.json'
if (-not (Test-Path $statePath)) { throw "state.json introuvable: $statePath" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $root "data\state.pre-routing-repair-$stamp.json"
Copy-Item $statePath $backup -Force
Write-Host "Backup: $backup" -ForegroundColor DarkGray

$state = Get-Content $statePath -Raw | ConvertFrom-Json
if (-not $state.settings) { $state | Add-Member -NotePropertyName settings -NotePropertyValue ([pscustomobject]@{}) }
if (-not $state.settings.chatgptProjectMappings) { $state.settings | Add-Member -NotePropertyName chatgptProjectMappings -NotePropertyValue ([pscustomobject]@{}) }
if (-not $state.settings.manualMappings) { $state.settings | Add-Member -NotePropertyName manualMappings -NotePropertyValue ([pscustomobject]@{}) }
if (-not $state.projects) { $state | Add-Member -NotePropertyName projects -NotePropertyValue @() }
if (-not $state.sources) { $state | Add-Member -NotePropertyName sources -NotePropertyValue @() }
if (-not $state.evidence) { $state | Add-Member -NotePropertyName evidence -NotePropertyValue @() }
if (-not $state.discovered) { $state | Add-Member -NotePropertyName discovered -NotePropertyValue @() }

function Norm([string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) { return '' }
    $s = $value.ToLowerInvariant().Normalize([Text.NormalizationForm]::FormD)
    $s = [regex]::Replace($s, '\p{Mn}', '')
    $s = $s -replace '[’`'']', ' '
    $s = $s -replace '[_/\\-]+', ' '
    $s = $s -replace '[^a-z0-9+ ]+', ' '
    return (($s -replace '\s+', ' ').Trim())
}

function Slug([string]$value) {
    $s = Norm $value
    $s = $s -replace '[^a-z0-9]+', '-'
    $s = $s.Trim('-')
    if (-not $s) { $s = 'chatgpt-project' }
    return $s
}

function Set-MapProperty($obj, [string]$key, [string]$value) {
    if ([string]::IsNullOrWhiteSpace($key)) { return }
    $p = $obj.PSObject.Properties[$key]
    if ($p) { $p.Value = $value }
    else { $obj | Add-Member -NotePropertyName $key -NotePropertyValue $value }
}

function Remove-MapProperty($obj, [string]$key) {
    if ([string]::IsNullOrWhiteSpace($key)) { return }
    if ($obj.PSObject.Properties[$key]) { $obj.PSObject.Properties.Remove($key) }
}

function Ensure-Project([string]$id, [string]$name, [string]$universe, [string]$description) {
    $existing = $state.projects | Where-Object { $_.id -eq $id } | Select-Object -First 1
    if ($existing) { return $existing }
    $p = [pscustomobject]@{
        id = $id
        name = $name
        universe = $universe
        kind = 'CHATGPT_PROJECT'
        repo = $null
        description = $description
    }
    $state.projects += $p
    $script:addedProjects++
    Write-Host "Registered project: $name ($id)" -ForegroundColor Cyan
    return $p
}

$known = @(
    @{ id='naughty-share'; name='Naughty Share'; universe='PRODUCT / PRIVATE' },
    @{ id='tran-closet-pwa'; name='Trân Closet PWA'; universe='PRODUCT / PWA' },
    @{ id='matos-informatique'; name='Matos informatique'; universe='HARDWARE / IT' },
    @{ id='analyse-ia-musique'; name='Analyse IA de musique'; universe='MUSIC / AI' },
    @{ id='track-to-market-engine'; name='Track-to-Market ENGINE'; universe='MUSIC / DEV' },
    @{ id='lrc-maker'; name='LRC Maker'; universe='MUSIC / DEV' },
    @{ id='web-app'; name='web app'; universe='DEV / WEB' },
    @{ id='canva-spotify-gem'; name='canva spotify Gem'; universe='MUSIC / VISUAL' }
)

$script:addedProjects = 0
foreach ($item in $known) {
    [void](Ensure-Project $item.id $item.name $item.universe "ChatGPT project workspace: $($item.name).")
}

$route = @{}
function Route([string]$title, [string]$id) { $script:route[(Norm $title)] = $id }

Route 'Naughty Share' 'naughty-share'
Route 'Trân Closet PWA' 'tran-closet-pwa'
Route 'Tran Closet PWA' 'tran-closet-pwa'
Route 'Matos informatique' 'matos-informatique'
Route 'Analyse IA de musique' 'analyse-ia-musique'
Route 'Track-to-Market ENGINE' 'track-to-market-engine'
Route 'LRC Maker' 'lrc-maker'
Route 'web app' 'web-app'
Route 'canva spotify Gem' 'canva-spotify-gem'
Route "Trân's French Teacher" 'french-tranquille'
Route "Tran's French Teacher" 'french-tranquille'
Route 'Music' 'music'
Route 'Shino-OS' 'shino-os'
Route 'LaunchPAD PWA' 'launchpad'
Route 'Riso' 'risotools'
Route 'ShinoBiWan STUDIO' 'studio'
Route 'TouchPlus' 'touch-plus'
Route 'Aide avec mon ex conjointe' 'astrid-admin'

function Target-For([string]$title, [string]$projectKey) {
    $n = Norm $title
    if (-not $n) { return $null }
    if ($n -eq (Norm 'Shino Codes')) { return $null }
    if ($route.ContainsKey($n)) { return $route[$n] }

    $exact = $state.projects | Where-Object { (Norm $_.name) -eq $n -and $_.id -ne 'shino-codes' } | Select-Object -First 1
    if ($exact) { return $exact.id }

    # Only auto-create when this is definitely a real ChatGPT project route.
    if ($projectKey -match '^g-p-') {
        $id = Slug $title
        $base = $id
        $i = 2
        while (($state.projects | Where-Object { $_.id -eq $id -and (Norm $_.name) -ne $n })) {
            $id = "$base-$i"
            $i++
        }
        [void](Ensure-Project $id $title 'CHATGPT / PROJECT' "Automatically registered from ChatGPT Projects inventory.")
        $route[$n] = $id
        return $id
    }
    return $null
}

$movedSources = 0
$movedEvidence = 0
$repairedMappings = 0
$clearedUmbrellaMappings = 0
$promotedDiscovered = 0

# Shino Codes is an umbrella/container. Never force every thread in it to one CONTROL project.
$umbrellaKeys = @()
foreach ($s in @($state.sources)) {
    if ((Norm $s.chatgptProjectTitle) -eq (Norm 'Shino Codes') -and $s.chatgptProjectKey) { $umbrellaKeys += [string]$s.chatgptProjectKey }
}
foreach ($d in @($state.discovered)) {
    if ((Norm $d.chatgptProjectTitle) -eq (Norm 'Shino Codes') -and $d.chatgptProjectKey) { $umbrellaKeys += [string]$d.chatgptProjectKey }
}
foreach ($p in @($state.settings.chatgptProjectMappings.PSObject.Properties)) {
    if ($p.Value -eq 'shino-codes') { $umbrellaKeys += [string]$p.Name }
}
foreach ($key in ($umbrellaKeys | Sort-Object -Unique)) {
    if ($state.settings.chatgptProjectMappings.PSObject.Properties[$key]) {
        Remove-MapProperty $state.settings.chatgptProjectMappings $key
        $clearedUmbrellaMappings++
    }
}

# Existing synced sources are repaired from the authoritative ChatGPT project title.
foreach ($s in @($state.sources)) {
    if ($s.type -ne 'chatgpt_thread') { continue }
    $pt = [string]$s.chatgptProjectTitle
    $pk = [string]$s.chatgptProjectKey
    if (-not $pt) { continue }
    if ((Norm $pt) -eq (Norm 'Shino Codes')) { continue }

    $target = Target-For $pt $pk
    if (-not $target) { continue }

    if ($s.projectId -ne $target) {
        $old = $s.projectId
        $s.projectId = $target
        $movedSources++
        foreach ($e in @($state.evidence | Where-Object { $_.sourceId -eq $s.id })) {
            if ($e.projectId -ne $target) {
                $e.projectId = $target
                $movedEvidence++
            }
        }
        Write-Host "Moved: $($s.title) :: $old -> $target" -ForegroundColor Yellow
    }

    if ($pk) {
        $before = $state.settings.chatgptProjectMappings.PSObject.Properties[$pk]
        if (-not $before -or $before.Value -ne $target) { $repairedMappings++ }
        Set-MapProperty $state.settings.chatgptProjectMappings $pk $target
    }
}

# Promote discovered threads when their ChatGPT project identity is known.
$removeDiscovered = New-Object System.Collections.Generic.HashSet[string]
foreach ($d in @($state.discovered)) {
    if ($d.type -ne 'chatgpt_thread') { continue }
    $pt = [string]$d.chatgptProjectTitle
    $pk = [string]$d.chatgptProjectKey
    if (-not $pt -or (Norm $pt) -eq (Norm 'Shino Codes')) { continue }

    $target = Target-For $pt $pk
    if (-not $target) { continue }

    if ($pk) {
        $before = $state.settings.chatgptProjectMappings.PSObject.Properties[$pk]
        if (-not $before -or $before.Value -ne $target) { $repairedMappings++ }
        Set-MapProperty $state.settings.chatgptProjectMappings $pk $target
    }

    $source = $state.sources | Where-Object { $_.externalId -eq $d.externalId -or ($d.url -and $_.url -eq $d.url) } | Select-Object -First 1
    if (-not $source) {
        $sourceId = "src-repair-$([guid]::NewGuid().ToString('N').Substring(0,12))"
        $source = [pscustomobject]@{
            id = $sourceId
            projectId = $target
            type = 'chatgpt_thread'
            externalId = $d.externalId
            title = $d.title
            url = $d.url
            lastObservedAt = $d.lastObservedAt
            state = 'MAPPED-REPAIR'
            chatgptProjectKey = $pk
            chatgptProjectTitle = $pt
            chatgptProjectUrl = $null
        }
        $state.sources += $source
    } else {
        $source.projectId = $target
        $source.state = 'MAPPED-REPAIR'
    }

    $hasEvidence = $state.evidence | Where-Object { $_.sourceId -eq $source.id } | Select-Object -First 1
    if (-not $hasEvidence) {
        $summary = [string]$d.preview
        if ($summary.Length -gt 1800) { $summary = $summary.Substring(0,1800) }
        if (-not $summary) { $summary = 'Recovered from a previously discovered ChatGPT thread.' }
        $short = if ($summary.Length -gt 650) { $summary.Substring(0,650) } else { $summary }
        $state.evidence += [pscustomobject]@{
            id = "chat-repair-$([guid]::NewGuid().ToString('N').Substring(0,12))"
            projectId = $target
            sourceId = $source.id
            sourceType = 'chatgpt_thread'
            type = 'chat_sync'
            timestamp = if ($d.lastObservedAt) { $d.lastObservedAt } else { (Get-Date).ToUniversalTime().ToString('o') }
            title = $d.title
            summary = $summary
            url = $d.url
            confidence = 0.78
            currentStateSummary = $short
            resumeAction = 'Continue in the recovered ChatGPT thread.'
            chatgptProjectKey = $pk
            chatgptProjectTitle = $pt
        }
    }

    [void]$removeDiscovered.Add([string]$d.id)
    $promotedDiscovered++
}

if ($removeDiscovered.Count) {
    $state.discovered = @($state.discovered | Where-Object { -not $removeDiscovered.Contains([string]$_.id) })
}

$json = $state | ConvertTo-Json -Depth 50
[System.IO.File]::WriteAllText($statePath, $json, [System.Text.UTF8Encoding]::new($false))

Write-Host "`n=== CHATGPT ROUTING REPAIR COMPLETE ===" -ForegroundColor Green
Write-Host "Projects added          : $addedProjects"
Write-Host "Sources moved           : $movedSources"
Write-Host "Evidence moved          : $movedEvidence"
Write-Host "Project mappings fixed  : $repairedMappings"
Write-Host "Umbrella mappings clear : $clearedUmbrellaMappings"
Write-Host "Discovered promoted     : $promotedDiscovered"
Write-Host "Remaining discovered    : $(@($state.discovered).Count)"
Write-Host "`nRestart CONTROL, then run one final Backfill ALL ChatGPT projects." -ForegroundColor Cyan
