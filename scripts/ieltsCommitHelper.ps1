param(
  [switch]$GeneratePrompt,
  [string]$PromptOutPath = "data/ielts/research/last_commit_prompt.md",
  [string]$TemplatePath = "data/ielts/research/commit_message_prompt_template.md",
  [string]$LogPath = "data/ielts/research/commit_message_history.md",
  [string]$ModelResponsePath,
  [string]$ResearchContext = "",
  [switch]$CopyPrompt,
  [switch]$NoCopyCommit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ensure-ParentDir {
  param([string]$PathValue)
  $parent = Split-Path -Path $PathValue -Parent
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
}

function Run-GitText {
  param([string[]]$GitArgs)
  $nativePrefAvailable = $false
  $nativePrefOriginal = $false
  if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue) {
    $nativePrefAvailable = $true
    $nativePrefOriginal = $global:PSNativeCommandUseErrorActionPreference
    $global:PSNativeCommandUseErrorActionPreference = $false
  }
  try {
    $out = (& git -c core.safecrlf=false -c core.autocrlf=false --no-pager @GitArgs 2>$null | Out-String).Trim()
    return $out
  } catch {
    return ""
  } finally {
    if ($nativePrefAvailable) {
      $global:PSNativeCommandUseErrorActionPreference = $nativePrefOriginal
    }
  }
}

function To-Array {
  param($Value)
  if ($null -eq $Value) { return @() }
  if ($Value -is [System.Array]) { return $Value }
  return @([string]$Value)
}

function Build-PromptText {
  param(
    [string]$TemplateContent,
    [string]$ResearchContextText
  )

  $utcNow = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
  $head = Run-GitText -GitArgs @("rev-parse", "--short", "HEAD")
  if ([string]::IsNullOrWhiteSpace($head)) { $head = "UNKNOWN" }
  $branch = Run-GitText -GitArgs @("branch", "--show-current")
  if ([string]::IsNullOrWhiteSpace($branch)) { $branch = "UNKNOWN" }

  $statusShort = Run-GitText -GitArgs @("status", "--short")
  if ([string]::IsNullOrWhiteSpace($statusShort)) { $statusShort = "(clean or unavailable)" }

  $nameStatus = Run-GitText -GitArgs @("diff", "--name-status")
  if ([string]::IsNullOrWhiteSpace($nameStatus)) { $nameStatus = "(no unstaged file changes)" }

  $nameStatusStaged = Run-GitText -GitArgs @("diff", "--staged", "--name-status")
  if ([string]::IsNullOrWhiteSpace($nameStatusStaged)) { $nameStatusStaged = "(no staged file changes)" }

  $diffStat = Run-GitText -GitArgs @("diff", "--stat")
  if ([string]::IsNullOrWhiteSpace($diffStat)) { $diffStat = "(no unstaged diff stat)" }

  $diffStatStaged = Run-GitText -GitArgs @("diff", "--staged", "--stat")
  if ([string]::IsNullOrWhiteSpace($diffStatStaged)) { $diffStatStaged = "(no staged diff stat)" }

  $contextBlock = @"
## Runtime Context
- UTC now: $utcNow
- Git branch: $branch
- Git HEAD: $head

## Research Context
$ResearchContextText

## Git Status (short)
$statusShort

## Changed Files (unstaged, name-status)
$nameStatus

## Changed Files (staged, name-status)
$nameStatusStaged

## Diff Stat (unstaged)
$diffStat

## Diff Stat (staged)
$diffStatStaged
"@

  return ($TemplateContent.TrimEnd() + "`n`n" + $contextBlock.TrimEnd() + "`n")
}

function Parse-ModelResponse {
  param([string]$RawJson)
  $obj = $RawJson | ConvertFrom-Json

  if ([string]::IsNullOrWhiteSpace([string]$obj.commit_subject)) {
    throw "Model output missing required field: commit_subject"
  }
  if ([string]::IsNullOrWhiteSpace([string]$obj.short_summary)) {
    throw "Model output missing required field: short_summary"
  }
  if ([string]::IsNullOrWhiteSpace([string]$obj.reason_for_change)) {
    throw "Model output missing required field: reason_for_change"
  }

  return $obj
}

function Build-CommitMessage {
  param($Obj)
  $subject = [string]$Obj.commit_subject
  $body = [string]$Obj.commit_body
  if ([string]::IsNullOrWhiteSpace($body)) {
    return $subject.Trim()
  }
  return ($subject.Trim() + "`n`n" + $body.Trim())
}

function Append-LogEntry {
  param(
    [string]$LogFilePath,
    $Obj,
    [string]$CommitMessageText
  )

  Ensure-ParentDir -PathValue $LogFilePath
  if (-not (Test-Path $LogFilePath)) {
    Set-Content -Path $LogFilePath -Value "# IELTS Commit Message History`n" -Encoding UTF8
  }

  $utcNow = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
  $head = Run-GitText -GitArgs @("rev-parse", "--short", "HEAD")
  if ([string]::IsNullOrWhiteSpace($head)) { $head = "UNKNOWN" }
  $branch = Run-GitText -GitArgs @("branch", "--show-current")
  if ([string]::IsNullOrWhiteSpace($branch)) { $branch = "UNKNOWN" }

  $tweakId = [string]$Obj.tweak_id
  if ([string]::IsNullOrWhiteSpace($tweakId)) { $tweakId = "TWEAK-UNSPECIFIED" }

  $files = To-Array -Value $Obj.files_changed
  $validations = To-Array -Value $Obj.validation_done
  $filesList = @($files)
  $validationList = @($validations)

  $filesLines = if ($filesList.Count -gt 0) {
    ($filesList | ForEach-Object { "- $_" }) -join "`n"
  } else {
    "- (not specified)"
  }

  $validationLines = if ($validationList.Count -gt 0) {
    ($validationList | ForEach-Object { "- $_" }) -join "`n"
  } else {
    "- (not specified)"
  }

  $entry = @"

## $utcNow | $tweakId
- Branch: $branch
- HEAD: $head
- Type: $([string]$Obj.commit_type)
- Scope: $([string]$Obj.scope)
- Summary: $([string]$Obj.short_summary)
- Reason: $([string]$Obj.reason_for_change)
- Dissertation Impact: $([string]$Obj.dissertation_impact)

### Files
$filesLines

### Validation
$validationLines

### Commit Message
~~~text
$CommitMessageText
~~~
"@

  Add-Content -Path $LogFilePath -Value $entry -Encoding UTF8
}

if ($GeneratePrompt) {
  if (-not (Test-Path $TemplatePath)) {
    throw "Template file not found: $TemplatePath"
  }

  $template = Get-Content -Path $TemplatePath -Raw
  $research = if ([string]::IsNullOrWhiteSpace($ResearchContext)) {
    "(Provide your run-specific context, e.g., what issue you were trying to fix.)"
  } else {
    $ResearchContext
  }

  $promptText = Build-PromptText -TemplateContent $template -ResearchContextText $research
  Ensure-ParentDir -PathValue $PromptOutPath
  Set-Content -Path $PromptOutPath -Value $promptText -Encoding UTF8

  if ($CopyPrompt) {
    Set-Clipboard -Value $promptText
  }

  Write-Output "Prompt generated: $PromptOutPath"
  if ($CopyPrompt) { Write-Output "Prompt copied to clipboard." }
  exit 0
}

if (-not [string]::IsNullOrWhiteSpace($ModelResponsePath)) {
  if (-not (Test-Path $ModelResponsePath)) {
    throw "Model response file not found: $ModelResponsePath"
  }

  $raw = Get-Content -Path $ModelResponsePath -Raw
  $obj = Parse-ModelResponse -RawJson $raw
  $commitMessage = Build-CommitMessage -Obj $obj
  Append-LogEntry -LogFilePath $LogPath -Obj $obj -CommitMessageText $commitMessage

  if (-not $NoCopyCommit) {
    Set-Clipboard -Value $commitMessage
  }

  Write-Output "Log updated: $LogPath"
  if (-not $NoCopyCommit) { Write-Output "Commit message copied to clipboard." }
  Write-Output ""
  Write-Output "Commit message:"
  Write-Output $commitMessage
  exit 0
}

Write-Output "Usage:"
Write-Output "1) Generate prompt file from current git context:"
Write-Output "   .\scripts\ieltsCommitHelper.ps1 -GeneratePrompt -CopyPrompt"
Write-Output ""
Write-Output "2) After model returns JSON, ingest it and append to log + copy commit message:"
Write-Output "   .\scripts\ieltsCommitHelper.ps1 -ModelResponsePath path\to\model_output.json"
Write-Output ""
Write-Output "3) Ingest without clipboard:"
Write-Output "   .\scripts\ieltsCommitHelper.ps1 -ModelResponsePath path\to\model_output.json -NoCopyCommit"
