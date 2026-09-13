param([Parameter(Mandatory = $true)][string]$CsPath, [switch]$Watch, [int]$ParentPid, [switch]$DiagnoseHardware)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -Path $CsPath
if ($DiagnoseHardware) { [Console]::Out.WriteLine([WindowsAudioProbeCore]::InspectHardwareFormats()); exit 0 }
$parentProcess = if ($ParentPid -gt 0) { [Diagnostics.Process]::GetProcessById($ParentPid) } else { $null }
do {
    if ($parentProcess -and $parentProcess.HasExited) { break }
    [Console]::Out.WriteLine([WindowsAudioProbeCore]::ProbeEndpoints())
    [Console]::Out.Flush()
    if ($Watch) { Start-Sleep -Milliseconds 750 }
} while ($Watch)
