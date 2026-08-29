<#
.SYNOPSIS
    Sobe o MCP DeuxOrders no canal HTTP, para consumo local do Hermes.
.DESCRIPTION
    Compila se dist/ estiver ausente ou desatualizado e entao executa
    dist/mcp-http.js. A configuracao vem inteiramente do .env do repositorio:
    este script nunca define credencial nem token.
#>
[CmdletBinding()]
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Test-Path (Join-Path $repoRoot ".env"))) {
    throw "Faltando .env em $repoRoot. Copie .env.example e preencha antes de subir."
}

if (-not (Test-Path (Join-Path $repoRoot "node_modules"))) {
    Write-Host "node_modules ausente; instalando dependencias..."
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci falhou." }
}

$entry = Join-Path $repoRoot "dist\mcp-http.js"

if (-not $SkipBuild) {
    $newestSource = Get-ChildItem (Join-Path $repoRoot "src") -Recurse -File |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1

    $stale = (-not (Test-Path $entry)) -or
             ($newestSource -and $newestSource.LastWriteTimeUtc -gt (Get-Item $entry).LastWriteTimeUtc)

    if ($stale) {
        Write-Host "Compilando..."
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "Build falhou." }
    }
}

if (-not (Test-Path $entry)) { throw "Nao encontrei $entry apos o build." }

node $entry
