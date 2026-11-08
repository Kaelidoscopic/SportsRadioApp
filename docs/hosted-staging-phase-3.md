# SyncLink Phase 3: hosted staging deployment preparation

Prepared November 7, 2026. Option A is selected: separate Render backend/disk and Vercel frontend. This is a local preparation record, not a deployment authorization. No remote push, commit, paid provisioning, cloud setting change, application install or legacy-session deletion migration was performed in this pass. No production DB was accessed. No hosted URLs or secrets have been assigned.

## Git preservation and publication gate

- Created local branch `codex/hosted-staging` from the current working state. Branch creation preserved the entire pre-existing modified/untracked file status; no stash, reset, clean or checkout of unrelated content was used.
- Local main and the new branch both currently point at `2aa0c6c56fa7512530086b659030ee5874051f70`. All 0.4.0 code remains in the working tree, uncommitted. A branch ref does not itself snapshot uncommitted files; review/audited commit is still required before publication. Do not switch to main and accidentally commit this candidate there.
- The known-good commit remains reachable through main. Its rollback APK remains outside the repository. Origin remains `https://github.com/Kaelidoscopic/SportsRadioApp.git`; it was not changed. The new branch has no upstream. Cached origin/main is not proof of current remote state; fetch/check divergence before any later approved publication.
- User-confirmed existing production Render service tracks main, root server. No render.yaml, repository Git deployment workflow or root Vercel config is tracked in the inspected checkout. The existing client/vercel.json contains SPA rewrites, not branch restrictions.
- Live Vercel production project settings could not be read: the connected scope returned403. Its actual Production Branch, branch domains, custom environments, preview hooks and deploy hooks remain unverified. No Render management connector is available to verify its live settings. Source inspection cannot prove absence of external webhooks/automation.
- **Push is NOT cleared.** Before any publication, verify existing Render Settings > Build & Deploy branch/auto-deploy settings and Vercel Project Settings > Environments > Production > Branch Tracking. Confirm this staging branch is not tracked by any production service/environment/domain or external action/hook. Vercel can build every branch as a preview; previews can inherit production-facing variables even without replacing the production domain. Do not test a candidate using an existing production project's preview environment.
- Do not modify production settings to clear this gate without a separate instruction. Obtain read-only dashboard evidence or authorized project metadata. If a safe publication path cannot be confirmed, stop and report. No force push or merge to main is part of this plan.

See [Vercel Git deployment behavior](https://vercel.com/docs/git). Branch names alone do not establish infrastructure isolation.

## Staging public configuration

The unchanged config/staging.json still uses reserved `.invalid` URLs. This is intentional: assigned public HTTPS origins are not known and must not be guessed or substituted with production/LAN endpoints. Deployment ID: `synclink-hosted-staging` (keep stable once its DB is initialized).

The backend launcher and readiness check reject unconfigured URLs before DB access; Android review builds can use placeholders but cannot perform a live test. All three components must use the same reviewed public configuration. Do not put secrets in this file. Run after actual URL assignment:

```powershell
node tools/hosted-staging/manage.cjs check
```

Android hosted builds use the separate `com.sportsradio.tv.capture.staging` package, system certificate trust and HTTPS-only origins. Private CA overrides are refused in hosted mode. The frontend constructs account/Socket.IO connections only after an exact-origin and backend environment/deployment ID check. Its browser auth keys are prefixed with staging plus deploymentId; production keys remain unchanged. Device credentials are backend-bound and stored under the staging app UID/Keystore. No new remote broadcast controls are introduced.

## Exact NEW Render service settings

These are proposed values for a NEW service only; do not edit or duplicate production configuration/secrets. The actual service name/region/runtime patch and assigned URL still need confirmation during separately approved provisioning.

| Setting | Proposed value |
| --- | --- |
| Service type | Public Web Service |
| Preferred name | synclink-staging-api, subject to availability |
| Repository | Kaelidoscopic/SportsRadioApp |
| Branch | codex/hosted-staging, only after publication gate is cleared and publication approved |
| Runtime | Node; choose/pin a reviewed patched22.x release with node:sqlite support; local verification used22.16.0 |
| Root Directory | Empty (repository root), NOT server; shared config/tools are required |
| Build command | npm ci --prefix server |
| Start command | node server/start-hosted-staging.js |
| Pre-deploy command | None; do not add a migration command |
| Compute | 0.5c-512mb, formerly Starter; paid disk-capable tier |
| Running instances | Exactly1; autoscaling disabled |
| Auto-deploy | Off initially; later enable only for this NEW staging service after review |
| Region | Choose one region close to testers; confirm in provisioning review |
| Disk | NEW dedicated1GB persistent disk; mount /var/data |
| SQLite file | /var/data/synclink-staging.sqlite |
| Health Check Path | /api/deployment (GET, expected200) |
| Public TLS | Provider-managed certificate at the actual assigned HTTPS origin |
| Listener | 0.0.0.0 on provider-supplied PORT |
| WebSocket | Socket.IO /socket.io/ on the same listener; clients use HTTPS/WSS, not a separate port |

GET /api/deployment is public and credential-free. Render checks its HTTP status; an operator must separately verify JSON environment=staging and deploymentId=synclink-hosted-staging before sending credentials. The route is installed after DB environment checks/opening; it is a liveness/identity endpoint, not proof that a real persistent disk survives redeploy or is writable indefinitely. Do not use an authenticated or rate-limited endpoint as the health check.

Render terminates public TLS and forwards internal HTTP. The existing http.createServer/app/Socket.IO listener is compatible with that model. The application does not derive credential endpoints/redirects or secure cookies from req.protocol, so internal HTTP is not grounds for disabling client TLS verification. Use the HTTPS base URL directly to avoid HTTP-to-HTTPS WebSocket redirect failures. Native clients may omit Origin but still require their normal credential authorization; browser signaling uses the exact configured frontend origin.

**Client-IP proxy caveat:** Express currently does not trust forwarded headers. Rate limits use the actual TCP peer address; behind Render, multiple clients may share a proxy bucket. This is conservative against spoofed headers but can cause false429s. No blanket trust proxy=true, guessed hop count, forged-header exception or unimplemented environment variable is recommended. Verify Render's actual ingress/header chain before a separately reviewed client-IP trust policy or larger multi-client test. HTTPS/WSS transport compatibility is established from code/provider documentation; production-like client-IP attribution is NOT established. Do not promise per-client limits until it is tested.

References: [Render port binding/TLS termination](https://render.com/docs/web-services), [managed TLS](https://render.com/docs/tls), [WebSockets](https://render.com/docs/websocket), [health checks](https://render.com/docs/health-checks), [Express proxy trust](https://expressjs.com/en/guide/behind-proxies/).

### Render environment variables and secrets

| Variable | New staging value | Secret? |
| --- | --- | --- |
| SPORTSYNC_ENVIRONMENT | staging | No |
| SPORTSYNC_DURABLE_STORAGE_ROOT | /var/data | No |
| SPORTSYNC_DB_PATH | /var/data/synclink-staging.sqlite | No |
| SPORTSYNC_DEVICE_PAIRING_ENABLED | true | No |
| SPORTSYNC_DEVICE_PAIRING_STORAGE_ACK | true ONLY after verifying the new persistent mount | No |
| SPORTSYNC_SESSION_SECRET | Fresh random32-byte value encoded as64 lowercase hexadecimal characters; stable across restarts | **YES** |
| SPORTSYNC_BIND_HOST | 0.0.0.0 | No |
| PORT | Render supplied; do not override normally | No |
| NODE_VERSION | Exact reviewed patched22.x release, chosen and regression-tested before first deployment; do not inherit a different provider default | No |

SPORTSYNC_DEPLOYMENT_ID and SPORTSYNC_STAGING_FRONTEND_URL derive from config/staging.json; leave independent overrides unset. If set, they must match or startup fails. Leave SPORTSYNC_PUBLIC_STAGING_CONFIG unset to use the repository file. No backend public-URL env variable is necessary. Do not load a local .env: staging startup deliberately skips it.

Generate the session secret privately after provisioning approval; do not paste it into chat, commit it, put it in CLI/Gradle arguments, or give it a VITE_ prefix. No new secret was generated by Phase3. Never import production environment groups, database copies, passwords, API keys or device credentials. The new empty DB gets a deployment marker. Existing nonempty unmarked/foreign databases are refused before migrations. SQLite device/account/pairing data is persistent; active rooms remain in process memory. A service restart may require room recreation and fresh capture consent.

## Exact NEW Vercel project settings

| Setting | Proposed value |
| --- | --- |
| Project | NEW synclink-staging-web, subject to availability; never reuse sports-radio-app |
| Repository/branch | Same reviewed repository candidate; NEW project's Production Branch codex/hosted-staging |
| Framework Preset | Vite |
| Root Directory | client |
| Include source files outside Root Directory in Build Step | Enabled; needed for ../config and ../tools |
| Install Command | npm ci |
| Build Command | npm run build:hosted-staging |
| Output Directory | dist-staging |
| Node runtime | Choose supported22.x matching the reviewed toolchain |
| SPA routes | Existing client/vercel.json rewrites /(.*) to /index.html |
| Canonical domain | Actual stable NEW project HTTPS .vercel.app origin, recorded in central config; no production aliases |
| Environment imports | None; do not copy the existing project's environments |
| Automatic deployment | No creation/import/deployment in this phase. After approval, use only the reviewed staging branch; verify imports do not first deploy main |
| Secrets | None required by this static frontend |

The new project's platform label Production refers only to the new SyncLink STAGING website. It does not authorize promoting a candidate onto the existing production project. Stable canonical hostname matters: random preview URLs will fail the application's exact-origin check unless separately reviewed/configured. The phone must be able to access the canonical staging site; if provider deployment protection applies, arrange normal tester access. Android's public API identity probe cannot complete interactive provider SSO; do not embed bypass tokens in the APK or disable application authentication.

The hosted build derives the following **public** values; do not set them independently unless exactly matching central configuration:

| Build variable | Derived from |
| --- | --- |
| VITE_DEPLOYMENT_ENV | staging |
| VITE_STAGING_DEPLOYMENT_ID | deploymentId |
| VITE_BACKEND_URL | backendUrl (used for API and Socket.IO/WSS) |
| VITE_STAGING_FRONTEND_URL | frontendUrl |

Frontend WSS connects directly to the separate Render backend, not through a Vercel rewrite. No Vercel database, session secret or additional WebSocket service is needed. Root Directory source access is documented in [Vercel monorepo FAQ](https://vercel.com/docs/monorepos/monorepo-faq). Vercel branch/environment behavior is documented in [Git deployments](https://vercel.com/docs/git).

## Blockers and first-deployment checklist

1. **Stop before publication:** obtain read-only evidence of existing production Render/Vercel branch tracking, production aliases/custom environments, preview behavior, deploy hooks and external automation. Push safety remains unconfirmed after403. Do not alter production settings under this approval.
2. Review all uncommitted0.4.0 files, tests, docs, dependency manifests and secret/artifact exclusions. Approve and create a candidate commit on the local staging branch; do not merge main. Current branch HEAD is still the baseline, so pushing it now would not publish0.4.0.
3. After the publication gate and separate approval, fetch/compare remote state and publish only the reviewed staging branch with a normal explicit push. Never force push. No push command was run or authorized for execution here.
4. Obtain separate approval for paid provisioning and deployment. Confirm actual provider prices, billing scope/quotas and eligible Vercel plan. The cost approval selects an architecture; this phase expressly does not create services. Budget about$7.25/month for Render compute plus1GB disk, excluding taxes/overages, subject to current dashboard pricing. Vercel can be$0 incremental within eligible plan limits; Hobby is personal/non-commercial only.
5. During approved provisioning, create/prepare only new service/project resources with the settings above. Render Create Web Service and Vercel Import can launch an initial deployment immediately: do not click through until deployment is approved, the candidate reference is selected, and staging-only disk/secrets/settings are correct. No claim is made that resources can be reserved deployment-free through every provider UI.
6. Record the actually assigned public HTTPS origins in central config; do not guess .onrender.com/.vercel.app names. Keep .invalid placeholders until URLs are known. Resolve service/project URL bootstrap order explicitly; an initial placeholder backend must fail before DB access, not fall back to production. Re-review/commit config changes on staging, with all publication/deployment gates still in force.
7. Choose a supported patched Node22.x release and rerun relevant regressions under it. Run the readiness check and build frontend/Android from the same config. If the new service's runtime differs from local22.16.0, previous local results do not establish runtime compatibility automatically.
8. Verify dedicated mount ownership, path and size, configure a fresh secret privately and one instance. Explicitly deploy the new backend/frontend candidate only after approval. Confirm health/identity over valid HTTPS, exact frontend Origin/CORS, polling upgrade and secure WebSockets. A failed identity probe must precede account/device secrets.
9. Restart/redeploy the NEW backend and verify test accounts/ownership persist on its disk with the same secret. Never satisfy this test using a production DB/copy. Pause scheduled/automatic staging deploys during capture endurance tests.
10. Rebuild and signature-check the configured staging APK. Android installation is a later physical-test step and was NOT performed here. Only after its approval, update the separate staging package, explicitly register its new backend-bound identity and test pairing, eligible audio, background/locked-phone listening and multiple listeners. Do not clear/uninstall the working app or transfer credentials silently.

**Production release remains prohibited:** the candidate still contains the legacy-session revocation migration. It was not changed or executed in Phase3. A separate reviewed session-preservation migration/rollback design is required before any production update. These settings do not authorize any production deployment.

## Phase3 verification record

- Branch creation preserved modified/untracked status and left main/HEAD at the known-good commit. No upstream, commit, push, tag, merge or deployment was created.
- Hosted public-config/refusal tests3/3; DB deployment-isolation tests6/6; frontend tests12/12. Selected startup-refusal tests fail before migration; application-starting migration tests were deliberately not run under this phase's prohibition. The readiness CLI returns the expected nonzero refusal for reserved placeholder URLs, not an application regression.
- Prior Phase1–2 results remain backend37/37, frontend12/12, desktop28/28 and Android46/46 in each build variant; those complete suites/builds were not rerun as a claim of Phase3 deployment acceptance.
- Public configuration, launchers, Gradle hosted trust, frontend endpoint/storage guards and Socket.IO wiring inspected. No server/Android implementation was changed in Phase3. No production service was contacted for runtime testing; the only cloud configuration attempt was read-only Vercel metadata, denied403.
- Outstanding live verification: real provider branch settings, actual HTTPS origins/runtime, disk persistence, proxy client-IP attribution, cloud WSS and physical pairing/audio. No hosted infrastructure exists from this work.
