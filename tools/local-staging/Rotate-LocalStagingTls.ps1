#requires -Version 7.2
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Config)
$ErrorActionPreference='Stop'
$configPath=[IO.Path]::GetFullPath($Config)
$state=Split-Path $configPath
$c=Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
if($c.version -ne 1 -or $c.origin -ne "https://$($c.lanAddress)" -or $c.deploymentId -notmatch '^local-pairing-[a-f0-9]{12}$' -or $c.backendPort -ne 5051){throw 'Invalid local staging configuration'}
if([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object {$_.Port -in @(443,5051)}){throw 'Stop local backend and HTTPS gateway before rotating TLS'}
if(-not (Test-Path -LiteralPath "$state/session-secret.dpapi") -or -not (Test-Path -LiteralPath "$state/data")){throw 'Existing local state required'}
# Hash all persistent data and the encrypted session secret, never display their contents.
function State-Digest {
 $items=@(Get-ChildItem -LiteralPath "$state/data" -File -Recurse)
 $items+=Get-Item -LiteralPath "$state/session-secret.dpapi"
 return (($items | Sort-Object FullName | ForEach-Object { $_.FullName+':'+(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }) -join "`n")
}
$before=State-Digest
$tag=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$backup="$state/tls-history/$tag"
$candidate="$state/tls-candidate-$tag"
$tlsFiles=@('public-ca/root-ca.pem','public-ca/root-ca.cer','server-cert.pem','tls-key.dpapi')
New-Item -ItemType Directory -Path "$backup/public-ca" -Force | Out-Null
foreach($file in $tlsFiles){Copy-Item -LiteralPath "$state/$file" -Destination "$backup/$file"}
Copy-Item -LiteralPath $configPath -Destination "$backup/config.json"
$installed=$false
try {
 # Reuse the reviewed certificate generator in a NEW restricted temporary folder.
 # Its fresh DB identity/session secret are NOT adopted by the existing instance.
 & "$PSScriptRoot/Initialize-LocalStaging.ps1" -LanAddress $c.lanAddress -StateDirectory $candidate | Out-Null
 $fresh=Get-Content -Raw -LiteralPath "$candidate/config.json" | ConvertFrom-Json
 $ca=[Security.Cryptography.X509Certificates.X509Certificate2]::new("$candidate/public-ca/root-ca.cer")
 $leaf=[Security.Cryptography.X509Certificates.X509Certificate2]::new("$candidate/server-cert.pem")
 try {
  if($leaf.NotAfter.ToUniversalTime() -le [DateTime]::UtcNow -or $ca.NotAfter.ToUniversalTime() -le [DateTime]::UtcNow){throw 'New certificates are not valid'}
  # Typed SAN parsing ensures an IP entry, not merely CN or DNS text.
  $san=$leaf.Extensions | Where-Object {$_.Oid.Value -eq '2.5.29.17'}
  $typed=[Security.Cryptography.X509Certificates.X509SubjectAlternativeNameExtension]::new($san.RawData,$san.Critical)
  if($c.lanAddress -notin @($typed.EnumerateIPAddresses() | ForEach-Object ToString)){throw 'Missing IP Subject Alternative Name'}
  $c.caSha256=$fresh.caSha256
  $c.certificateExpires=$leaf.NotAfter.ToUniversalTime().ToString('o')
  $c | Add-Member -Force NoteProperty caNotBefore ($ca.NotBefore.ToUniversalTime().ToString('o'))
  $c | Add-Member -Force NoteProperty caExpires ($ca.NotAfter.ToUniversalTime().ToString('o'))
  $c | Add-Member -Force NoteProperty certificateNotBefore ($leaf.NotBefore.ToUniversalTime().ToString('o'))
  foreach($file in $tlsFiles){Copy-Item -LiteralPath "$candidate/$file" -Destination "$state/$file" -Force}
  $c | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8NoBOM
  if((State-Digest) -cne $before){throw 'Persistent data changed unexpectedly'}
  $installed=$true
  Write-Output "TLS rotated; deployment ID, database and session secret preserved byte-for-byte."
  Write-Output "Old TLS archive (restricted): $backup"
  Write-Output "Public CA SHA256: $($c.caSha256)"
  Write-Output "CA UTC: $($c.caNotBefore) through $($c.caExpires)"
  Write-Output "Server UTC: $($c.certificateNotBefore) through $($c.certificateExpires); IP SAN $($c.lanAddress)"
 } finally {$ca.Dispose();$leaf.Dispose()}
} finally {
 if(-not $installed){foreach($file in $tlsFiles){Copy-Item -LiteralPath "$backup/$file" -Destination "$state/$file" -Force};Copy-Item -LiteralPath "$backup/config.json" -Destination $configPath -Force}
 # Verify resolved recursive-delete target is the exact generated child of this state directory.
 $resolved=[IO.Path]::GetFullPath($candidate)
 if((Split-Path $resolved) -ne $state -or (Split-Path $resolved -Leaf) -notlike 'tls-candidate-*'){throw 'Unsafe temporary cleanup path'}
 if(Test-Path -LiteralPath $resolved){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
