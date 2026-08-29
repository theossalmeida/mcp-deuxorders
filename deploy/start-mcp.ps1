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

$logDir = Join-Path $repoRoot "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir "mcp.log"

function Write-Log([string]$message) {
    "$([DateTime]::UtcNow.ToString('o')) $message" | Add-Content -Path $log -Encoding utf8
}

# Supervisao propria: o MCP trata SIGINT/SIGTERM saindo com 0, e numa sessao S4U
# um evento de controle de console derruba o processo com esse mesmo 0. Para o
# Agendador isso e sucesso, entao o reinicio nativo (RestartCount) nunca dispara.
$backoffSeconds = 2
$maxBackoff = 60

$stdoutLog = Join-Path $logDir "mcp.out.log"
$stderrLog = Join-Path $logDir "mcp.err.log"

while ($true) {
    Write-Log "iniciando $entry"
    $started = [DateTime]::UtcNow

    # Start-Process com redirecionamento em vez de "node ... 2>&1 | ...":
    # no PowerShell 5.1 o 2>&1 num executavel nativo embrulha cada linha de
    # stderr num NativeCommandError e, com ErrorActionPreference Stop, a
    # primeira linha que o MCP escreve ("MCP endpoint: ...") mata o script.
    $proc = Start-Process -FilePath "node" -ArgumentList $entry `
        -NoNewWindow -PassThru -Wait `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog
    $code = $proc.ExitCode

    $uptime = ([DateTime]::UtcNow - $started).TotalSeconds
    Write-Log "processo encerrou com codigo $code apos $([math]::Round($uptime))s"

    # Encerrou de pe: zera o backoff. Morreu na largada: espaca as tentativas
    # para nao girar em falso quando a causa e permanente (porta ocupada, .env
    # invalido).
    if ($uptime -ge 60) { $backoffSeconds = 2 }

    Write-Log "reiniciando em ${backoffSeconds}s"
    Start-Sleep -Seconds $backoffSeconds
    $backoffSeconds = [math]::Min($backoffSeconds * 2, $maxBackoff)
}
