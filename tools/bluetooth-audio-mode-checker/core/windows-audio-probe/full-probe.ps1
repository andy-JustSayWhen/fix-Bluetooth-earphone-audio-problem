param([Parameter(Mandatory = $true)][string]$CsPath, [switch]$Watch, [int]$ParentPid)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -Path $CsPath
$parentProcess = if ($ParentPid -gt 0) { [Diagnostics.Process]::GetProcessById($ParentPid) } else { $null }
do {
    if ($parentProcess -and $parentProcess.HasExited) { break }
    [Console]::Out.WriteLine([WindowsAudioProbeCore]::ProbeEndpoints())
    [Console]::Out.Flush()
    if ($Watch) { Start-Sleep -Milliseconds 750 }
} while ($Watch)
