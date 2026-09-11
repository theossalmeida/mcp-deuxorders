<#
.SYNOPSIS
    Sobe o gateway do Hermes e o derruba apenas em falha terminal.
.DESCRIPTION
    O retry padrao fica intacto para erro transitorio: a bridge Baileys reconecta
    sozinha em 3s (1s no codigo 515, que o WhatsApp pede logo apos o pareamento) e
    o gateway tem backoff proprio de 30s..300s. Nada disso e tocado aqui -- queda de
    rede e blip do WhatsApp se curam sem intervencao.

    O unico caso tratado e DisconnectReason.loggedOut. Nele a bridge chama
    process.exit(1), o gateway respawna em ate 5 min, a bridge nova morre de
    imediato, e o ciclo se repete para sempre. Esse loop nunca converge e e o que
    aciona a politica de spam do WhatsApp -- a sessao precisa ser refeita a mao.
    Quando isso aparece, o gateway e encerrado e NAO reiniciado.
#>
[CmdletBinding()]
param(
    [int]$PollSeconds = 10
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$hermesHome = Join-Path $env:LOCALAPPDATA "hermes"
$env:HERMES_HOME = $hermesHome
$hermesExe = Join-Path $hermesHome "bin\hermes.exe"
$bridgeLog = Join-Path $hermesHome "whatsapp\bridge.log"
$watchLog = Join-Path $hermesHome "logs\gateway-watchdog.log"

if (-not (Test-Path $hermesExe)) { throw "Nao encontrei $hermesExe." }

function Write-Watch([string]$message) {
    "$([DateTime]::UtcNow.ToString('o')) $message" | Add-Content -Path $watchLog -Encoding utf8
}

# So interessa o que for escrito a partir de agora: um "logged out" de uma sessao
# antiga ja resolvida nao pode derrubar a execucao atual.
$baseline = if (Test-Path $bridgeLog) { (Get-Item $bridgeLog).Length } else { 0 }
$terminalPattern = 'logged_out|Logged out\.'

Write-Watch "iniciando gateway (baseline do bridge.log: $baseline bytes)"

$proc = Start-Process -FilePath $hermesExe -ArgumentList "gateway run" `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $hermesHome "logs\gateway.out.log") `
    -RedirectStandardError (Join-Path $hermesHome "logs\gateway.err.log")

try {
    while (-not $proc.HasExited) {
        Start-Sleep -Seconds $PollSeconds

        if (-not (Test-Path $bridgeLog)) { continue }
        $size = (Get-Item $bridgeLog).Length
        if ($size -le $baseline) { continue }

        $fresh = Get-Content $bridgeLog -Raw -ErrorAction SilentlyContinue
        if ($null -eq $fresh) { continue }
        $tail = $fresh.Substring([Math]::Min($baseline, $fresh.Length))

        if ($tail -match $terminalPattern) {
            Write-Watch "FALHA TERMINAL: sessao do WhatsApp invalidada (logged out)."
            Write-Watch "Encerrando o gateway sem reiniciar -- repareie com 'hermes whatsapp'."
            # Encerra apenas os descendentes deste gateway, incluindo a bridge.
            # Outros processos Node (MCP, frontend etc.) nao pertencem a ele.
            try { & taskkill.exe /PID $proc.Id /T /F | Out-Null }
            catch { Write-Watch "kill falhou: $_" }
            exit 2
        }
    }

    Write-Watch "gateway encerrou por conta propria (codigo $($proc.ExitCode))"
    exit $proc.ExitCode
}
finally {
    if (-not $proc.HasExited) {
        try { & taskkill.exe /PID $proc.Id /T /F | Out-Null } catch { }
    }
}
