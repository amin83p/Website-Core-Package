param(
    [Parameter(Mandatory = $false)]
    [string] $SourcePath = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),

    [Parameter(Mandatory = $false)]
    [string] $TargetPath = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "Website-Core-Only"),

    [Parameter(Mandatory = $false)]
    [string] $SourceCommit = "HEAD",

    [Parameter(Mandatory = $false)]
    [switch] $Force
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-PathExisting([string] $path) {
  if ([string]::IsNullOrWhiteSpace($path)) {
    throw "Path cannot be empty."
  }

  return (Resolve-Path -Path $path -ErrorAction Stop).Path
}

function Resolve-PathWithParent([string] $path) {
  if ([string]::IsNullOrWhiteSpace($path)) {
    throw "Path cannot be empty."
  }

  if (Test-Path -LiteralPath $path) {
    return (Resolve-Path -Path $path -ErrorAction Stop).Path
  }

  $parentPath = Split-Path -Parent $path
  $fileName = Split-Path -Leaf $path
  if (-not (Test-Path -LiteralPath $parentPath)) {
    throw "Parent path does not exist: $parentPath"
  }

  return (Resolve-Path -Path $parentPath -ErrorAction Stop).Path + "\" + $fileName
}

function Clear-DirectoryWithoutGit([string] $directoryPath) {
  if (!(Test-Path -LiteralPath $directoryPath)) {
    New-Item -ItemType Directory -Path $directoryPath -Force | Out-Null
    return
  }

  Get-ChildItem -LiteralPath $directoryPath -Force -ErrorAction Stop | ForEach-Object {
    if ($_.Name -eq ".git") { return }
    Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop
  }
}

function Copy-Directory([string] $source, [string] $destination) {
  $robocopyArgs = @(
    "$source",
    "$destination",
    "/MIR",
    "/NFL",
    "/NDL",
    "/NJH",
    "/NJS",
    "/NP",
    "/R:2",
    "/W:2",
    "/XD",
    ".git"
  )

  & robocopy @robocopyArgs | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "Robocopy failed while syncing source snapshot. Exit code: $LASTEXITCODE"
  }
}

function Apply-Overlays([string] $overlayRoot, [string] $targetRoot) {
  if (!(Test-Path -LiteralPath $overlayRoot)) {
    return
  }

  Get-ChildItem -LiteralPath $overlayRoot -Recurse -File -ErrorAction Stop | ForEach-Object {
    $relative = $_.FullName.Substring($overlayRoot.Length).TrimStart('\','/')
    $destination = Join-Path $targetRoot $relative
    $destinationDir = Split-Path $destination -Parent
    if (-not (Test-Path -LiteralPath $destinationDir)) {
      New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
    }

    Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
  }
}

function Resolve-Commit([string] $sourcePath, [string] $sourceCommit) {
  $commit = (& git -C $sourcePath rev-parse --verify $sourceCommit).Trim()
  if ([string]::IsNullOrWhiteSpace($commit)) {
    throw "Unable to resolve source commit: $sourceCommit"
  }
  return $commit
}

try {
  $scriptPath = (Resolve-Path -Path $PSScriptRoot -ErrorAction Stop).Path
  $sourcePath = Resolve-PathExisting -path $SourcePath
  $targetPath = Resolve-PathWithParent -path $TargetPath
  $overlayPath = Join-Path $scriptPath "overlays"

  Write-Host "Core-only bootstrap source: $sourcePath"
  Write-Host "Core-only target: $targetPath"
  Write-Host "Source commit: $SourceCommit"

  if (-not (Test-Path -LiteralPath (Join-Path $sourcePath ".git"))) {
    throw "Source path is not a git repository: $sourcePath"
  }

  if ($targetPath.StartsWith($sourcePath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Target path must not be inside source path."
  }

  if ((Test-Path -LiteralPath $targetPath) -and (-not $Force)) {
    throw "Target already exists. Use -Force to replace its contents."
  }

  & git -C $sourcePath rev-parse --is-inside-work-tree *> $null

  $sourceCommitResolved = Resolve-Commit -sourcePath $sourcePath -sourceCommit $SourceCommit
  $tempRoot = Join-Path $sourcePath ("_core-only-bootstrap-" + [guid]::NewGuid())
  $tempPath = Join-Path $tempRoot "source-snapshot"
  $archivePath = Join-Path $tempRoot "source-snapshot.zip"
  New-Item -ItemType Directory -Path $tempPath -Force | Out-Null

  try {
    & git -C $sourcePath archive --format=zip --output $archivePath $sourceCommitResolved | Out-Null
    Expand-Archive -Path $archivePath -DestinationPath $tempPath -Force
    Clear-DirectoryWithoutGit -directoryPath $targetPath
    Copy-Directory -source $tempPath -destination $targetPath
    Apply-Overlays -overlayRoot $overlayPath -targetRoot $targetPath
  }
  finally {
    if (Test-Path -LiteralPath $tempRoot) {
      Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  Write-Host "Rebuild complete."
  Write-Host "Target path: $targetPath"
  Write-Host "Pinned source commit: $sourceCommitResolved"
  Write-Host "Overlay path: $overlayPath"
  Write-Host "Next step: run npm checks and package-manager validation from your Core-Only checkout."
}
catch {
  Write-Error $_.Exception.Message
  throw
}
