$ErrorActionPreference = 'Stop'

$statePath = Join-Path (Split-Path $PSScriptRoot -Parent) 'data\state.json'
if (-not (Test-Path $statePath)) { throw "state.json introuvable: $statePath" }

$state = Get-Content $statePath -Raw | ConvertFrom-Json

$catalog = @(
    [pscustomobject]@{ id='naughty-share'; name='Naughty Share'; universe='PRODUCT / PRIVATE'; kind='CHATGPT_PROJECT'; repo=$null; description='Naughty Share project workspace and delivery stack.' },
    [pscustomobject]@{ id='tran-closet-pwa'; name='Trân Closet PWA'; universe='PRODUCT / PWA'; kind='CHATGPT_PROJECT'; repo=$null; description='Trân Closet PWA project workspace.' },
    [pscustomobject]@{ id='matos-informatique'; name='Matos informatique'; universe='HARDWARE / IT'; kind='CHATGPT_PROJECT'; repo=$null; description='Hardware, PC and IT workstream.' },
    [pscustomobject]@{ id='analyse-ia-musique'; name='Analyse IA de musique'; universe='MUSIC / AI'; kind='CHATGPT_PROJECT'; repo=$null; description='AI music analysis and model benchmarking workstream.' },
    [pscustomobject]@{ id='track-to-market-engine'; name='Track-to-Market ENGINE'; universe='MUSIC / DEV'; kind='CHATGPT_PROJECT'; repo=$null; description='Track-to-market automation and release workflow.' },
    [pscustomobject]@{ id='lrc-maker'; name='LRC Maker'; universe='MUSIC / DEV'; kind='CHATGPT_PROJECT'; repo=$null; description='Lyrics timing, LRC generation and Musixmatch injection tooling.' },
    [pscustomobject]@{ id='web-app'; name='web app'; universe='DEV / WEB'; kind='CHATGPT_PROJECT'; repo=$null; description='Web application development workspace discovered from ChatGPT Projects.' },
    [pscustomobject]@{ id='canva-spotify-gem'; name='canva spotify Gem'; universe='MUSIC / VISUAL'; kind='CHATGPT_PROJECT'; repo=$null; description='Spotify Canva/Gem visual workflow workspace discovered from ChatGPT Projects.' }
)

$added = @()
foreach ($p in $catalog) {
    $exists = $state.projects | Where-Object { $_.id -eq $p.id -or $_.name -eq $p.name }
    if (-not $exists) {
        $state.projects += $p
        $added += $p.name
    }
}

$json = $state | ConvertTo-Json -Depth 30
[System.IO.File]::WriteAllText($statePath, $json, [System.Text.UTF8Encoding]::new($false))

if ($added.Count) {
    Write-Host ('Registered: ' + ($added -join ', ')) -ForegroundColor Green
} else {
    Write-Host 'All known ChatGPT projects were already registered.' -ForegroundColor Green
}
