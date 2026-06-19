param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("working", "pending_approval", "done", "idle")]
  [string]$Status,

  [string]$Message = ""
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$statusPath = Join-Path $projectDir "codex-status.json"

$payload = [ordered]@{
  status = $Status
  message = $Message
  updatedAt = (Get-Date).ToString("o")
}

$payload |
  ConvertTo-Json |
  Set-Content -LiteralPath $statusPath -Encoding UTF8

Write-Output $statusPath
