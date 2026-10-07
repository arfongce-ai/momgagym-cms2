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

# Claude writes this ignored local job file after downloading the five images.
$jobPath = Join-Path $RepoRoot 'content-image\jobs.local\today.json'
$arguments = '"{0}" --job "{1}" --downloads "{2}" --output-root "{3}" --font "{4}"' -f $scriptPath, $jobPath, $Downloads, $ImageRoot, $FontPath
$action = New-ScheduledTaskAction -Execute $python.Source -Argument $arguments -WorkingDirectory $RepoRoot
$trigger = New-ScheduledTaskTrigger -Daily -At '7:30AM'
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Finalize the declared five-image local blog batch. Does not publish content.'

if ($Register) {
    Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
    'REGISTERED'
} else {
    'PREVIEW_ONLY'
    'Daily at 07:30; current user session required; no task has been registered.'
    'Review paths and environment variable NOTION_CONTENT_READ_TOKEN before rerunning with -Register.'
}
