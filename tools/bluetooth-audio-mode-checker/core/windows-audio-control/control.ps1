param(
    [ValidateSet('route','process','close','restart')][string]$Action,
    [string]$EndpointId,
    [int]$Role = -1,
    [int]$TargetPid,
    [string]$ExpectedStart,
    [string]$InstanceId
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
if ($Action -eq 'route') {
    if ($EndpointId -notmatch '^\{0\.0\.[01]\.00000000\}\.\{[0-9a-fA-F-]+\}$') { throw 'Invalid audio endpoint identity' }
    Add-Type -Path (Join-Path $PSScriptRoot 'control.cs')
    if ($Role -ge 0 -and $Role -le 2) { [WindowsAudioControl]::SetDefault($EndpointId, $Role) }
    else { foreach ($r in 0,1,2) { [WindowsAudioControl]::SetDefault($EndpointId, $r) } }
    '{"ok":true}'
} elseif ($Action -eq 'process' -or $Action -eq 'close') {
    $target = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
    if (-not $target) { 'null'; exit 0 }
    $start = $target.StartTime.ToUniversalTime().ToString('o')
    if ($Action -eq 'close') {
        if ($start -ne $ExpectedStart) { throw 'Process identity changed' }
        if ($target.SessionId -eq 0 -or $target.ProcessName -match '^(System|Idle|svchost|audiodg|services|lsass|csrss|wininit|winlogon|smss|dwm|explorer|powershell|pwsh|node)$') { throw 'Protected process' }
        if (-not $target.CloseMainWindow()) { throw 'Application has no main window; close its microphone manually' }
        '{"ok":true}'
    } else {
        [pscustomobject]@{pid=$target.Id;name=$target.ProcessName;command=$target.Path;startedAt=$start} | ConvertTo-Json -Compress
    }
} elseif ($Action -eq 'restart') {
    if ($InstanceId -notmatch '^BTHENUM\\DEV_[0-9A-Fa-f]{12}\\[^\r\n]+$') { throw 'Target is not a unique Bluetooth physical device' }
    $device = Get-PnpDevice -InstanceId $InstanceId -ErrorAction Stop
    if (@($device).Count -ne 1) { throw 'Bluetooth device identity is not unique' }
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) { throw 'Restart requires administrator: restart the tool as administrator and retry' }
    & pnputil.exe /restart-device $InstanceId | Out-Null
    if ($LASTEXITCODE -ne 0) { throw ('Device restart failed with exit code ' + $LASTEXITCODE) }
    '{"ok":true}'
}
