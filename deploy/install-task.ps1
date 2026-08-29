<#
.SYNOPSIS
    Registra (ou remove) as tarefas agendadas do stack DeuxOrders, todas headless.
.DESCRIPTION
    Usa LogonType S4U ("executar estando o usuario conectado ou nao"): a tarefa roda
    numa sessao sem desktop, entao nenhum console aparece. -WindowStyle Hidden sozinho
    NAO resolve, porque na sessao interativa o node abre um console proprio.

    Servicos:
      mcp     -> deploy/start-mcp.ps1        (MCP em 127.0.0.1:3000)
      ollama  -> ollama serve                (modelo local em 127.0.0.1:11434)
      hermes  -> hermes gateway run          (WhatsApp; parear ANTES, veja -Remove)

    O gateway do Hermes so deve ser registrado depois de `hermes whatsapp` ter sido
    pareado uma vez de forma interativa — o QR nao aparece numa tarefa headless.
.EXAMPLE
    .\install-task.ps1 -Service mcp
.EXAMPLE
    .\install-task.ps1 -Service all
.EXAMPLE
    .\install-task.ps1 -Service all -Remove
#>
[CmdletBinding()]
param(
    [ValidateSet("mcp", "ollama", "hermes", "all")]
    [string]$Service = "all",
    [switch]$Remove
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$hermesHome = Join-Path $env:LOCALAPPDATA "hermes"

$script:elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not ($Remove -or $script:elevated)) {
    Write-Warning "Sem elevacao: as tarefas ficam headless, mas o Agendador nao supervisiona nem reinicia em falha. Rode como Administrador para o modo S4U supervisionado."
}

$definitions = @{
    mcp = @{
        TaskName = "DeuxOrders MCP"
        Execute  = "powershell.exe"
        Argument = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'start-mcp.ps1')`""
        WorkDir  = $repoRoot
        Descr    = "MCP DeuxOrders em 127.0.0.1:3000 para o Hermes."
    }
    ollama = @{
        TaskName = "DeuxOrders Ollama"
        Execute  = (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe")
        Argument = "serve"
        WorkDir  = $env:USERPROFILE
        Descr    = "Ollama headless em 127.0.0.1:11434."
    }
    hermes = @{
        TaskName = "DeuxOrders Hermes Gateway"
        Execute  = (Join-Path $hermesHome "bin\hermes.exe")
        Argument = "gateway run"
        WorkDir  = $hermesHome
        Descr    = "Gateway Hermes (WhatsApp) ligado ao MCP DeuxOrders."
    }
}

$targets = if ($Service -eq "all") { $definitions.Keys } else { @($Service) }

foreach ($key in $targets) {
    $def = $definitions[$key]

    if ($Remove) {
        if (Get-ScheduledTask -TaskName $def.TaskName -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $def.TaskName -Confirm:$false
            Write-Host "Removida: $($def.TaskName)"
        }
        continue
    }

    $isPath = $def.Execute -match '[\\/]'
    if ($isPath -and -not (Test-Path $def.Execute)) {
        Write-Warning "Pulando '$key': nao encontrei $($def.Execute)"
        continue
    }
    if (-not $isPath -and -not (Get-Command $def.Execute -ErrorAction SilentlyContinue)) {
        Write-Warning "Pulando '$key': '$($def.Execute)' nao esta no PATH"
        continue
    }

    if ($script:elevated) {
        # S4U roda numa sessao sem desktop: headless E supervisionado, entao
        # RestartCount vale de verdade.
        $action = New-ScheduledTaskAction -Execute $def.Execute -Argument $def.Argument -WorkingDirectory $def.WorkDir
    }
    else {
        # Sem elevacao: esconde a janela pelo VBS. O custo e que o wscript sai
        # assim que dispara o processo, entao o Agendador nao supervisiona e o
        # reinicio automatico nao acontece.
        $launcher = Join-Path $PSScriptRoot "run-hidden.vbs"
        $inner = "`"$($def.Execute)`" $($def.Argument)"
        $action = New-ScheduledTaskAction `
            -Execute "wscript.exe" `
            -Argument "`"$launcher`" `"$inner`"" `
            -WorkingDirectory $def.WorkDir
    }

    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -RestartCount 3 `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -MultipleInstances IgnoreNew

    $principal = if ($script:elevated) {
        New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
    }
    else {
        New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
    }

    Register-ScheduledTask `
        -TaskName $def.TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description $def.Descr `
        -Force | Out-Null

    Write-Host "Registrada (headless): $($def.TaskName)"
}
