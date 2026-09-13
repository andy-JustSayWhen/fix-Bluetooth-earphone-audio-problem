# Full probe: enumerate audio endpoints via Core Audio, resolve each endpoint's
# physical device through the PnP parent chain, and print one JSON line.
# ASCII only; PowerShell 5.1 compatible.
param(
    [Parameter(Mandatory = $true)][string]$CsPath
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

$source = Get-Content -Raw -LiteralPath $CsPath
Add-Type -TypeDefinition $source -Language CSharp

$audio = [WindowsAudioProbeCore]::ProbeEndpoints() | ConvertFrom-Json

# --- Map every MMDEVAPI endpoint to its PnP instance and parent chain. ---
$endpointPnp = @{}
try {
    $audioEndpoints = @(Get-CimInstance -ClassName Win32_PnPEntity -Filter "PNPClass='AudioEndpoint'" -ErrorAction Stop)
    foreach ($d in $audioEndpoints) {
        if ($d.DeviceID -match '\.(\{[0-9A-Fa-f-]+\})$') {
            $endpointPnp[$matches[1].ToUpperInvariant()] = $d.DeviceID
        }
    }
} catch { }

$parentCache = @{}
$frontier = New-Object System.Collections.Generic.List[string]
$allSeen = @{}
foreach ($id in $endpointPnp.Values) {
    if (-not $allSeen.ContainsKey($id)) { $allSeen[$id] = $true; $frontier.Add($id) }
}
for ($wave = 0; $wave -lt 8 -and $frontier.Count -gt 0; $wave++) {
    try {
        $props = @(Get-PnpDeviceProperty -InstanceId $frontier.ToArray() -KeyName 'DEVPKEY_Device_Parent' -ErrorAction SilentlyContinue)
    } catch { break }
    $next = New-Object System.Collections.Generic.List[string]
    foreach ($p in $props) {
        if ($null -ne $p -and $null -ne $p.Data -and "$($p.Data)" -ne '') {
            $parentCache[$p.InstanceId] = [string]$p.Data
            if (-not $allSeen.ContainsKey([string]$p.Data)) {
                $allSeen[[string]$p.Data] = $true
                $next.Add([string]$p.Data)
            }
        }
    }
    $frontier = $next
}

# --- Names and manufacturers of all present PnP devices. ---
$nameMap = @{}
$manufacturerMap = @{}
try {
    Get-CimInstance -ClassName Win32_PnPEntity -ErrorAction Stop | ForEach-Object {
        $id = [string]$_.DeviceID
        if ($id) {
            if ($_.Name) { $nameMap[$id] = [string]$_.Name }
            if ($_.Manufacturer) { $manufacturerMap[$id] = [string]$_.Manufacturer }
        }
    }
} catch { }

function Get-Chain([string]$startId) {
    $chain = New-Object System.Collections.Generic.List[string]
    $current = $startId
    for ($hop = 0; $hop -lt 10 -and $current; $hop++) {
        $chain.Add($current)
        if ($parentCache.ContainsKey($current)) { $current = $parentCache[$current] } else { break }
    }
    return $chain
}

function Get-Transport([System.Collections.Generic.List[string]]$chain) {
    foreach ($id in $chain) {
        if ($id -like 'BTHENUM\*' -or $id -like 'BTHHFENUM*' -or $id -like 'BTHA2DP\*') { return 'bluetooth' }
    }
    foreach ($id in $chain) { if ($id -like 'USB\*') { return 'usb' } }
    foreach ($id in $chain) { if ($id -like 'HDAUDIO\*') { return 'built-in' } }
    foreach ($id in $chain) {
        if ($id -like 'ROOT\MEDIA*' -or $id -like 'SWD\MMDEVAPI*') { return 'virtual' }
    }
    if ($chain.Count -gt 0) { return ($chain[0].Split('\')[0].ToLowerInvariant()) }
    return 'unknown'
}

function Get-Role([System.Collections.Generic.List[string]]$chain) {
    foreach ($id in $chain) { if ($id -like 'BTHHFENUM*') { return 'handsfree' } }
    foreach ($id in $chain) { if ($id -like 'BTHENUM\{0000110b-*') { return 'a2dp' } }
    foreach ($id in $chain) { if ($id -like 'BTHA2DP\*') { return 'a2dp' } }
    return $null
}

function Get-BluetoothAddress([System.Collections.Generic.List[string]]$chain) {
    foreach ($id in $chain) {
        if ($id -match 'BTHENUM\\DEV_([0-9A-Fa-f]{12})') { return $matches[1].ToUpperInvariant() }
    }
    return $null
}

function Get-CanonicalId([System.Collections.Generic.List[string]]$chain, [string]$transport, [string]$endpointId) {
    foreach ($id in $chain) { if ($id -like 'BTHENUM\DEV_*') { return $id } }
    if ($transport -eq 'usb' -and $chain.Count -gt 0) {
        $segments = $chain[0].Split('\')
        if ($segments.Length -ge 2) { return ($segments[0] + '\' + ($segments[1] -replace '&MI_\d+$', '')) }
    }
    if ($chain.Count -gt 0) { return $chain[$chain.Count - 1] }
    return $endpointId
}

function Get-PhysicalName([System.Collections.Generic.List[string]]$chain, [string]$transport, [string]$btAddress) {
    if ($btAddress) {
        foreach ($id in $chain) {
            if ($id -like 'BTHENUM\DEV_*' -and $nameMap.ContainsKey($id)) { return $nameMap[$id] }
        }
    }
    foreach ($id in $chain) {
        if ($id -like 'SWD\MMDEVAPI*') { continue }
        if ($nameMap.ContainsKey($id)) { return $nameMap[$id] }
    }
    return $null
}

function Get-PhysicalManufacturer([System.Collections.Generic.List[string]]$chain) {
    foreach ($id in $chain) {
        if ($id -like 'SWD\MMDEVAPI*') { continue }
        if ($manufacturerMap.ContainsKey($id)) { return $manufacturerMap[$id] }
    }
    return $null
}

$result = New-Object System.Collections.Generic.List[object]
foreach ($e in $audio.endpoints) {
    $guid = $null
    if ($e.endpoint.id -match '\.(\{[0-9A-Fa-f-]+\})$') { $guid = $matches[1].ToUpperInvariant() }
    $chain = New-Object System.Collections.Generic.List[string]
    if ($guid -and $endpointPnp.ContainsKey($guid)) { $chain = Get-Chain $endpointPnp[$guid] }
    $transport = Get-Transport $chain
    $btAddress = Get-BluetoothAddress $chain
    $role = Get-Role $chain
    $result.Add([pscustomobject]@{
        flow = $e.flow
        id = $e.endpoint.id
        name = $e.endpoint.name
        rate = $e.endpoint.rate
        channels = $e.endpoint.channels
        bits = $e.endpoint.bits
        transport = $transport
        role = $role
        bluetoothAddress = $btAddress
        canonicalId = Get-CanonicalId $chain $transport $e.endpoint.id
        physicalName = Get-PhysicalName $chain $transport $btAddress
        manufacturer = Get-PhysicalManufacturer $chain
        pnpFound = [bool]($guid -and $endpointPnp.ContainsKey($guid))
    })
}

[pscustomobject]@{
    endpoints = $result
    defaults = $audio.defaults
} | ConvertTo-Json -Compress -Depth 6
