param(
    [ValidateSet('route','process','close','terminate','restart','bluetooth-inventory','bluetooth-radio-state','bluetooth-radio-set','bluetooth-reconnect','bluetooth-audio-reconnect')][string]$Action,
    [string]$EndpointId,
    [int]$Role = -1,
    [int]$TargetPid,
    [string]$ExpectedStart,
    [string]$InstanceId,
    [ValidateSet('On','Off')][string]$RadioState,
    [ValidateSet('classic','le')][string]$DeviceKind,
    [string]$DeviceId,
    [string]$Address
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Initialize-WinRt { Add-Type -AssemblyName System.Runtime.WindowsRuntime }
function Wait-WinRtResult([object]$Operation, [Type]$ResultType) {
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
    $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation)); $task.Wait(); return $task.Result
}
function Get-BluetoothAddress([string]$Id) {
    $matches = [regex]::Matches($Id, '(?i)(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}')
    if ($matches.Count -gt 0) { return ($matches[$matches.Count - 1].Value -replace '[:-]', '').ToUpperInvariant() }
    if ($Id -match '(?i)DEV_([0-9a-f]{12})') { return $Matches[1].ToUpperInvariant() }
    return $null
}
function Restart-BluetoothPhysicalNode([string]$RemoteAddress) {
    if ($RemoteAddress -notmatch '^[0-9A-Fa-f]{12}$') { return 'skipped-invalid-address' }
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) { return 'skipped-not-administrator' }
    $pattern = '^(?:BTHENUM|BTHLE)\\DEV_' + [regex]::Escape($RemoteAddress) + '\\'
    $devices = @(Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match $pattern })
    if ($devices.Count -ne 1) { return ('skipped-node-count-' + $devices.Count) }
    & pnputil.exe /restart-device $devices[0].InstanceId | Out-Null
    if ($LASTEXITCODE -ne 0) { return ('failed-exit-' + $LASTEXITCODE) }
    return 'requested'
}
function Get-ConnectedBluetoothDevices {
    Initialize-WinRt
    $statusType = [Windows.Devices.Bluetooth.BluetoothConnectionStatus,Windows.Devices.Bluetooth,ContentType=WindowsRuntime]
    $classicType = [Windows.Devices.Bluetooth.BluetoothDevice,Windows.Devices.Bluetooth,ContentType=WindowsRuntime]
    $leType = [Windows.Devices.Bluetooth.BluetoothLEDevice,Windows.Devices.Bluetooth,ContentType=WindowsRuntime]
    $informationType = [Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
    $collectionType = [Windows.Devices.Enumeration.DeviceInformationCollection,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
    $connected = [Enum]::Parse($statusType, 'Connected'); $result = @()
    foreach ($entry in @(@{kind='classic';selector=$classicType::GetDeviceSelectorFromConnectionStatus($connected)}, @{kind='le';selector=$leType::GetDeviceSelectorFromConnectionStatus($connected)})) {
        $items = Wait-WinRtResult ($informationType::FindAllAsync($entry.selector)) $collectionType
        foreach ($item in $items) { $result += [pscustomobject]@{id=[string]$item.Id;name=if([string]::IsNullOrWhiteSpace([string]$item.Name)){'Unnamed Bluetooth device'}else{[string]$item.Name};kind=$entry.kind;address=Get-BluetoothAddress ([string]$item.Id)} }
    }
    return @($result | Sort-Object id -Unique)
}
function Get-BluetoothRadios {
    Initialize-WinRt
    $radioType = [Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime]
    $radioKindType = [Windows.Devices.Radios.RadioKind,Windows.System.Devices,ContentType=WindowsRuntime]
    $listType = [System.Collections.Generic.IReadOnlyList[int]].GetGenericTypeDefinition().MakeGenericType($radioType)
    $radios = Wait-WinRtResult ($radioType::GetRadiosAsync()) $listType
    return @($radios | Where-Object { $_.Kind -eq [Enum]::Parse($radioKindType, 'Bluetooth') })
}

if ($Action -eq 'route') {
    if ($EndpointId -notmatch '^\{0\.0\.[01]\.00000000\}\.\{[0-9a-fA-F-]+\}$') { throw 'Invalid audio endpoint identity' }
    Add-Type -Path (Join-Path $PSScriptRoot 'control.cs')
    if ($Role -ge 0 -and $Role -le 2) { [WindowsAudioControl]::SetDefault($EndpointId, $Role) }
    else { foreach ($r in 0,1,2) { [WindowsAudioControl]::SetDefault($EndpointId, $r) } }
    '{"ok":true}'
} elseif ($Action -eq 'process' -or $Action -eq 'close' -or $Action -eq 'terminate') {
    $target = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
    if (-not $target) { 'null'; exit 0 }
    $start = $target.StartTime.ToUniversalTime().ToString('o')
    if ($Action -eq 'close' -or $Action -eq 'terminate') {
        if ($start -ne $ExpectedStart) { throw 'Process identity changed' }
        if ($target.SessionId -eq 0 -or $target.ProcessName -match '^(System|Idle|svchost|audiodg|services|lsass|csrss|wininit|winlogon|smss|dwm|explorer|powershell|pwsh|node)$') { throw 'Protected process' }
        $primaryError = $null
        try {
            Stop-Process -Id $target.Id -Force -ErrorAction Stop
        } catch {
            $primaryError = $_.Exception.Message
        }
        Start-Sleep -Milliseconds 100
        $remaining = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
        if (-not $remaining) {
            [pscustomobject]@{ok=$true;method='Stop-Process';fallbackUsed=$false} | ConvertTo-Json -Compress
            exit 0
        }
        $remainingStart = $remaining.StartTime.ToUniversalTime().ToString('o')
        if ($remainingStart -ne $ExpectedStart) {
            [pscustomobject]@{ok=$true;method='Stop-Process';fallbackUsed=$false;identityReplaced=$true} | ConvertTo-Json -Compress
            exit 0
        }

        $fallbackError = $null
        try {
            $cimTarget = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = ' + $TargetPid) -ErrorAction Stop
            if ($cimTarget) {
                $terminateResult = Invoke-CimMethod -InputObject $cimTarget -MethodName Terminate -Arguments @{Reason=0} -ErrorAction Stop
                if ($terminateResult.ReturnValue -ne 0) {
                    throw ('Win32_Process.Terminate returned ' + $terminateResult.ReturnValue)
                }
            }
        } catch {
            $fallbackError = $_.Exception.Message
        }
        Start-Sleep -Milliseconds 100
        $afterFallback = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
        if (-not $afterFallback) {
            [pscustomobject]@{ok=$true;method='Win32_Process.Terminate';fallbackUsed=$true;primaryError=$primaryError} | ConvertTo-Json -Compress
            exit 0
        }
        $afterFallbackStart = $afterFallback.StartTime.ToUniversalTime().ToString('o')
        if ($afterFallbackStart -ne $ExpectedStart) {
            [pscustomobject]@{ok=$true;method='Win32_Process.Terminate';fallbackUsed=$true;identityReplaced=$true;primaryError=$primaryError} | ConvertTo-Json -Compress
            exit 0
        }
        $primaryDetail = if ($primaryError) { $primaryError } else { 'old process identity remained after the first method' }
        $fallbackDetail = if ($fallbackError) { $fallbackError } else { 'old process identity remained after the fallback method' }
        throw ('All terminate methods failed: primary=' + $primaryDetail + '; fallback=' + $fallbackDetail)
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
} elseif ($Action -eq 'bluetooth-inventory') {
    ConvertTo-Json -InputObject @(Get-ConnectedBluetoothDevices) -Compress
} elseif ($Action -eq 'bluetooth-radio-state') {
    $radios = @(Get-BluetoothRadios)
    if ($radios.Count -eq 0) { throw 'No Bluetooth radio was found' }
    [pscustomobject]@{on=@($radios | Where-Object {$_.State.ToString() -eq 'On'}).Count -eq $radios.Count;states=@($radios | ForEach-Object {$_.State.ToString()})} | ConvertTo-Json -Compress
} elseif ($Action -eq 'bluetooth-radio-set') {
    Initialize-WinRt
    $radioType = [Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime]
    $accessType = [Windows.Devices.Radios.RadioAccessStatus,Windows.System.Devices,ContentType=WindowsRuntime]
    $stateType = [Windows.Devices.Radios.RadioState,Windows.System.Devices,ContentType=WindowsRuntime]
    $access = Wait-WinRtResult ($radioType::RequestAccessAsync()) $accessType
    if ($access.ToString() -ne 'Allowed') { throw ('Bluetooth radio access was not allowed: ' + $access) }
    $radios = @(Get-BluetoothRadios); if ($radios.Count -eq 0) { throw 'No Bluetooth radio was found' }
    $desired = [Enum]::Parse($stateType, $RadioState)
    foreach ($radio in $radios) { $result = Wait-WinRtResult ($radio.SetStateAsync($desired)) $accessType; if ($result.ToString() -ne 'Allowed') { throw ('Bluetooth state request was not allowed: ' + $result) } }
    [pscustomobject]@{ok=$true;requested=$RadioState} | ConvertTo-Json -Compress
} elseif ($Action -eq 'bluetooth-reconnect') {
    if ([string]::IsNullOrWhiteSpace($DeviceId) -or $DeviceId -match '[\r\n]') { throw 'Invalid Bluetooth device identity' }
    Initialize-WinRt
    $cacheType = [Windows.Devices.Bluetooth.BluetoothCacheMode,Windows.Devices.Bluetooth,ContentType=WindowsRuntime]
    $uncached = [Enum]::Parse($cacheType, 'Uncached'); $serviceResult = $null; $serviceError = $null
    try {
        if ($DeviceKind -eq 'le') {
            $deviceType = [Windows.Devices.Bluetooth.BluetoothLEDevice,Windows.Devices.Bluetooth,ContentType=WindowsRuntime]
            $resultType = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattDeviceServicesResult,Windows.Devices.Bluetooth,ContentType=WindowsRuntime]
            $device = Wait-WinRtResult ($deviceType::FromIdAsync($DeviceId)) $deviceType
            if ($null -eq $device) { throw 'The low energy Bluetooth device could not be opened' }
            try { $serviceResult = Wait-WinRtResult ($device.GetGattServicesAsync($uncached)) $resultType } finally { if ($device -is [IDisposable]) {$device.Dispose()} }
        } else {
            $deviceType = [Windows.Devices.Bluetooth.BluetoothDevice,Windows.Devices.Bluetooth,ContentType=WindowsRuntime]
            $resultType = [Windows.Devices.Bluetooth.Rfcomm.RfcommDeviceServicesResult,Windows.Devices.Bluetooth,ContentType=WindowsRuntime]
            $device = Wait-WinRtResult ($deviceType::FromIdAsync($DeviceId)) $deviceType
            if ($null -eq $device) { throw 'The Bluetooth device could not be opened' }
            try { $serviceResult = Wait-WinRtResult ($device.GetRfcommServicesAsync($uncached)) $resultType } finally { if ($device -is [IDisposable]) {$device.Dispose()} }
        }
    } catch { $serviceError = $_.Exception.Message }
    $nodeResult = Restart-BluetoothPhysicalNode $Address
    [pscustomobject]@{ok=($null -ne $serviceResult -or $nodeResult -eq 'requested');serviceError=$serviceError;serviceStatus=if($null -ne $serviceResult){$serviceResult.Error.ToString()}else{$null};nodeRestart=$nodeResult} | ConvertTo-Json -Compress
} elseif ($Action -eq 'bluetooth-audio-reconnect') {
    if ($EndpointId -notmatch '^\{0\.0\.[01]\.00000000\}\.\{[0-9a-fA-F-]+\}$') { throw 'Invalid audio endpoint identity' }
    Add-Type -Path (Join-Path $PSScriptRoot 'control.cs')
    [WindowsAudioControl]::ReconnectBluetoothAudio($EndpointId)
    '{"ok":true}'
}
