#requires -Version 7.2
param([string]$Config="$PSScriptRoot/../../config/staging.json",[string]$GradleInitScript)
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath("$PSScriptRoot/../..")
$Config=[IO.Path]::GetFullPath($Config)
# Review builds can use .invalid placeholders; manage.cjs check is the separate deployment readiness gate.
node "$PSScriptRoot/manage.cjs" frontend $Config
if($LASTEXITCODE){throw 'Hosted frontend build failed'}
$arguments=@('-p',"$repo/tv-android",':app:testStagingUnitTest',':app:assembleStaging',':app:lintStaging',"-PsportsradioStagingConfig=$Config",'-PsportsradioHostedStaging=true')
if($GradleInitScript){$arguments+=@('-I',$GradleInitScript)}
& "$repo/tv-android/gradlew.bat" @arguments
if($LASTEXITCODE){throw 'Hosted Android verification/build failed'}
