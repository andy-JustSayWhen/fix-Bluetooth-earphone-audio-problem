[CmdletBinding()]
param(
  [Parameter()]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version = '1.0.0',

  [Parameter()]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$NodeVersion = '24.21.0',

  [Parameter()]
  [string]$Proxy = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$toolRoot = Split-Path -Parent $PSScriptRoot
$projectRoot = (Resolve-Path (Join-Path $toolRoot '..\..')).Path
$buildRoot = Join-Path $projectRoot '.build\releases'
$downloadRoot = Join-Path $projectRoot '.build\downloads'
$artifactRoot = Join-Path $projectRoot 'artifacts\releases'
$packageName = "蓝牙音频设备模式检查器-windows-x64-v$Version"
$stageRoot = Join-Path $buildRoot $packageName
$archivePath = Join-Path $artifactRoot "$packageName.zip"
$nodeArchiveName = "node-v$NodeVersion-win-x64.zip"
$nodeArchivePath = Join-Path $downloadRoot $nodeArchiveName
$nodeDistUrl = "https://nodejs.org/dist/v$NodeVersion"
$checksumsPath = Join-Path $downloadRoot "SHASUMS256-v$NodeVersion.txt"
$nodeExpandedRoot = Join-Path $buildRoot "node-v$NodeVersion-win-x64"

function Assert-ChildPath {
  param(
    [Parameter(Mandatory)] [string]$Parent,
    [Parameter(Mandatory)] [string]$Child
  )

  $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  $childFull = [System.IO.Path]::GetFullPath($Child)
  if (-not $childFull.StartsWith($parentFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝操作超出构建目录的路径：$childFull"
  }
}

function Remove-BuildPath {
  param([Parameter(Mandatory)] [string]$Path)

  Assert-ChildPath -Parent $buildRoot -Child $Path
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

function Invoke-ReleaseDownload {
  param(
    [Parameter(Mandatory)] [string]$Uri,
    [Parameter(Mandatory)] [string]$OutFile
  )

  $request = @{
    Uri = $Uri
    OutFile = $OutFile
  }
  if ($Proxy) {
    $request.Proxy = $Proxy
  }
  Invoke-WebRequest @request
}

New-Item -ItemType Directory -Force -Path $buildRoot, $downloadRoot, $artifactRoot | Out-Null
Remove-BuildPath -Path $stageRoot
Remove-BuildPath -Path $nodeExpandedRoot

Write-Host "下载并校验 Node.js v$NodeVersion Windows x64 运行环境……"
Invoke-ReleaseDownload -Uri "$nodeDistUrl/SHASUMS256.txt" -OutFile $checksumsPath
$checksumLine = Get-Content -LiteralPath $checksumsPath | Where-Object { $_ -match "\s+$([regex]::Escape($nodeArchiveName))$" } | Select-Object -First 1
if (-not $checksumLine) {
  throw "官方摘要文件中没有找到 $nodeArchiveName"
}
$expectedHash = ($checksumLine -split '\s+')[0].ToUpperInvariant()

$downloadRequired = $true
if (Test-Path -LiteralPath $nodeArchivePath) {
  $existingHash = (Get-FileHash -LiteralPath $nodeArchivePath -Algorithm SHA256).Hash
  $downloadRequired = $existingHash -ne $expectedHash
}
if ($downloadRequired) {
  Invoke-ReleaseDownload -Uri "$nodeDistUrl/$nodeArchiveName" -OutFile $nodeArchivePath
}
$actualHash = (Get-FileHash -LiteralPath $nodeArchivePath -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) {
  throw "Node.js 压缩包校验失败。预期 $expectedHash，实际 $actualHash"
}

Expand-Archive -LiteralPath $nodeArchivePath -DestinationPath $buildRoot -Force
New-Item -ItemType Directory -Force -Path $stageRoot, (Join-Path $stageRoot 'runtime') | Out-Null

foreach ($directory in @('app', 'core', 'features', 'shared')) {
  Copy-Item -LiteralPath (Join-Path $toolRoot $directory) -Destination $stageRoot -Recurse
}

Get-ChildItem -LiteralPath $stageRoot -Recurse -File | Where-Object {
  $_.Name -match '\.test\.(ts|js)$' -or $_.Name -eq 'build-windows-release.ps1'
} | Remove-Item -Force
Remove-BuildPath -Path (Join-Path $stageRoot 'app\windows-release')

Copy-Item -LiteralPath (Join-Path $toolRoot 'package.json') -Destination $stageRoot
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'windows-release\一键运行.cmd') -Destination $stageRoot
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'windows-release\使用说明.txt') -Destination $stageRoot
$instructionsPath = Join-Path $stageRoot '使用说明.txt'
$instructions = (Get-Content -LiteralPath $instructionsPath -Raw).Replace('{{VERSION}}', "v$Version")
[System.IO.File]::WriteAllText($instructionsPath, $instructions, [System.Text.UTF8Encoding]::new($true))
Copy-Item -LiteralPath (Join-Path $nodeExpandedRoot 'node.exe') -Destination (Join-Path $stageRoot 'runtime\node.exe')
Copy-Item -LiteralPath (Join-Path $nodeExpandedRoot 'LICENSE') -Destination (Join-Path $stageRoot 'runtime\LICENSE-node.txt')
Copy-Item -LiteralPath (Join-Path $nodeExpandedRoot 'README.md') -Destination (Join-Path $stageRoot 'runtime\README-node.md')

if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}
Compress-Archive -LiteralPath $stageRoot -DestinationPath $archivePath -CompressionLevel Optimal

$archive = Get-Item -LiteralPath $archivePath
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
$fileCount = (Get-ChildItem -LiteralPath $stageRoot -Recurse -File).Count

[pscustomobject]@{
  Version = "v$Version"
  NodeVersion = "v$NodeVersion"
  PackageRoot = $stageRoot
  Archive = $archive.FullName
  SizeBytes = $archive.Length
  FileCount = $fileCount
  SHA256 = $archiveHash
}
