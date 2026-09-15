param([Parameter(Mandatory = $true)][string]$CsPath, [switch]$Watch, [int]$ParentPid, [switch]$DiagnoseHardware, [string]$DeviceInterface, [string]$TraceFile, [string]$HistoryFile, [string]$NegotiationCacheFile, [switch]$InspectNegotiationCache)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -Path $CsPath

$lastNegotiationCacheJson = $null
function Save-NegotiationCache([string]$snapshotJson) {
    if (-not $NegotiationCacheFile) { return }
    try {
        $snapshot = $snapshotJson | ConvertFrom-Json
        $parameters = @($snapshot.a2dpStreams | Where-Object {
            $null -ne $_.codec -and $_.sampleRate -gt 0 -and $_.channels -gt 0
        } | Sort-Object address | Select-Object address, codec, vendorId, sampleRate, channels, negotiatedAt)
        if ($parameters.Count -eq 0) { return }
        $json = ConvertTo-Json -InputObject $parameters -Compress
        if ($json -eq $script:lastNegotiationCacheJson) { return }
        $directory = Split-Path -Parent $NegotiationCacheFile
        if ($directory) { [IO.Directory]::CreateDirectory($directory) | Out-Null }
        $temporary = $NegotiationCacheFile + ".tmp"
        [IO.File]::WriteAllText($temporary, $json, (New-Object System.Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporary -Destination $NegotiationCacheFile -Force
        $script:lastNegotiationCacheJson = $json
    } catch { [Console]::Error.WriteLine("A2DP parameter cache unavailable: " + $_.Exception.Message) }
}

function Load-NegotiationCache {
    if (-not $NegotiationCacheFile -or -not (Test-Path -LiteralPath $NegotiationCacheFile)) { return $false }
    try {
        $json = [IO.File]::ReadAllText($NegotiationCacheFile, [Text.Encoding]::UTF8)
        $loadedCount = 0
        $parsed = $json | ConvertFrom-Json
        $items = if ($parsed -is [Array]) { $parsed } else { @($parsed) }
        foreach ($item in $items) {
            $address = [string]$item.PSObject.Properties['address'].Value
            $codec = $item.PSObject.Properties['codec'].Value
            $vendorId = $item.PSObject.Properties['vendorId'].Value
            $sampleRate = $item.PSObject.Properties['sampleRate'].Value
            $channels = $item.PSObject.Properties['channels'].Value
            $negotiatedAt = [string]$item.PSObject.Properties['negotiatedAt'].Value
            if ($address -and $null -ne $codec -and $sampleRate -gt 0 -and $channels -gt 0) {
                [WindowsAudioProbeCore]::ObserveA2dpNegotiation(
                    $address, [uint32]0, [uint32]$codec, [uint32]$vendorId,
                    [uint32]$sampleRate, [uint32]$channels, $negotiatedAt)
                $loadedCount++
            }
        }
        $script:lastNegotiationCacheJson = $json
        return $loadedCount -gt 0
    } catch { [Console]::Error.WriteLine("A2DP parameter cache unavailable: " + $_.Exception.Message); return $false }
}

if ($InspectNegotiationCache) {
    if (-not (Load-NegotiationCache)) { throw "A2DP parameter cache could not be loaded: $NegotiationCacheFile" }
    [Console]::Out.WriteLine([WindowsAudioProbeCore]::InspectA2dpState())
    exit 0
}
if ($TraceFile) {
    $traceJson = [WindowsAudioProbeCore]::InspectTraceFile($TraceFile)
    Save-NegotiationCache $traceJson
    [Console]::Out.WriteLine($traceJson)
    exit 0
}
if ($DeviceInterface) { [Console]::Out.WriteLine([WindowsAudioProbeCore]::InspectFilterPath($DeviceInterface)); exit 0 }
if ($DiagnoseHardware) { [Console]::Out.WriteLine([WindowsAudioProbeCore]::InspectHardwareFormats()); exit 0 }
$parentProcess = if ($ParentPid -gt 0) { [Diagnostics.Process]::GetProcessById($ParentPid) } else { $null }
$traceName = "BluetoothAudioMode-$PID"
$traceStarted = $false
try {
    if ($Watch) {
        # A forced process-tree termination cannot execute finally. Reap only dead owners.
        & logman.exe query -ets | ForEach-Object {
            if ($_ -match '^BluetoothAudioMode-(\d+)\s') {
                $ownerId = [int]$Matches[1]
                if (-not (Get-Process -Id $ownerId -ErrorAction SilentlyContinue)) {
                    & logman.exe stop "BluetoothAudioMode-$ownerId" -ets *> $null
                }
            }
        }
        # Seed display parameters from the durable cache, then let newer raw events override them.
        $stateKept = Load-NegotiationCache
        # Startup history backfill: replay the previous run's events before opening a new session.
        if ($HistoryFile -and (Test-Path -LiteralPath $HistoryFile)) {
            try {
                $historyJson = [WindowsAudioProbeCore]::ReplayHistoryFile($HistoryFile, 1800)
                Save-NegotiationCache $historyJson
                $stateKept = $true
            }
            catch { [Console]::Error.WriteLine("History replay unavailable: " + $_.Exception.Message) }
            Remove-Item -LiteralPath $HistoryFile -Force -ErrorAction SilentlyContinue
        }
        # logman rejects two -p parameters in one command; write a circular history file and
        # add the A2DP stream provider via update.
        $createArgs = @("create", "trace", $traceName, "-rt", "-ft", "1")
        if ($HistoryFile) { $createArgs += @("-f", "bincirc", "-max", "16", "-o", $HistoryFile) }
        $createArgs += @("-p", "{8A1F9517-3A8C-4A9E-A018-4F17A200F277}", "0xffffffffffffffff", "5", "-ets")
        & logman.exe @createArgs *> $null
        $traceStarted = $LASTEXITCODE -eq 0
        if ($traceStarted) {
            & logman.exe update trace $traceName -p "{8776AD1E-5022-4451-A566-F47E708B9075}" 0xffffffffffffffff 5 -ets *> $null
            if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine("A2DP stream provider unavailable: logman update exit " + $LASTEXITCODE) }
            try { [WindowsAudioProbeCore]::StartLinkTrace($traceName, $stateKept) }
            catch { [Console]::Error.WriteLine("Bluetooth trace unavailable: " + $_.Exception.Message) }
        }
    }
    do {
        if ($parentProcess -and $parentProcess.HasExited) { break }
        $snapshotJson = [WindowsAudioProbeCore]::ProbeEndpoints()
        Save-NegotiationCache $snapshotJson
        [Console]::Out.WriteLine($snapshotJson)
        [Console]::Out.Flush()
        if ($Watch) { Start-Sleep -Milliseconds 750 }
    } while ($Watch)
} finally {
    if ($traceStarted) { & logman.exe stop $traceName -ets *> $null }
    [WindowsAudioProbeCore]::StopLinkTrace()
}
