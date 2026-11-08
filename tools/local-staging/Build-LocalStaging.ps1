#requires -Version 7.2
param([Parameter(Mandatory)][string]$Config,[string]$GradleInitScript)
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath("$PSScriptRoot/../..")
$state=Split-Path ([IO.Path]::GetFullPath($Config));$c=Get-Content -Raw $Config|ConvertFrom-Json
$env:VITE_DEPLOYMENT_ENV='staging';$env:VITE_STAGING_DEPLOYMENT_ID=$c.deploymentId
$env:VITE_BACKEND_URL=$c.origin;$env:VITE_STAGING_FRONTEND_URL=$c.origin
Push-Location "$repo/client"
try { npm run build:staging; if($LASTEXITCODE){throw 'Frontend build failed'} } finally { Pop-Location }
@{origin=$c.origin;deploymentId=$c.deploymentId}|ConvertTo-Json|Set-Content "$repo/client/dist-staging/local-deployment.json" -Encoding utf8NoBOM
$arguments=@('-p',"$repo/tv-android",":app:testStagingUnitTest",":app:assembleStaging",":app:lintStaging","-PsportsradioStagingBackend=$($c.origin)","-PsportsradioStagingFrontend=$($c.origin)","-PsportsradioStagingId=$($c.deploymentId)","-PsportsradioLocalCa=$state/public-ca/root-ca.pem","-PsportsradioLocalCaSha256=$($c.caSha256)")
if($GradleInitScript){$arguments+=@('-I',$GradleInitScript)}
& "$repo/tv-android/gradlew.bat" @arguments
if($LASTEXITCODE){throw 'Android verification/build failed'}
# Build output follows Gradle's configured build directory. Never install automatically.
