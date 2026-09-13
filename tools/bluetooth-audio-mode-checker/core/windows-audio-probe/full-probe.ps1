param([Parameter(Mandatory = $true)][string]$CsPath, [switch]$Watch, [int]$ParentPid, [switch]$DiagnoseHardware, [string]$DeviceInterface, [string]$TraceFile)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -Path $CsPath
if ($TraceFile) { [Console]::Out.WriteLine([WindowsAudioProbeCore]::InspectTraceFile($TraceFile)); exit 0 }
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
        & logman.exe create trace $traceName -rt -ft 1 -p "{8A1F9517-3A8C-4A9E-A018-4F17A200F277}" 0xffffffffffffffff 5 -ets *> $null
        $traceStarted = $LASTEXITCODE -eq 0
        if ($traceStarted) {
            try { [WindowsAudioProbeCore]::StartLinkTrace($traceName) }
            catch { [Console]::Error.WriteLine("Bluetooth trace unavailable: " + $_.Exception.Message) }
        }
    }
    do {
        if ($parentProcess -and $parentProcess.HasExited) { break }
        [Console]::Out.WriteLine([WindowsAudioProbeCore]::ProbeEndpoints())
        [Console]::Out.Flush()
        if ($Watch) { Start-Sleep -Milliseconds 750 }
    } while ($Watch)
} finally {
    if ($traceStarted) { & logman.exe stop $traceName -ets *> $null }
    [WindowsAudioProbeCore]::StopLinkTrace()
}
