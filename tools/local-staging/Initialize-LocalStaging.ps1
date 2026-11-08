#requires -Version 7.2
[CmdletBinding()]
param([Parameter(Mandatory)][string]$LanAddress,[Parameter(Mandatory)][string]$StateDirectory)
$ErrorActionPreference='Stop'
$ip=[Net.IPAddress]::Parse($LanAddress)
$octets=$ip.GetAddressBytes()
if($ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or -not ($octets[0] -eq 10 -or ($octets[0] -eq 192 -and $octets[1] -eq 168) -or ($octets[0] -eq 172 -and $octets[1] -ge 16 -and $octets[1] -le 31))) { throw 'Use this PC private LAN IPv4 address.' }
$state=[IO.Path]::GetFullPath($StateDirectory)
if(Test-Path -LiteralPath $state){throw 'State directory already exists. Reuse it; do not overwrite identity/keys.'}
New-Item -ItemType Directory -Path $state | Out-Null
$acl=[Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true,$false)
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.SetOwner($sid)
foreach($principal in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
 $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($principal,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
}
Set-Acl -LiteralPath $state -AclObject $acl
New-Item -ItemType Directory -Path "$state/data","$state/public-ca" | Out-Null
function Protect-Text([string]$Value,[string]$Destination){
 $protected=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($Value),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 [IO.File]::WriteAllBytes($Destination,$protected)
}
$hash=[Security.Cryptography.HashAlgorithmName]::SHA256
$padding=[Security.Cryptography.RSASignaturePadding]::Pkcs1
$caKey=[Security.Cryptography.RSA]::Create(3072)
$leafKey=[Security.Cryptography.RSA]::Create(3072)
try {
 $caRequest=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=SportsRadio Temporary LAN Staging CA',$caKey,$hash,$padding)
 $caRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$false,0,$true))
 $caRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign -bor [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::CrlSign,$true))
 $caRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509SubjectKeyIdentifierExtension]::new($caRequest.PublicKey,$false))
 $from=[DateTimeOffset]::UtcNow.AddMinutes(-5)
 $ca=$caRequest.CreateSelfSigned($from,[DateTimeOffset]::UtcNow.AddDays(7))
 $leafRequest=[Security.Cryptography.X509Certificates.CertificateRequest]::new("CN=$LanAddress",$leafKey,$hash,$padding)
 $leafRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false,$false,0,$true))
 $leafRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment,$true))
 $oids=[Security.Cryptography.OidCollection]::new();$null=$oids.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
 $leafRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids,$true))
 $san=[Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new();$san.AddIpAddress($ip)
 $leafRequest.CertificateExtensions.Add($san.Build())
 $serial=[Security.Cryptography.RandomNumberGenerator]::GetBytes(16)
 $leaf=$leafRequest.Create($ca,$from,[DateTimeOffset]::UtcNow.AddDays(3),$serial)
 [IO.File]::WriteAllText("$state/public-ca/root-ca.pem",$ca.ExportCertificatePem())
 [IO.File]::WriteAllBytes("$state/public-ca/root-ca.cer",$ca.RawData)
 [IO.File]::WriteAllText("$state/server-cert.pem",$leaf.ExportCertificatePem())
 Protect-Text $leafKey.ExportPkcs8PrivateKeyPem() "$state/tls-key.dpapi"
 Protect-Text ([Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()) "$state/session-secret.dpapi"
 $fingerprint=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($ca.RawData)).ToLowerInvariant()
 $config=@{version=1;lanAddress=$LanAddress;origin="https://$LanAddress";deploymentId=('local-pairing-'+[guid]::NewGuid().ToString('N').Substring(0,12));backendPort=5051;caSha256=$fingerprint;certificateExpires=$leaf.NotAfter.ToUniversalTime().ToString('o')}
 $config | ConvertTo-Json | Set-Content -LiteralPath "$state/config.json" -Encoding utf8
 Write-Output "Created isolated local state: $state"
 Write-Output "CA SHA256 (verify on iPhone out of band): $fingerprint"
 Write-Output "Origin: https://$LanAddress ; CA expires after 7 days, server certificate after 3 days."
} finally {
 $leafKey.Dispose();$caKey.Dispose()
 if($leaf){$leaf.Dispose()};if($ca){$ca.Dispose()}
}
# No trust store or firewall changes are made. CA private key was never saved.
