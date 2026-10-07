param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$ImageRoot,
    [Parameter(Mandatory = $true)][string]$FontPath,
    [string]$Downloads = (Join-Path $env:USERPROFILE 'Downloads'),
    [string]$PythonPath = 'python.exe',
    [string]$TaskName = 'Momgagym Image Finalizer 0730',
    [switch]$Register
)

$ErrorActionPreference = 'Stop'
foreach ($path in @($RepoRoot, $ImageRoot, $FontPath, $Downloads)) {
    if (-not (Test-Path -LiteralPath $path)) { throw 'CONFIG_PATH' }
}
$python = Get-Command $PythonPath -ErrorAction SilentlyContinue
if (-not $python) { throw 'PYTHON_MISSING' }
$scriptPath = Join-Path $RepoRoot 'scripts\content-image\finalize_images.py'
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw 'SCRIPT_MISSING' }

# Auto mode: no job file. The script picks exactly five recent Gemini* downloads and the approved Tistory row in Notion.
$arguments = '"{0}" --downloads "{1}" --output-root "{2}" --font "{3}"' -f $scriptPath, $Downloads, $ImageRoot, $FontPath
$action = New-ScheduledTaskAction -Execute $python.Source -Argument $arguments -WorkingDirectory $RepoRoot
$trigger = New-ScheduledTaskTrigger -Daily -At '7:30AM'
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Finalize the five most recent Gemini images for the approved Tistory post. Does not publish content.'

if ($Register) {
    Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
    'REGISTERED'
} else {
    'PREVIEW_ONLY'
    'Daily at 07:30; current user session required; no task has been registered.'
    'Review paths and environment variable NOTION_CONTENT_READ_TOKEN before rerunning with -Register.'
}
