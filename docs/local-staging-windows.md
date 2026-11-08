# Windows LAN-only pairing staging

Plan: one dedicated HTTPS origin at this PC's private IPv4 address, static staging website plus API/Socket.IO reverse proxy, loopback-only backend and independent persistent SQLite file. No tunnel/cloud service, router forwarding, public exposure or production changes. This machine currently reports 10.0.0.139 (192.168.56.1 is a virtual adapter, not the TV LAN); manually verify the LAN address before another run.

Use a short-lived local CA. Embed ONLY its public certificate into the staging build's exact-IP network security configuration; production builds retain their existing trust policy. Never disable TLS/hostname verification or permit cleartext Android traffic. The iPhone requires manually installing/trusting the CA after out-of-band fingerprint verification. This is explicit local trust, not a TLS bypass. Users unable to install a CA can consider an approved HTTPS tunnel later, but it is not started here.

All state, TLS material and fresh session secret go into a new user-restricted local folder outside source/OneDrive. Store private TLS key and session secret using Windows DPAPI CurrentUser; do not persist the CA private key. Preserve staging identity metadata, HMAC sessions, application ID isolation, origin checks and all pairing rate/ownership controls. Existing database guard must reject a production/unmarked DB before migrations.

## Prepared instance (TLS rotated 2026-11-07)

Origin: `https://10.0.0.139`, backend: `127.0.0.1:5051`. The LAN IP must remain assigned to this PC. The server certificate expires 2026-11-10 18:35:02 UTC; CA expires 2026-11-14 18:35:02 UTC. Check config.json before testing. For expiry with unchanged IP, use the certificate-only rotation procedure below, preserving this existing instance; never regenerate the database/session identity or disable verification. The CA private key is destroyed after generation, so renewal requires a new CA, trust update and staging APK rebuild. An IP change requires a separately reviewed configuration/build update.

State directory (outside repository and OneDrive):
`C:\Users\ninte\.codex\visualizations\2026\10\24\01a16f71-c4ce-7d01-b58b-fdc604544879\sportsradio-local-staging`

SQLite: `data\pairing.sqlite`. It is persistent across process restarts, not a disposable test fixture. Do not copy production databases or .env files here. DPAPI files work only under the creating Windows user; do not publish them or copy the entire directory for CA transfer. Only `public-ca\root-ca.cer` is for distribution. SQLite account password hashes/device hashes still need protection; folder ACL restricts access to this user and SYSTEM, but this is not full-disk encryption or protection against malware running as this user. No production session migration can run against production through these launchers: DB path is derived from this separate folder, marked staging, and environment checks run before migrations. The backend launcher whitelists OS environment variables and skips dotenv.

CA SHA256 (DER): `f7a1614904ebbd02df7837d18a27017261ca853ccb25607660de53498820688d`

APK: `C:\Users\ninte\.codex\visualizations\2026\10\24\01a16f71-c4ce-7d01-b58b-fdc604544879\SportsRadio-TV-Broadcaster-0.4.0-local-staging-2026-11-07.apk`

APK SHA256: `b4ee22c1a16f022874199f11898096f9851a3d1038f4d04d6af296e4c4a6566f`.

## Start backend and website

### Certificate rotation verified November 7, 2026

Both original certificates expired: CA 2026-11-01 05:34:26 UTC; server 2026-10-28 05:34:26 UTC. New CA validity: **2026-11-07 18:30:02 UTC – 2026-11-14 18:35:02 UTC**. New server validity: **2026-11-07 18:30:02 UTC – 2026-11-10 18:35:02 UTC**, with typed **IP SAN 10.0.0.139** (not just CN/DNS).

`Rotate-LocalStagingTls.ps1` reuses the existing generator in a restricted temporary folder, adopts only TLS files/public certificate metadata, and destroys the unused temporary identity/secret. It retains the same deployment ID, origin, SQLite files and encrypted authentication secret. The actual database files and secret were verified byte-for-byte unchanged during rotation. No account/device credentials were regenerated. Expired seven-day sessions and five-minute pairing codes stay expired; sign in again/request a new code normally. Do not reset the TV identity just because its previous CA expired.

The encrypted old TLS key/public certificates/config are archived under the restricted instance directory at `tls-history\20261107T183501Z-9b73f0f4`. Never distribute that archive. It permits inspection/negative tests, not continued use of expired certificates. No CA private key was saved. Gateway startup now rejects expired/not-yet-valid, wrong-CA and wrong-IP certificates before opening its HTTPS listener.

Windows Current User trust (manual; not executed by the agent): use **Windows PowerShell as your ordinary Windows user**. Verify the exact DER SHA256 below before importing the public root. Do not import the leaf, private key, arbitrary similarly named certificate, or use LocalMachine scope. [Microsoft Import-Certificate documentation](https://learn.microsoft.com/en-us/powershell/module/pki/import-certificate?view=windowsserver2025-ps).

```powershell
$state='C:\Users\ninte\.codex\visualizations\2026\10\24\01a16f71-c4ce-7d01-b58b-fdc604544879\sportsradio-local-staging'
$publicRoot="$state\public-ca\root-ca.cer"
$expected='f7a1614904ebbd02df7837d18a27017261ca853ccb25607660de53498820688d'
if ((Get-FileHash -LiteralPath $publicRoot -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expected) { throw 'Root fingerprint mismatch' }
$cert=[Security.Cryptography.X509Certificates.X509Certificate2]::new($publicRoot)
if ($cert.HasPrivateKey -or $cert.NotBefore.ToUniversalTime() -gt [DateTime]::UtcNow -or $cert.NotAfter.ToUniversalTime() -le [DateTime]::UtcNow) { throw 'Root is not an eligible valid public certificate' }
Import-Certificate -FilePath $publicRoot -CertStoreLocation 'Cert:\CurrentUser\Root'
# Remove ONLY the exact old staging CA, if installed. This is its Windows SHA1 store identifier, not the new SHA256 fingerprint.
$oldRoot='Cert:\CurrentUser\Root\3E202A342175BAEA1FFBBFB390B9D7F31F434C76'
if (Test-Path -LiteralPath $oldRoot) { Remove-Item -LiteralPath $oldRoot }
$cert.Dispose()
```

Accept the Windows trust prompt only after verifying that fingerprint. Restart the browser if it retains an old TLS connection. Windows trust is not automatically inherited by Node; verification scripts explicitly supply the public CA and retain normal hostname/date checks. Remove the new root after testing by its exact certificate store thumbprint, not a broad subject-name deletion.

On iPhone, first remove the old **SportsRadio Temporary LAN Staging CA** profile (old expiry November 1) from Settings > General > VPN & Device Management > its profile > Remove Profile. Remove only the dedicated staging profile, not unrelated managed profiles. Transfer ONLY the updated `public-ca\root-ca.cer` via a trusted method and compare SHA256 against the Windows value above (same subject name, different certificate). Install the new profile, then enable full trust under Settings > General > About > Certificate Trust Settings. [Apple explains that manual installation alone does not enable SSL trust](https://support.apple.com/en-us/102390). If management policy prevents installation, stop rather than bypassing errors. Remove the new profile/full trust when finished.

Update ONLY the staging app with the dated APK using the install command below (`install -r` preserves its encrypted identity/data). No production/0.3.1 app install, uninstall or clear-data operation is needed. Open `https://10.0.0.139/api/deployment` without warnings before entering staging credentials, then visit the website and request a fresh pairing code.

For future same-IP rotation, first stop both servers, then use PowerShell 7:

```powershell
pwsh -NoProfile -File tools/local-staging/Rotate-LocalStagingTls.ps1 -Config "$state/config.json"
# Rebuild using Build-LocalStaging.ps1 below, verify APK signature and refresh BOTH phone/Windows trust.
```

Do not run Initialize into the existing instance or copy a new candidate's session secret/config identity over it. Rotation requires ports 443/5051 to be stopped, hashes persistent data before/after, archives old TLS/config, and restores old TLS/config if installation fails. A failed rollback is not a reason to start an inconsistent instance; inspect the restricted archive first.

November 7 verification: backend33/33, desktop28/28, frontend11/11; Android staging39/39 explicitly rerun; staging APK build/lint and signature passed. Frontend staging build passed; lint zero errors/two existing warnings. Certificate-only rotation/preservation/expiry/IP/fingerprint checks4/4; live HTTPS/WSS/trust/expired-server checks6/6. The archived expired server's real handshake was rejected with `CERT_HAS_EXPIRED`; untrusted secure WebSockets and incorrect HTTPS hostnames were rejected. APK bundled CA SHA256 matches the fingerprint above; package remains `com.sportsradio.tv.capture.staging`. No physical-device update, trust-store import, production contact, commit, push or deployment occurred. Test servers are stopped after verification. Physical pairing remains unverified.

Use PowerShell 7, the same Windows user, and a node:sqlite-capable Node runtime (the repository's tested installed Node). Dependencies are already installed here. On a fresh checkout run `npm ci --prefix server`, `npm ci --prefix client` first. Never load production .env into these terminals.

Terminal 1:

```powershell
Set-Location C:\Users\ninte\OneDrive\Desktop\SportsRadioApp
$state='C:\Users\ninte\.codex\visualizations\2026\10\24\01a16f71-c4ce-7d01-b58b-fdc604544879\sportsradio-local-staging'
node tools/local-staging/start.cjs backend "$state/config.json"
```

Terminal 2 (after backend reports port 5051):

```powershell
Set-Location C:\Users\ninte\OneDrive\Desktop\SportsRadioApp
$state='C:\Users\ninte\.codex\visualizations\2026\10\24\01a16f71-c4ce-7d01-b58b-fdc604544879\sportsradio-local-staging'
node tools/local-staging/start.cjs https "$state/config.json"
```

This serves the already-built staging website, not a Vite development server. API, polling and secure WebSocket upgrades share the HTTPS origin. Port 5051 is never intentionally exposed to LAN. Host header checks and fixed loopback upstream prevent use as an arbitrary proxy. HTTPS startup checks backend deployment identity and frontend build marker; website and APK independently check identity before credentials. Keep PC awake during testing. Ctrl+C stops each process; verify both have exited before restarting.

Optional local verification, while both are running:

```powershell
$env:SPORTSRADIO_LOCAL_CONFIG="$state/config.json"
node --test tools/local-staging/verify.cjs
Get-NetTCPConnection -LocalPort 5051,443 -State Listen
```

Expect 5051 on 127.0.0.1 and 443 on 10.0.0.139. Do not expose/router-forward either port to the internet. No public tunnel was created. A tunnel could provide public trust but exposes staging externally and may have changing hostnames; both URLs, origin guards and APK must then be rebuilt. It is unnecessary for this LAN test.

## Manual network and certificate setup

1. Put PC, TV and iPhone on the same trusted home LAN; avoid guest/AP client isolation, VPN routing and cellular-only access. Verify 10.0.0.139 is still the PC's physical LAN address. A router DHCP reservation helps, but none was configured here.
2. If Windows Firewall blocks access, manually approve a narrowly scoped rule in an elevated PowerShell. This changes only local firewall policy, not production. Determine the iPhone IP from Wi-Fi settings. Example (replace the phone IP; TV address must also be checked):

```powershell
New-NetFirewallRule -DisplayName 'SportsRadio local pairing HTTPS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -LocalAddress 10.0.0.139 -RemoteAddress 10.0.0.107,10.0.0.150 -Profile Private -Program (Get-Command node).Source
```

Do not change an untrusted/Public network to Private just to make this work. No firewall rules were created automatically. Port conflicts require stopping the conflicting local test service, not silently selecting an unconfigured port.
3. Transfer ONLY `public-ca\root-ca.cer` to iPhone through a trusted file-transfer method. Compare the certificate SHA256 fingerprint with the value above using an independent trusted display/tool before trusting it. Do not transfer DPAPI files, DB, private key or config folder. If your transfer method cannot deliver an installable certificate, stop and arrange a trusted certificate transfer; do not bypass Safari warnings.
4. Install the certificate profile in iOS Settings (Profile Downloaded / General > VPN & Device Management), then explicitly enable full trust under General > About > Certificate Trust Settings. Apple documents that manual profile installation alone does not enable SSL trust: [Apple certificate trust](https://support.apple.com/en-au/102390). This trusts this temporary CA on the phone for its lifetime; remove it immediately after the test. Managed phones may prohibit this and require administrator help or an approved public HTTPS staging alternative.
5. Open `https://10.0.0.139/api/deployment` in Safari. Require a valid certificate, `environment: staging`, and deploymentId equal to config.json. Do not enter account credentials until that succeeds. Then open `https://10.0.0.139`.

Android trusts ONLY the bundled public CA for the exact staging IP, using [Android network security configuration](https://developer.android.com/privacy-and-security/security-config). It does not install a global TV CA, accept arbitrary user CAs, allow cleartext, bypass hostname validation or change normal/production APK trust. No TV browser is required.

## Install and first physical pairing test

Installation currently requires ADB for this review APK; once installed pairing itself needs only the TV remote and phone. Keep the known-good installed production app/data. Never use `adb uninstall com.sportsradio.tv.capture` or clear its data.

```powershell
$art='C:\Users\ninte\.codex\visualizations\2026\10\24\01a16f71-c4ce-7d01-b58b-fdc604544879'
$adb="$art/android-tools/sdk/platform-tools/adb.exe"
& $adb connect 10.0.0.107:5555
& $adb -s 10.0.0.107:5555 install -r "$art/SportsRadio-TV-Broadcaster-0.4.0-local-staging-2026-11-07.apk"
& $adb -s 10.0.0.107:5555 shell am start -n com.sportsradio.tv.capture.staging/com.sportsradio.tv.MainActivity
```

Authorize the PC on the TV if prompted; use the TV's actual address. If ADB is unavailable, enable Developer Options by selecting Build seven times under Settings > Device Preferences > About, then enable network debugging if the TV firmware offers it, or use its supported USB ADB path. Do not open ADB to the internet. Disable debugging after testing.

1. Confirm **SportsRadio TV STAGING**, separate from SportsRadio Capture. Open its account/pairing screen using the remote. Do not start a staging broadcast or request capture consent; pairing requires neither and must not disturb an existing production capture session.
2. Wait for registration, request a new pairing code. It must display the LAN pairing URL and Waiting for Pairing. If an earlier `.invalid` review identity is rejected as backend-mismatched, explicitly choose **Register New Device Identity** in STAGING only. This does not transfer old ownership.
3. On iPhone staging website create a fresh test account with a unique password (12+ characters). Do not reuse production credentials. Open My Devices, enter the TV code, and confirm success plus TV Paired status and device online status.
4. Re-enter the claimed code from another test account: it must not claim the device or disclose ownership. Test an invalid and an expired code without repeatedly triggering limits. Code lifetime is five minutes.
5. Close/reopen the staging app: identity and owner must persist. Restart both local server processes using the same config/state; staging login and ownership must remain valid. Do not regenerate the secret or replace the DB. Observe offline status after the staging app stops sending heartbeats (45-second threshold); resume and confirm online.
6. Rotate the staging credential, restart the staging app, and confirm ownership persists. Lost-key recovery creates a NEW identity; it cannot reclaim the previous account-owned device by UUID alone.
7. Confirm known-good production room/listener still work before/after. This is a physical acceptance check to perform, not a result claimed here. No production endpoints were contacted by local verification.

## Rebuild / reproduce

Existing prepared instance: do not rerun Initialize into its folder. To create a fresh instance use a new nonexistent directory and verified private LAN address:

```powershell
pwsh -File tools/local-staging/Initialize-LocalStaging.ps1 -LanAddress 10.0.0.139 -StateDirectory 'C:\SportsRadioLocalStaging-New'
```

For this environment's existing SDK and external build directory:

```powershell
$art='C:\Users\ninte\.codex\visualizations\2026\10\24\01a16f71-c4ce-7d01-b58b-fdc604544879'
$env:JAVA_HOME='C:\Users\ninte\Java\JDK\oracleJdk-25'
$env:GRADLE_USER_HOME="$art/android-tools/gradle-home"
$env:ANDROID_HOME="$art/android-tools/sdk"
pwsh -File tools/local-staging/Build-LocalStaging.ps1 -Config "$art/sportsradio-local-staging/config.json" -GradleInitScript "$art/tv-diagnostics-build.gradle"
Copy-Item "$art/tv-030-build/app/outputs/apk/staging/app-staging.apk" "$art/SportsRadio-TV-Broadcaster-0.4.0-local-staging-2026-11-07.apk"
```

On another workstation configure its Android SDK/JDK and omit the optional init script; APK output is normally `tv-android/app/build/outputs/apk/staging/app-staging.apk`. The helper sets only public VITE configuration and matching Gradle properties; secrets are never build parameters. The public CA and origins are intentionally APK-visible. A new CA requires a rebuilt APK and phone trust update.

## Verification and rollback

This pass: backend33/33; frontend11/11; desktop28/28; Android39/39 debug and39/39 staging; debug/staging builds and lint passed; frontend staging build passed; frontend lint has zero errors/two existing App hook warnings; APK signature verified. Local live HTTPS/identity/certificate rejection/static isolation/WSS checks4/4. Existing tests cover expiration, reuse, ownership, persistent limits, rotation, restart persistence and migration isolation. Initial restricted-run Gradle/desktop process failures passed with normal local process permissions. New Gradle trust-resource wiring errors were corrected before final successful builds.

Physical LAN reachability, iPhone trust, TV HTTPS trust and end-to-end pairing have NOT been tested. No claim of physical pairing success. No cloud deployment or production configuration changes, commits or pushes. The local servers used for verification are stopped after checks.

Rollback: stop both local processes, remove the named firewall rule if you created it (`Remove-NetFirewallRule -DisplayName 'SportsRadio local pairing HTTPS'`), remove temporary CA profile/full trust from iPhone, and optionally uninstall ONLY `com.sportsradio.tv.capture.staging`. Retain the restricted state directory if restart persistence is needed; otherwise securely remove test state when no longer needed. No production rollback is needed because production was not modified. Before any production rollout: review/approve source, persistent production DB backup/migration plan, session revocation impact, TLS/origin configuration and a successful physical staging pairing/restart/rotation test. Do not push these uncommitted changes to auto-deploying main without approval.
