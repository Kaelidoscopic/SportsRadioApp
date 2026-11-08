# Phase 4A–4B isolated staging runbook

Current hosted workflow: [Phase 1–2 hosted preparation](hosted-staging-transition.md). It centralizes public configuration and removes private-CA requirements for hosted builds. Existing local instructions remain an optional fallback; do not use production services to test pairing.

For a no-cloud first physical test, use [Windows LAN-only staging](local-staging-windows.md). Its configured APK and HTTPS website supersede the unconfigured `.invalid` review APK for that test. The cloud instructions below remain an alternative requiring separate approval.

Status: source-only preparation, not deployed, committed or pushed. No Render/Vercel services, domains, storage mounts or production data were changed. The supplied staging APK uses reserved `.invalid` URLs and is deliberately nonfunctional until rebuilt with real staging origins. It cannot fall back to production.

## Existing deployment evidence and safest architecture

Repository `Kaelidoscopic/SportsRadioApp`, main. Prior user-confirmed Render production root is `server`, production URL `https://sportsradioapp.onrender.com`; no render.yaml/blueprint exists in the checkout. Client has Vite scripts, public build URL variables and `client/vercel.json` SPA rewrites. Production website is `https://sports-radio-app.vercel.app`; no local .vercel/project.json link exists. These are repository/user-provided facts, not a live cloud dashboard audit. Existing ignored .env files were not copied or used for staging.

Use one NEW Render web service with one NEW dedicated persistent disk and one NEW Vercel project, a dedicated reviewed staging branch/candidate, distinct HTTPS hostnames, fresh test accounts and fresh secrets. Do not attach the existing production service/disk/domain or import production environment groups. No extra DB platform is needed: the existing SQLite implementation is appropriate for one staging instance. Do not use a preview of the production project with inherited variables for this test.

Render filesystems are ephemeral unless backed by a persistent disk; persistent disks require a paid service. Free Render services cannot provide durable SQLite. See [Render disks](https://render.com/docs/disks) and [free-service limits](https://render.com/docs/free). This cost/service creation needs approval; none was provisioned. A local persistent folder can exercise tests, but does not establish cloud durability. Existing-folder checks and an operator acknowledgement cannot prove a mount survives redeploy; dashboard mount verification plus an actual restart/redeploy test are mandatory.

[Vercel environment scopes](https://vercel.com/docs/environment-variables) allow separate configuration. Use the new staging project's stable hostname; arbitrary preview hostnames are intentionally rejected by exact-origin validation. The new project's platform “Production” scope is still SportsRadio staging; never apply these values to the actual production project. Keep deployment protection as required and grant testers access; do not embed bypass tokens in the APK.

## Isolation implemented

- Backend staging configuration runs before writable SQLite opens or any auth migration. Requires explicit absolute DB path under an existing acknowledged storage root. Rejects symlink escape, in-memory DB, missing secret/ID/origin and known production frontend origins.
- New empty staging databases receive deployment_identity metadata. Every later startup requires the same environment/deployment ID. Nonempty unmarked or foreign databases are refused read-only before migration; a test launches the actual server against a production-like sentinel DB and verifies its bytes/session row remain unchanged. Production-mode code also refuses a marked staging DB. Do not stamp/copy/adopt production DBs manually.
- The dedicated `node start-staging.js` / `npm run start:staging` entry point forces staging mode, rejects an explicitly different mode, and fails if required storage/secret settings are absent. Staging skips dotenv loading entirely. It never automatically imports the existing server/.env. Start with a fresh environment rather than copying existing Render secrets. Explicitly selected staging services cannot change production sessions unless an operator bypasses the safeguards or mounts production data improperly; those actions are prohibited.
- Production sessions currently use opaque random tokens with stored SHA-256 digests, not a shared signing secret. Staging additionally uses a fresh secret and deployment-scoped HMAC digest. Tests prove the same token yields different hashes in production/another stage/another secret. Keep the staging secret stable across restarts; changing it invalidates staging sessions only. Devices/codes remain independent random credentials in separate DBs.
- Staging CORS and Socket.IO browser origins accept only the configured staging frontend; native clients without Origin still require their normal credentials. `/api/deployment` returns only public environment/deployment ID. Website and Android probe it without credentials and refuse a mismatched server before account/device credentials or room sockets.
- Frontend `--mode staging` rejects missing/insecure/known production URLs, uses dist-staging and namespaced browser auth/listener keys. App (which opens a socket at module evaluation) is dynamically imported only after staging identity validation. No production-token key is read by staging account code. Normal production mode retains its original storage keys/endpoints.
- Android staging build type uses `com.sportsradio.tv.capture.staging`, label **SportsRadio TV STAGING**, version 0.4.0-staging, staging-only BuildConfig URLs/ID. Same namespace classes but separate Android UID, app files, preferences and Keystore identity/room secrets. No copying production identity. The existing 0.3.1 installed app is untouched. Pairing does not start MediaProjection or capture.

## Manual Render configuration — only after approval

1. Review this candidate and approve a staging-only commit/branch and deployment separately. No commit/push/deploy has occurred. Do not push the candidate to main: production is configured to auto-deploy main. A future approved branch such as `codex/pairing-staging` can feed the new services only.
2. Create a new service (not a duplicate inheriting production secrets), root `server`, install `npm ci`, start `node start-staging.js`, Node runtime matching the tested node:sqlite-capable runtime, one instance. Disable automatic deploys until the staging source/variables are reviewed.
3. Attach a NEW paid persistent disk at `/var/data`. Confirm the mount belongs to this new service and is not source checkout storage. Existing production disk/data must not be attached or copied. Do not enable pairing on a Free/ephemeral service.
4. Set only the variables below. The actual backend HTTPS URL is assigned by Render; record it for the website/APK builds. The frontend URL must be the stable NEW Vercel project hostname.

| Backend variable | Staging value |
| --- | --- |
| SPORTSYNC_ENVIRONMENT | staging (must be a process/platform variable before startup) |
| SPORTSYNC_DEPLOYMENT_ID | pairing-stage-review, or another unique 8–64 lowercase alphanumeric/hyphen ID, same in all three components |
| SPORTSYNC_STAGING_FRONTEND_URL | exact new HTTPS frontend origin, no path/query/fragment |
| SPORTSYNC_DURABLE_STORAGE_ROOT | /var/data (actual dedicated disk mount) |
| SPORTSYNC_DB_PATH | /var/data/pairing-stage.sqlite (new file, never production DB/copy) |
| SPORTSYNC_DEVICE_PAIRING_ENABLED | true |
| SPORTSYNC_DEVICE_PAIRING_STORAGE_ACK | true, ONLY after verifying the disk |
| SPORTSYNC_SESSION_SECRET | fresh random 32-byte secret encoded as 64 lowercase hex characters; never VITE-prefixed |
| PORT | Render-provided value; do not override unnecessarily |

Do not copy PI_HOST_TOKEN, admin PINs, OpenAI keys, .env files or production user/ownership/session records. This phase needs none of those production secrets. API auth/device credentials are separately generated at runtime. Server checks cannot prove an operator generated a fresh secret or that a provider mount is durable; manually verify both.

Generate a secret locally without writing it to a file or command history as a literal:

```powershell
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$secretBytes = New-Object byte[] 32
$random.GetBytes($secretBytes)
$random.Dispose()
$stagingSecret = -join ($secretBytes | ForEach-Object { $_.ToString('x2') })
# Enter this value privately into the NEW service's secret setting; do not commit/log it.
```

## Manual Vercel configuration — only after approval

Create a separate project rooted at `client`, using the approved staging source. Build `npm run build:staging`, output directory `dist-staging`; retain the SPA rewrite from client/vercel.json. Configure the values below only in this project. Do not promote this build to the existing production project.

| Frontend variable | Value |
| --- | --- |
| VITE_DEPLOYMENT_ENV | staging |
| VITE_STAGING_DEPLOYMENT_ID | same staging deployment ID as backend/APK |
| VITE_BACKEND_URL | exact new Render HTTPS backend origin |
| VITE_STAGING_FRONTEND_URL | exact stable new Vercel HTTPS origin |

These are public build values; never put SPORTSYNC_SESSION_SECRET/device credentials in VITE variables. After real URLs are known, update BOTH projects' staging values before testing. The frontend refuses a different origin (including unexpected preview aliases), wrong backend identity, production hosts or redirects. Standard browser API traffic and Socket.IO then use only VITE_BACKEND_URL. Production `client/vercel.json` and the existing projects' settings are unchanged.

## Staging APK and exact build/install commands

Prepared artifact: `SportsRadio-TV-Broadcaster-0.4.0-staging-unconfigured.apk` under the task artifact folder below. Defaults: `https://sportsradio-staging.invalid`, `https://sportsradio-web-staging.invalid`, ID `pairing-stage-review`. It is installable for UI/isolation inspection, not a working hosted staging deployment. No production URLs may appear in packaged DEX. After real origins are approved, rebuild rather than installing the earlier production-targeting 0.4.0 pairing APK.

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp\tv-android'
$artifacts = 'C:\Users\ninte\.codex\visualizations\2026\10\24\01a16f71-c4ce-7d01-b58b-fdc604544879'
$tools = Join-Path $artifacts 'android-tools'
$env:JAVA_HOME = 'C:\Users\ninte\Java\JDK\oracleJdk-25'
$env:ANDROID_HOME = Join-Path $tools 'sdk'
$env:GRADLE_USER_HOME = Join-Path $tools 'gradle-home'
$stageBackend = 'https://ACTUAL-NEW-STAGING-BACKEND.example'
$stageFrontend = 'https://ACTUAL-NEW-STAGING-FRONTEND.example'
$stageId = 'pairing-stage-review'
.\gradlew.bat -I "$artifacts\tv-diagnostics-build.gradle" :app:testDebugUnitTest :app:testStagingUnitTest :app:assembleStaging :app:lintStaging "-PsportsradioStagingBackend=$stageBackend" "-PsportsradioStagingFrontend=$stageFrontend" "-PsportsradioStagingId=$stageId"
if ($LASTEXITCODE -ne 0) { throw 'Staging verification failed' }
$apk = Join-Path $artifacts 'tv-030-build\app\outputs\apk\staging\app-staging.apk'
& "$tools\sdk\build-tools\36.0.0\apksigner.bat" verify $apk
if ($LASTEXITCODE -ne 0) { throw 'APK signature failed' }
$adb = Join-Path $tools 'sdk\platform-tools\adb.exe'
& $adb devices -l
$tvSerial = 'YOUR_AUTHORIZED_TV_SERIAL'
& $adb -s $tvSerial install -r $apk
if ($LASTEXITCODE -ne 0) { throw 'Staging install failed' }
& $adb -s $tvSerial shell am start -n com.sportsradio.tv.capture.staging/com.sportsradio.tv.MainActivity
```

The task-local init script places outputs outside OneDrive. On another machine omit `-I ...`; app output is app/build/outputs/apk/staging/app-staging.apk. Build properties are public HTTPS origins, not secrets. Do not change BuildConfig defaults to production to make staging work. Never uninstall/clear the production package. If you previously installed the `.invalid` staging APK, its identity is backend-scoped: after changing endpoints, use the STAGING app's explicit Register New Device Identity action once. Do not copy production key material. On later staging restarts with the same endpoint, preserve identity.

Frontend local build using the SAME real values:

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp\client'
$env:VITE_DEPLOYMENT_ENV = 'staging'
$env:VITE_STAGING_DEPLOYMENT_ID = $stageId
$env:VITE_BACKEND_URL = $stageBackend
$env:VITE_STAGING_FRONTEND_URL = $stageFrontend
npm test
npm run lint
npm run build:staging
```

## Physical pairing and persistence acceptance

1. Confirm approved fresh staging services, actual Render disk mount, backups and matching public IDs. GET `$stageBackend/api/deployment` must identify staging; inspect without sending account/device credentials. Verify production URLs/settings remain unchanged.
2. Install ONLY `.staging`; confirm STAGING label and version. Keep production 0.3.1 installed. No physical installation/testing was performed in this preparation pass.
3. Open Pair TV to Account by remote. Wait for backend verification, request code, and read the staging website URL (never the production website). Create a NEW test account on that site; never use production passwords. Submit code and observe Paired and the TV in My Devices.
4. Sign in as a second test account: no device listed; submitting the consumed code fails. For expiry/invalid-code/rate-limit checks, use a separate unpaired staging identity; do not reset a known-good identity casually. Five-minute expiry and single-use must be enforced by server.
5. Restart staging TV app and NEW Render service using its normal restart control. Reuse stable secret and mount/path; verify same device, owner and seven-day session remain. Perform one staging service redeploy too: inspect mounted file/marker and ownership afterwards. If data disappears, STOP: storage durability failed; do not enable production pairing.
6. Rotate credential from TV; owner unchanged. Interrupt/restart staging app around a rotation and verify staged-key recovery. After idle process termination, wait 45 seconds to observe Offline, then reopen and observe Online.
7. Pairing itself must not request projection or start audio. Verify production phone audio continues while merely opening staging pairing. For staging audio regression, explicitly end any production projection first: Android can revoke a previous projection when a new one starts. Then use staging room/listener only, eligible Test Player, Home/Back/Apps, explicit Stop and fresh-consent Start. Never present a staging room as a production room.
8. Check phone-locked listening, multiple listeners and YouTube against the user-reported baseline separately. No new physical acceptance is claimed. Logs must omit codes, credentials, SDP and addresses. Do not export Keystore/private files or DB contents.

## Rollback and production prerequisites

Staging rollback: stop/disable only the NEW staging services; revoke tester access as appropriate, retain restricted staging DB backup for investigation, and remove only the `.staging` app if desired. Never restore a staging DB into production or change production domains. Secret rotation invalidates only staging sessions; device credential rotation is separate. Retain deployment ID/secret when rolling back a compatible staging build. A failed migration should be recovered from a stopped staging DB backup with the same marker, never by bypassing the environment guard. Existing production audio and 0.3.1 remain the fallback; no production rollback is necessary because nothing was changed there.

Before any production deployment: approve source/commit/deploy separately; review remaining auth risks (localStorage bearer tokens, legacy password work factor, account recovery/email verification, shared-proxy rate limits, legacy appliance pairing); verify real durable production storage and backups; run physical staging acceptance, restart/redeploy persistence and credential rotation tests; design/review production migration and rollback with a maintenance plan. The auth migration revokes old plaintext sessions and is not reversible merely by restoring code. Never test it on production DB copies attached to a running service. Do not promote the staging APK, HMAC secret, DB, browser build or deployment marker to production. Build production explicitly with production settings only after review; its original installed package remains distinct.

## Remaining blockers

No approved candidate branch/commit or cloud deployment; no confirmed paid durable staging disk; no actual staging URLs; no staging secret provisioned; no physical TV/web pairing test; no provider restart/redeploy persistence test; no new-version audio acceptance. The current APK and web build intentionally target reserved invalid origins. This is safe test preparation, not an already running staging environment.

## Additional configuration inventory

`tv-android/tools/receiver-smoke.cjs` remains a production-specific development harness with a hard-coded production signaling URL. Do not use it for staging; the procedure above uses the staging website. Desktop broadcaster/Pi production URLs and existing example files are unchanged. New example files are server/.env.staging.example and client/.env.staging.example; they are templates, never loaded as credentials. Deployment configs on the providers were not inspected live or modified.

## Verification completed for this preparation pass

- Backend **33/33**: existing pairing/auth expiry/restart/rotation/ownership tests now run as an actual isolated staging HTTP server with a stable test HMAC secret; added DB marker, cross-environment credential/session isolation and actual startup rejection tests. A sentinel production-like DB remains byte-for-byte unchanged when staging startup is refused.
- Frontend **11/11**: normal listener/pairing regressions plus staging URL validation, credential-free identity probe rejection and distinct storage keys. Lint passes with the two existing App.jsx hook warnings. Both normal production-mode build and explicit staging-mode build pass; staging build does not embed production backend/website URLs.
- Android **39/39 debug** and **39/39 staging**: existing 37 plus server identity rejection and staging package/URL isolation checks. Both APK builds and lint pass; staging APK signature verified. AGP 9 only enabled default tested build type unit tests initially; the Gradle property now enables unit tasks for both variants. Initial build/lint wiring issues were corrected; no remaining test failures.
- Desktop **28/28** plus syntax checks passed. Existing Android/JDK warnings remain. No new dependencies were introduced.
- Packaged staging APK: applicationId `com.sportsradio.tv.capture.staging`, label SportsRadio TV STAGING, versionCode 5 / 0.4.0-staging. DEX scan confirms both reserved staging hosts present and both known production hostnames absent. It was NOT installed on the TV or used against a cloud service.
- New staging output is ignored by Git and ESLint. No generated artifacts or live credentials are staged; no commit/push/deploy performed. No live Render/Vercel durability or physical acceptance was verified.

Files for staging isolation: server/deployment-config.js, server/start-staging.js, server/index.js, server/package.json, server/.env.staging.example, server/test/deployment-config.test.js and device-http.test.js; client/src/staging-config.js, auth-storage.js, main.jsx, App.jsx and account components, client/vite.config.js, package.json, eslint.config.js, .env.staging.example and staging-config.test.mjs; Android BuildConfig/staging build type, DeploymentGuard, runtime URL references, manifest label and StagingIsolationTests; root .gitignore and this runbook. The earlier uncommitted Phase 4 implementation remains in place for joint review.
