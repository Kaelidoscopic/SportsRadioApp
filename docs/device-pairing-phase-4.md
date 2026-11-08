# Phase 4A–4B device identity and pairing

## Assessment and proposed architecture (before implementation)

Baseline 2aa0c6c has working TV playback capture, independent foreground service and native WebRTC. The user additionally reports verified YouTube, locked-phone listening and three concurrent listeners; these are user-reported baseline evidence, not new agent tests. Capture/service/room signaling will remain unchanged.

Existing Express backend uses node:sqlite at SPORTSYNC_DB_PATH, users with PBKDF2 passwords, bearer sessions and appliance ownership. Website already signs in and stores its bearer token locally. Existing appliance pairing is long-lived plaintext and must not be reused for TVs. Existing sessions are plaintext with no expiry and login has no limiter. This is not an adequate production foundation for newly ownership-sensitive routes without hardening and explicit durable storage configuration.

Plan: additive tv_devices, tv_pairings and api_rate_limits tables in the existing SQLite DB; owner user ID is a server-validated users foreign key, independent of rooms/appliances. New auth_sessions contains SHA-256 bearer hashes and seven-day expiry; legacy sessions are revoked on migration (users sign in again). Rate limit auth entry points; existing account identifiers and passwords remain valid. No paid service/new database dependency.

TV generates random UUID plus 256-bit credential locally, saved atomically using Android Keystore AES-GCM, backend-scoped and excluded from backup. Register sends this credential over HTTPS and backend stores only its hash; responses never return credentials. Subsequent status, heartbeat, pairing and rotation require the credential. Rotation stages a pending key in encrypted storage before the server change and resolves ambiguous outcomes on restart. Lost local credentials require explicit new identity registration; the old owned device is never taken over by ID alone.

Authenticated TV explicitly starts a five-minute 10-character cryptographic pairing code (50 bits, friendly alphabet). Only its digest is persisted; raw code is returned once to that authenticated TV for display. A logged-in account explicitly submits the code to claim it; transaction consumes code and assigns at most one owner. No public device lookup, account email disclosure, remote audio control or code in URL/logs. Expired/reused codes and invalid credentials fail. Rate limits are persisted per device/account/IP-derived digest; code requests are bounded and expired state is observable by the TV. Claim attempts use account and IP limits, not per-code counters that leak validity.

Pairing routes disabled by default. Enable only with SPORTSYNC_DEVICE_PAIRING_ENABLED=true, an explicitly configured persistent SPORTSYNC_DB_PATH on durable storage and SPORTSYNC_DEVICE_PAIRING_STORAGE_ACK=true. No production deployment/settings changes in this task. TLS terminates at the existing host; Android enforces HTTPS. In-memory DB allowed only in injected tests. A configured path cannot prove the operator mounted durable storage; acknowledgement is explicit. SQLite supports one backend instance; multi-instance deployment requires shared transactional DB first.

Website adds My Devices using existing login, validates sessions server-side, shows owned devices and heartbeat-derived online state, handles invalid/expired/rate-limited codes. Browser token storage remains a legacy XSS concern; account recovery/email verification, full abuse controls and distributed persistence remain production limitations. New features fail closed while disabled. Local integration testing must include restart persistence, authentication, expiration, single-use and ownership isolation.

## Implemented review build

Version 0.4.0 (versionCode 5). No dependencies or deployment settings added. `server/device-pairing.js` owns registration, hashed credentials/codes, persistent limiters, transactional claims, rotation, status and account lists. `server/index.js` wires existing account authentication and the new routes. Rooms/desktop signaling/Pi transport are unchanged. Frontend `MyDevices.jsx` is reachable from the landing page or `/#devices`; signed-out users use the existing login/signup flow and then return to devices. Android's new `device/` package owns encrypted identity, HTTPS API calls, heartbeat, staged rotation and a private remote-navigable pairing activity. MainActivity only adds initialization and a navigation button. CaptureService, AudioRecord, native WebRTC, navigation lifecycle and room credential storage are unchanged.

| Endpoint | Authority | Result |
| --- | --- | --- |
| POST /api/devices/register | New random credential in Authorization + random deviceId in body; an existing ID requires its existing credential | Registers installation, never overwrites existing ownership |
| POST /api/devices/:id/status | Device credential | Status/heartbeat, no code or account identity |
| POST /api/devices/:id/pairing | Device credential, unowned device only | Returns a newly generated display code once to that TV |
| POST /api/devices/:id/rotate | Current device credential + new client-generated credential | Replaces credential hash; revokes outstanding code; preserves owner |
| POST /api/devices/claim | Existing authenticated account session + displayed code | Atomic single-use ownership assignment |
| GET /api/devices | Existing authenticated account session | Only that account's devices and heartbeat-derived online status |

The only intentional pairing-secret response is the newly generated display code to its authenticated TV; display would otherwise be impossible. It is absent from list/status/claim responses and URLs. Device credentials are generated on the TV, sent only in authenticated HTTPS requests and never returned by this API. Malformed auth/device JSON receives a generic error, preventing parser errors from echoing secret snippets. No request payloads are logged.

Device UUID is an installation identifier, not hardware attestation or authority. First registration establishes a random credential; knowing the ID cannot update/recover it. Explicit new registration after key loss generates both a new ID and new credential. It does not transfer the old account's device or audio room. Rotation persists a pending credential before contacting the server, tries the pending credential after an uncertain outcome, and promotes it only after successful authentication/rotation. Storage failures never fall back to plaintext or ephemeral credentials. Keystore-backed AES-GCM uses a separate key/file in no-backup app-private storage; existing encrypted room ownership is untouched.

TV heartbeat runs every 15 seconds while the process is alive, independently of activity visibility/audio. Online means authenticated registration/status within 45 seconds; it does not mean currently broadcasting or guaranteed reachability. Without an active capture service, Android may kill a background process; no extra foreground service is started just for pairing. Codes are held only in memory on TV; after restart a waiting code cannot be recovered and the user requests another. A code request invalidates its predecessor. Paired TVs cannot request new claim codes. Transfer, unpair/removal, account recovery and remote start/stop are intentionally not implemented.

## Database and auth migration

Startup idempotently creates `tv_devices`, `tv_pairings`, `api_rate_limits` and `auth_sessions` in the existing SQLite database. No appliance ownership or room rows are repurposed. Existing account password hashes and user IDs remain valid. Old plaintext `sessions` are revoked/deleted; users must sign in again once. New sessions contain only SHA-256 token digests and a seven-day expiry. Logout has a revocation endpoint, used by the landing page; some older dashboard logout paths still only remove their local token, leaving it valid until expiry. New signup passwords require 12–256 characters; existing shorter passwords can still sign in. Auth and device responses use no-store cache headers.

Limits: auth login/signup 20 per IP/15 minutes; device registrations 30/IP/15 minutes; claims 10/account and 30/IP/15 minutes; code generation 3/device/15 minutes; rotations 5/device/hour; authenticated device endpoint traffic 120/IP/minute. Counters use persisted hashed bucket keys and expire after one day. Source IP is the actual Express peer; forwarded headers are not trusted. On a reverse proxy this may be a shared bucket, reducing availability. Review trusted-proxy configuration and edge abuse controls before production enablement; this task does not alter that configuration. Rate-limit boundaries permit normal fixed-window bursts.

**Production activation prerequisite:** a backed-up durable database path, single backend instance and authentication/security review. This is a safer account foundation, not a complete managed identity service: no email verification/recovery/MFA, legacy PBKDF2 parameters remain, browser bearer storage has the existing XSS risk, and legacy appliance plaintext pairing remains a separate security weakness. None is silently reused as TV ownership proof. An explicitly acknowledged path cannot prove durable mounting. Never enable ownership on an ephemeral host filesystem. No cloud configuration or production data was modified here.

Before updating a deployed server, stop it and back up the existing DB with restrictive access; do not copy a live transactional DB casually. Preserve the configured path on every restart. DDL is additive, but legacy bearer sessions are intentionally revoked and cannot be restored as valid new sessions. Rolling back code would require deliberate reauthentication/data review. SQLite is for a single process/host; multi-instance ownership requires a shared transactional store before enabling.

## Verification results

- Backend: **27/27** tests, including real HTTP login/device claims, unauthorized claims, malformed JSON redaction, ownership isolation, process restart persistence, hashed session storage, expiry, logout, auth rate limiting and disabled routes. Registry tests cover code expiry/reuse/supersession, credential rejection/rotation, owner preservation, durable attempt limits and online timeout. Existing browser/desktop/Pi integration passed.
- Android: **37/37** unit tests (existing 32 plus five identity/pairing cases). Coverage includes first-launch persistence, restart reuse, explicit replacement, staged rotation persistence, storage failure and pairing expiry/status handling. Actual Keystore/HTTPS rotation recovery and D-pad flow still need physical testing.
- Frontend: **8/8** tests, including input normalization and distinct success/invalid/expired/owned/login/disabled/rate-limit messages. These are logic tests, not an automated DOM/device end-to-end pass.
- Desktop: **28/28** and syntax checks. Frontend production build and lint pass with two pre-existing App.jsx hook warnings and bundle warning. App/Test Player builds and Android lint pass; debug APK signature verifies. Existing JDK/SDK lint warnings remain.
- Root `npm test` is an existing placeholder that exits 1; package-level suites above are the relevant verification. No application test failures remain.
- No physical account-pairing or new-version audio acceptance is claimed. The known-good 0.3.1 user evidence is preserved; 0.4.0 must be accepted separately. No commit or push performed.

## Exact PowerShell verification and local API exercise

Use Node with the repository's existing node:sqlite support. No new npm packages are needed.

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp'
npm --prefix server test
npm --prefix desktop test
npm --prefix desktop run check
npm --prefix client test
npm --prefix client run lint
$env:VITE_BACKEND_URL = 'http://localhost:5000'
npm --prefix client run build

# Local backend terminal: use a development-only persistent SQLite file, not a production DB.
$env:SPORTSYNC_DB_PATH = Join-Path $env:LOCALAPPDATA 'SportsRadio-Phase4\development.sqlite'
$env:SPORTSYNC_DEVICE_PAIRING_ENABLED = 'true'
$env:SPORTSYNC_DEVICE_PAIRING_STORAGE_ACK = 'true'
$env:PORT = '5000'
node server/index.js
# Second terminal, same repo: browser UI at the Vite URL printed by this command.
$env:VITE_BACKEND_URL = 'http://localhost:5000'
npm --prefix client run dev -- --host 127.0.0.1
```

To exercise pairing locally without changing the TV's production backend, simulate a new device in a third PowerShell terminal. Credentials remain in variables, not files/console output:

```powershell
$base = 'http://127.0.0.1:5000'
$deviceId = [guid]::NewGuid().ToString()
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 32
$random.GetBytes($bytes)
$random.Dispose()
$deviceKey = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$headers = @{ Authorization = "Bearer $deviceKey" }
$registered = Invoke-RestMethod "$base/api/devices/register" -Method Post -Headers $headers -ContentType 'application/json' -Body (@{deviceId=$deviceId;name='Local pairing test TV'} | ConvertTo-Json)
$pair = Invoke-RestMethod "$base/api/devices/$deviceId/pairing" -Method Post -Headers $headers -ContentType 'application/json' -Body '{}'
$pair.code # Intentionally display only the temporary code for entry on the local website.
# Website: My Devices -> sign up/log in -> enter this code. Then verify status:
$status = Invoke-RestMethod "$base/api/devices/$deviceId/status" -Method Post -Headers $headers -ContentType 'application/json' -Body '{}'
$status.status
# Stop/restart the local backend using the same path; ownership must still appear.
```

Do not paste bearer headers, device keys or DB contents into reports. Use a local test account and a strong unique test password; never re-use production credentials over localhost HTTP. Deployments require HTTPS. To test expiry, wait more than five minutes without claiming; to test reuse/other-account isolation, submit a consumed code under another signed-in test account. Repeated wrong codes must hit the rate limit. Restoring server timestamps manually is unnecessary; automated tests inject a clock.

## APK build and physical TV acceptance

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp\tv-android'
$artifacts = 'C:\Users\ninte\.codex\visualizations\2026\10\24\01a16f71-c4ce-7d01-b58b-fdc604544879'
$tools = Join-Path $artifacts 'android-tools'
$env:JAVA_HOME = 'C:\Users\ninte\Java\JDK\oracleJdk-25'
$env:ANDROID_HOME = Join-Path $tools 'sdk'
$env:GRADLE_USER_HOME = Join-Path $tools 'gradle-home'
# Existing task-local init script moves outputs out of OneDrive to avoid generated-file locks.
.\gradlew.bat -I "$artifacts\tv-diagnostics-build.gradle" :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :test-player:assembleDebug :test-player:lintDebug
if ($LASTEXITCODE -ne 0) { throw 'Android verification failed' }
$adb = Join-Path $tools 'sdk\platform-tools\adb.exe'
& $adb devices -l
$tvSerial = 'YOUR_TV_SERIAL'
& $adb -s $tvSerial install -r "$artifacts\SportsRadio-TV-Broadcaster-0.4.0-pairing-debug.apk"
if ($LASTEXITCODE -ne 0) { throw 'Install failed; do not clear app data automatically' }
& $adb -s $tvSerial shell am start -n com.sportsradio.tv.capture/com.sportsradio.tv.MainActivity
```

On another machine, install the SDK/JDK and run Gradle without the task-local init script; app output is `app/build/outputs/apk/debug/app-debug.apk`. Keep the signing key for updates. Uninstall/clear-data destroys identity/Keystore ownership material. ADB is for development installation only; after installing a released app, pairing needs only TV remote and phone browser, not a computer or ADB. Store distribution/TV installation channels are not part of this phase.

The review APK targets the existing HTTPS backend and website. They have **not been deployed or enabled**, so that build cannot complete physical account pairing against today's production services. Until an approved candidate backend/frontend is available at those URLs with durable storage/auth reviewed, expect "not enabled" or a generic unavailable response. Do not change production settings merely to make this test pass.

After approved candidate availability:

1. Open Pair TV to Account by remote. Request code; confirm Unpaired -> Waiting, readable code and fixed pairing URL. Open that URL on phone, authenticate normally, enter code; confirm Paired on TV and device in only that account's My Devices.
2. Restart app/TV without clearing data; confirm same device and Paired status. Pairing alone must not request projection consent or start broadcasting. No credentials/code should appear in SportsRadioDiag logs.
3. Rotate from TV; confirm account owner unchanged, new status succeeds and old credential is rejected (automated backend tests cover the latter without exporting TV secrets). Repeat across process interruption during rotation; it should resolve the staged key, not generate a new identity automatically.
4. Use an unpaired test identity for expiry, invalid code, reuse, rate limit and two-account contention. Never reset the real known-good TV identity casually. Explicit lost-key registration creates a new ID; the old owned entry remains offline, never transfers silently.
5. Close/kill idle TV app, wait 45+ seconds and refresh My Devices to see Offline; reopen to see Online. Online is not a remote-control promise.
6. Regression: start the eligible Test Player broadcast and hear audio on iPhone; open pairing screen, press Back/Home, return, verify room and capture continue. Check YouTube, locked-phone listening and three phones against the user-reported 0.3.1 baseline. Explicit Stop/fresh-consent Start remain unchanged.

No physical pairing, new-version audio playback, browser DOM acceptance, code expiry on real hardware, credential-loss recovery on the real TV, or rotation under actual network interruption has been performed in this implementation pass. These are review/acceptance tasks, not claimed passes.

## Review file inventory

- Backend: `server/device-pairing.js`, `server/index.js`, `server/test/device-pairing.test.js`, `server/test/device-http.test.js`.
- Website: `client/src/MyDevices.jsx`, `client/src/device-pairing.js`, `client/src/LandingPage.jsx`, `client/test/device-pairing.test.mjs`.
- Android: `app/src/main/java/com/sportsradio/tv/device/{DeviceIdentity,EncryptedIdentityStore,DevicePairingRuntime,PairDeviceActivity}.kt`, `MainActivity.kt`, `app/src/main/AndroidManifest.xml`, `app/build.gradle.kts`, `app/src/test/java/com/sportsradio/tv/device/DeviceIdentityTests.kt`, `tv-android/README.md`.
- Architecture/migration/runbook: this document. No dependency manifests or cloud deployment configurations changed. Capture, transport and existing room implementation files remain untouched.

## Staging preparation follow-up

See [isolated staging runbook](pairing-staging-runbook.md). A separate Android staging build and frontend/backend isolation guards are now available; no services have been provisioned. Use the staging runbook for current test counts, secrets/storage prerequisites and APK commands rather than the production-targeting review APK above.
