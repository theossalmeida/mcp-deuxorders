<#
.SYNOPSIS
    Reinicia MCP e Hermes sem deixar processos antigos ocupando as portas.
.DESCRIPTION
    Stop-ScheduledTask pode encerrar apenas o supervisor PowerShell. Os filhos
    iniciados em outro console continuam vivos. Este script encerra somente
    processos identificados pelos caminhos exatos deste MCP e deste Hermes.
#>
[CmdletBinding()]
param(
    [ValidateSet("mcp", "hermes", "all")]
    [string]$Service = "all"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$repoRoot = Split-Path -Parent $PSScriptRoot
$hermesExe = Join-Path $env:LOCALAPPDATA "hermes\bin\hermes.exe"
$mcpEntry = Join-Path $repoRoot "dist\mcp-http.js"
$mcpPattern = '(?i)(?:^|\s)"?' + [regex]::Escape($mcpEntry) + '"?(?:\s|$)'
$gatewayPattern = '(?i)(?:^|\s)"?' + [regex]::Escape($hermesExe) + '"?\s+gateway\s+run(?:\s|$)'

$taskNames = @()
if ($Service -in @("all", "hermes")) { $taskNames += "DeuxOrders Hermes Gateway" }
if ($Service -in @("all", "mcp")) { $taskNames += "DeuxOrders MCP" }
foreach ($taskName in $taskNames) { Stop-ScheduledTask -TaskName $taskName }

$ownedProcesses = @(Get-CimInstance Win32_Process | Where-Object {
    ($Service -in @("all", "mcp") -and $_.Name -eq "node.exe" -and $_.CommandLine -match $mcpPattern) -or
    ($Service -in @("all", "hermes") -and $_.Name -in @("hermes.exe", "python.exe") -and $_.CommandLine -match $gatewayPattern)
})
$ownedIds = @($ownedProcesses | ForEach-Object { $_.ProcessId })
foreach ($owned in $ownedProcesses) {
    if ($owned.ParentProcessId -in $ownedIds) { continue }
    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($owned.ProcessId)"
    if ($current -and $current.CreationDate -eq $owned.CreationDate -and $current.CommandLine -eq $owned.CommandLine) {
        & taskkill.exe /PID $owned.ProcessId /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel encerrar o processo $($owned.ProcessId)." }
    }
}

if ($Service -in @("all", "mcp")) { Start-ScheduledTask -TaskName "DeuxOrders MCP" }
if ($Service -in @("all", "hermes")) { Start-ScheduledTask -TaskName "DeuxOrders Hermes Gateway" }
Write-Output "Reinicio solicitado: $Service"
