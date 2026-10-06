param([string]$TaskPrefix = "ResearchHub-Lite-DailyBrief")
$repo = (Get-Location).Path
$morning = Join-Path $repo "node_modules\.bin\tsx.cmd"
if (-not (Test-Path -LiteralPath $morning)) { throw "Dependencies are not installed: $morning" }
foreach ($kind in @("morning", "evening")) {
  $task = "$TaskPrefix-$kind"
  $time = if ($kind -eq "morning") { "08:00" } else { "20:30" }
  $action = New-ScheduledTaskAction -Execute $morning -Argument "scripts/daily-brief-cli.ts $kind" -WorkingDirectory $repo
  $trigger = New-ScheduledTaskTrigger -Daily -At $time
  Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Description "ResearchHub $kind daily intelligence brief" -Force | Out-Null
}
Write-Output "Installed current-user daily brief tasks."
