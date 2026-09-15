[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Stop', 'Restart')]
    [string]$Operation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    throw 'This action requires Windows.'
}

$servicePort = 4173

function Get-ServiceProcessIds {
    @(
        Get-NetTCPConnection -LocalPort $servicePort -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    )
}

function Stop-ServiceProcess {
    $serviceIds = @(Get-ServiceProcessIds)
    if ($serviceIds.Count -eq 0) {
        Write-Output 'Service is not running.'
        return
    }

    foreach ($serviceId in $serviceIds) {
        $serviceProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $serviceId"
        if ($null -eq $serviceProcess) {
            continue
        }

        $isExpectedProcess =
            $serviceProcess.Name -eq 'node.exe' -and
            $serviceProcess.CommandLine -match 'app[\\/]index\.ts'
        if (-not $isExpectedProcess) {
            throw "Port $servicePort is owned by another application (PID $serviceId)."
        }

        Stop-Process -Id $serviceId
        Wait-Process -Id $serviceId -Timeout 10 -ErrorAction SilentlyContinue
    }

    $remainingIds = @(Get-ServiceProcessIds)
    if ($remainingIds.Count -gt 0) {
        throw "Port $servicePort is still listening after the stop operation."
    }

    Write-Output 'Service stopped.'
}

Stop-ServiceProcess

if ($Operation -eq 'Restart') {
    $toolRoot = Split-Path -Parent $PSScriptRoot
    Set-Location -LiteralPath $toolRoot
    & node.exe app/index.ts --port $servicePort --no-open
    exit $LASTEXITCODE
}
