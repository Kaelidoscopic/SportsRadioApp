# SyncLink hosted staging: Phase 1–2 review

Phase3 follow-up: [deployment preparation and publication gates](hosted-staging-phase-3.md). Local branch codex/hosted-staging now exists; all candidate changes remain uncommitted. No push, provisioning or deployment has occurred.

Prepared November 7, 2026. Source/build preparation only. No infrastructure, Git publication, deployment, trust-store change, TV install or production DB operation is authorized by this pass. The installed working 0.3.1 app and rollback APK remain untouched. Physical pairing/audio acceptance for these changes is pending.

## Shared architecture and Android changes

There is one Android/React/Express codebase. Android staging is a build type with its own application ID/UID, Keystore/files, endpoints and deployment identity. CaptureService, PCM capture/bridge and native WebRTC transport are unchanged. Backend room ownership and device-account ownership remain separate secure credentials; pairing grants no remote capture permission.

Room Connect now runs its own backend identity probe on a worker and returns to the main thread before opening RoomSession/Socket.IO. Duplicate Connect requests coalesce, failed verification permits an explicit retry, and shutdown/End Room cancels late results. Pairing probes are stateless and cannot revoke a room's verification flag because no shared flag exists. Existing connected rooms are retained when reopening the app. Production builds retain the existing no-staging-probe behavior.

Fixed diagnostic messages distinguish TLS, DNS/timeouts/network, deployment configuration/HTTP response, access-policy authentication, device credential rejection, and secure saved-identity/backend mismatch. No exception messages, headers, credentials, SDP, ICE addresses or sensitive response bodies are displayed. Storage failures do not create ephemeral credentials. No certificate verifier, host verifier or account authorization has been bypassed.

The audit found the installed staging APK still trusted the expired October 25 CA, while the gateway had the November 7 CA. Both used the correct LAN origin/deployment ID. This explains a common failure before registration or signaling. The local tools remain available for fallback, but hosted builds eliminate private-CA distribution.

## One non-secret configuration

`config/staging.json` is the public source of truth: version, backendUrl, frontendUrl, deploymentId. Credentials and unknown keys are rejected. Hosted origins must be dedicated HTTPS DNS origins; production hosts, LAN IPs, paths and userinfo are rejected. The committed-candidate file deliberately uses `.invalid` placeholders. Review builds are possible, but the hosted backend and readiness command refuse placeholders before DB access. Do not mistake a successful review build for a provisioned deployment.

Consumers:

- Android Gradle reads the central file by default; hosted builds reject URL/ID overrides and local CA properties. Hosted network security permits only system trust, disallows cleartext, and removes stale generated local CA resources. The local build wrapper still supplies its explicit LAN values/CA; it does not modify the hosted config.
- `tools/hosted-staging/manage.cjs frontend` supplies only public VITE values from the file, rejecting conflicting inherited VITE values. Existing frontend identity verification, exact-origin checks and staging browser storage prefixes remain in use.
- `server/start-hosted-staging.js` reads the same file, forces staging, rejects contradictory environment settings, skips production dotenv, and validates explicit secret/storage configuration before any DB open/migration. Storage markers and cross-environment refusal remain unchanged. Optional `SPORTSYNC_PUBLIC_STAGING_CONFIG` is an absolute operator-selected alternative public file; normally leave it unset.

Keep deploymentId stable after initializing a staging DB. It is not a password; changing it correctly prevents opening that DB. Keep secrets exclusively in the new backend's private environment settings and device credentials in its separate app storage. Never copy production .env, DB, device files, sessions, secret groups, PI_HOST_TOKEN or admin credentials.

## Local build and readiness commands

```powershell
Set-Location C:\Users\ninte\OneDrive\Desktop\SportsRadioApp
node tools/hosted-staging/manage.cjs check
# EXPECTED to fail while config/staging.json has .invalid URLs. Do not bypass this gate.

$art='C:\Users\ninte\.codex\visualizations\2026\10\24\01a16f71-c4ce-7d01-b58b-fdc604544879'
$env:JAVA_HOME='C:\Users\ninte\Java\JDK\oracleJdk-25'
$env:GRADLE_USER_HOME="$art/android-tools/gradle-home"
$env:ANDROID_HOME="$art/android-tools/sdk"
pwsh -NoProfile -File tools/hosted-staging/Build-HostedStaging.ps1 -GradleInitScript "$art/tv-diagnostics-build.gradle"
```

This builds the website, Android staging unit tests/APK/lint only; no command deploys or installs. On another PC configure its SDK/JDK and omit the external Gradle init script. Standard APK output: `tv-android/app/build/outputs/apk/staging/app-staging.apk`; this PC's external output: `$art/tv-030-build/app/outputs/apk/staging/app-staging.apk`.

Review APK will be copied outside the repository as `SportsRadio-TV-Broadcaster-0.4.0-hosted-staging-review.apk`. It uses system trust and non-routable placeholders, so it is NOT a physical-test APK. After actual domains are assigned, update central configuration and rebuild/signature-check before installation. Preserve the same debug signing key for staging updates; do not uninstall or clear the production app.

Frontend-only build: `npm --prefix client run build:hosted-staging`. Backend start after ready configuration/storage: `npm --prefix server run start:hosted-staging`. Never use these to target production. No dependency additions are required.

## Provisioning checklist — requires separate approval

1. Approve the hosting budget and source-publication method. Publish only a reviewed staging branch/candidate, never main. Verify existing production Git hooks cannot deploy the candidate; a non-main push can still create previews on an existing Vercel project. No branch, commit or push was created here.
2. Create a NEW Render web service and NEW dedicated persistent disk. Do not duplicate/import production secrets or attach its disk. Keep auto-deploy disabled until the candidate, URLs and environment are reviewed. Use one instance. Root directory for this NEW backend is repository root (leave Root Directory empty), since it needs `config/` and `tools/`. Do not change the production service's `server` root.
3. Backend build: `npm ci --prefix server`; start: `node server/start-hosted-staging.js`. Select a supported patched Node runtime with `node:sqlite`, verify against that runtime before launch; local tests currently use Node22.16.0. Mount a dedicated disk at `/var/data`. A successful existing-directory check is not proof that the provider mount is durable.
4. Create a NEW Vercel frontend project, root `client`, with **Include source files outside of the Root Directory in the Build Step** enabled because the public config/build helper live in sibling directories. Install: `npm ci`; build: `npm run build:hosted-staging`; output: `dist-staging`. Existing `client/vercel.json` SPA rewrites apply. The new project's platform Production environment is still SyncLink STAGING. Do not promote/alias it onto the real production project. A free Render Static Site is an alternative, root repository, build `npm ci --prefix client && npm --prefix client run build:hosted-staging`, publish `client/dist-staging`, SPA rewrite `/*` to `/index.html`.
5. Record the two providers' stable assigned HTTPS origins in `config/staging.json`, preserving the chosen deploymentId. Domain assignments are manual and have not happened. Rebuild frontend/APK from the same reviewed file. Run `manage.cjs check`; it must succeed. No custom domain purchase is required.
6. Set the private backend variables below, verify they belong to the NEW service, then explicitly deploy after approval. Do not set frontend URLs independently in Vercel; the build derives them from the file. Remove any inherited/conflicting VITE settings. Android must reach the public API without an interactive provider-SSO challenge; account/device endpoints still enforce application authentication. Never embed a deployment-protection bypass secret in the APK.
7. Verify `/api/deployment` reports staging and the exact configured ID over valid public HTTPS before account/device traffic. Check website Origin/CORS and Socket.IO/WSS, then verify actual database persistence by restart/redeploy on the mounted disk. Do not deploy again during an audio endurance test: active rooms are currently in memory.

| New backend variable | Value |
| --- | --- |
| SPORTSYNC_ENVIRONMENT | staging |
| SPORTSYNC_DURABLE_STORAGE_ROOT | /var/data |
| SPORTSYNC_DB_PATH | /var/data/synclink-staging.sqlite (new, never a production copy) |
| SPORTSYNC_DEVICE_PAIRING_ENABLED | true |
| SPORTSYNC_DEVICE_PAIRING_STORAGE_ACK | true only after verifying dedicated persistent mount |
| SPORTSYNC_SESSION_SECRET | fresh random32-byte secret encoded as64 lowercase hex; private, stable across restarts |
| SPORTSYNC_BIND_HOST | 0.0.0.0 (cloud only; local fallback remains127.0.0.1) |
| PORT | provider supplied |

Deployment ID and allowed frontend origin derive from the central file. If SPORTSYNC_DEPLOYMENT_ID or SPORTSYNC_STAGING_FRONTEND_URL are independently set, mismatches fail startup. The session secret must be freshly generated for hosted staging, not copied from production or this PC's local instance. Never make it VITE-prefixed or enter it in Git/Gradle arguments/logs.

Frontend public variables are derived as VITE_DEPLOYMENT_ENV=staging, VITE_STAGING_DEPLOYMENT_ID=deploymentId, VITE_BACKEND_URL=backendUrl, VITE_STAGING_FRONTEND_URL=frontendUrl. Android uses corresponding BuildConfig fields. These contain no credentials.

## First physical hosted test

After domain configuration, rebuild and verify APK signature; install ONLY `com.sportsradio.tv.capture.staging` using `adb install -r`, retaining 0.3.1. No private root certificate should be required on either device. Because the backend origin changes from LAN to hosted, existing staging identity is intentionally rejected with a clear message: explicitly choose Register New Device Identity in STAGING only. It creates a new identity for the separate database; it does not transfer old ownership. Keep the local DB/credentials privately archived rather than silently migrating or overwriting them.

1. TV: open staging app. Connect must verify independently without first opening Pair TV. Create a room; confirm code. Room hosting does not require account pairing.
2. Phone: open the new staging website and sign into a fresh staging account with a unique password. TV: request a fresh code. Phone: My Devices, claim code. Confirm Paired and online. Invalid/expired/reused code and another account must not obtain ownership.
3. TV: Start Broadcasting and grant normal fresh Android consent. Play eligible controlled audio. Phone: join code/QR, start playback, verify audible audio. No synthetic-only acceptance.
4. Check Home/Back/background continuity, locked phone, three listeners, video changes and30-minute endurance. These are user-reported 0.3.1 acceptance baselines, NOT passes claimed for this build.
5. Restart app/backend, verify account/device persistence, room recovery/recreation as appropriate and credential rotation. Stop remains explicit; network/projection interruption must release media safely. Confirm production behavior separately without using staging credentials there.

## Costs, rollback and production blockers

Recommended budget: Render0.5c-512mb compute about$7/month plus1GB disk about$0.25/month; total about$7.25/month before taxes/overages. Separate eligible Vercel static project may add$0 within account allowances; Hobby permits only personal/non-commercial use. Render static frontend is another$0 baseline option. Existing team/workspace usage quotas can be shared; verify them before enabling builds. Render Free cannot preserve SQLite on a disk; do not relax storage guards to make it run. Railway Hobby is an alternative at$5 minimum, higher if usage exceeds credits, but is not needed for this code preparation.

Sources checked November7: [Render pricing](https://render.com/pricing), [disk persistence](https://render.com/docs/disks), [Render free limits](https://render.com/docs/free), [Vercel monorepos](https://vercel.com/docs/monorepos), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Railway pricing](https://docs.railway.com/pricing). Actual account billing/entitlements remain operator verification.

Rollback for staging: stop/roll back only the NEW service/frontend to the last reviewed staging candidate; preserve its DB and secret, and back it up using SQLite-aware methods before migrations. Reinstall only a compatible previous staging APK if needed, without clearing data or changing signing key. Production rollback APK remains `SportsRadio-TV-Broadcaster-0.3.1-debug.apk` outside the repo. No production rollback is necessary for this preparation because no production resource was changed.

**Not production-ready:** the pending backend still revokes legacy plaintext sessions at startup. These phases do not change that migration or execute it against production. A separately approved compatibility migration/session-preservation design and rollback test are required before any production update. Also review provider-specific trusted proxy handling for IP rate limits (never blindly trust arbitrary forwarded headers), account recovery/email verification, and existing legacy appliance weaknesses. No remote broadcast control is added. SQLite/current room state assume one backend instance; STUN-only WebRTC is not guaranteed across every network. Physical hosted pairing/audio remains unverified.

## Review inventory and verification

Android changes: ConnectionVerification.kt, DeploymentGuard.kt, BroadcastRuntime.kt (connection coordination only), device/DeviceIdentity.kt, device/DevicePairingRuntime.kt, ConnectionVerificationTests.kt, DeviceIdentityTests.kt and app/build.gradle.kts. Capture, foreground-service and native media implementation files are unchanged.

Hosted preparation: config/staging.json; tools/hosted-staging/config.cjs, manage.cjs, Build-HostedStaging.ps1; server/start-hosted-staging.js, package.json and test/hosted-staging.test.js; client/package.json and test/hosted-staging.test.mjs. Documentation links updated; existing local tools/config/state remain intact.

Verified results: backend37/37 (including four new hosted configuration/launcher cases), frontend12/12, desktop28/28, Android46/46 debug and46/46 staging. New Android tests cover asynchronous ordering, duplicate requests, identity failure/retry, cancellation/stale completions, pairing-probe independence, error redaction/classification and saved-backend identity preservation. Both Android lint variants passed; staging APK and frontend build passed. Frontend lint has zero errors/two pre-existing App hook warnings. Existing Gradle/JDK/SDK warnings remain nonblocking.

Local fallback scoped-IP trust generation was tested, then switched back to hosted: the old generated CA resource was removed, hosted XML uses system trust only, and the signed hosted APK contains neither the LAN CA nor known production/LAN endpoint strings. APK signature verified. Review APK SHA256: `b0344a871d70e2a9209bfa922a89b312cad5996c1e17c8f87a13d75b96bf94b7`. Local and hosted builds share ignored output directories; rebuild the selected mode before running its frontend/gateway. Neither local state nor the existing dated LAN APK was replaced.

Readiness is conditional: source prepared, but .invalid origins deliberately prevent actual deployment until assigned URLs, durable storage, fresh secret, review/publication and separate deployment approval are in place. The expected readiness-check refusal is not a test failure. No hosted physical acceptance, production runtime operation or service provisioning occurred.
