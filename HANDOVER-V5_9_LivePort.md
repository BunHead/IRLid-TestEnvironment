# HANDOVER — `v5.9` Org Dashboard Live Port (Path A — minimum viable)

**Drafted:** Sunday 10 May 2026 morning watch, by Number One.
**Target agent:** Mr. Data (Codex). Phased — see "Shape" below.
**Repo scope:** BOTH `BunHead/IRLid-TestEnvironment` (source) and `BunHead/IRLid` (live, the irlid.co.uk repo) — and Cloudflare Workers + D1 provisioning.
**Priority:** Captain's deadline — Wednesday 13 May 2026 close-of-play. Three phases, each shippable + reversible.

---

## Context (read this first)

The Org dashboard (`OrgCheckin.html` + `js/orgapi.js` + the `irlid-api-test` Worker) is currently `v5.7.1v` on the test environment at `bunhead.github.io/IRLid-TestEnvironment`. It has been hardware-verified end-to-end across all of: v5 hardware-backed signing, v5.5.12 offline write queue, v5.5.13 cached snapshot recognition, v5.7.1m image customization, v5.5.8 website theme extraction.

**The live repo (`BunHead/IRLid`, served at irlid.co.uk via the CNAME) currently has NO Org dashboard surface.** Live is the consumer side: marketing pages, login/account, verify, receipt, scan. The live Worker (`irlid-api`) handles auth + receipts + verify only.

The "live port" is therefore **first-time deployment of the Org dashboard surface to production**, not a version bump. Captain's framing on 10 May: he wants venue staff to be able to use the dashboard against irlid.co.uk by Wednesday afternoon.

**Scope: Path A — minimum viable port.** Drop the test-env dashboard onto live as-is, against fresh production-grade infrastructure. Skip schema unification. Skip v6 features (drone delivery zone gating, GPS-nearest-staff map widget, recognition-mode settings, event-receipts-on-receipts-page). Leave **design-forward placeholders** in code comments at the points where v6 features will hook in. Pin the live D1 schema as the v6 migration baseline.

This brief deliberately defers all v6 work to a separate `HANDOVER-V6Promotion.md` (not yet drafted). The goal is to get a working dashboard live this week, then design v6 against the live shape.

---

## Architecture decision — separate live Worker

The live consumer Worker (`irlid-api`) handles auth, receipts, verify. It is ~1500 lines, wired to `irlid-db`, scoped to CORS origin `https://irlid.co.uk`. It is *production*. We do not touch it.

The Org dashboard backend is its own Worker (`irlid-api-test` on test env, ~3000+ lines) wired to `irlid-db-test`. The clean live promotion is to **stand up a parallel live Worker `irlid-api-org`**, a near-clone of the test env Worker, wired to a NEW production D1 `irlid-db-org`.

**Why separate (not merged into the consumer Worker):**

1. Independent deployment cycles — fixing an Org bug never risks the consumer auth flow.
2. Separation of concerns — consumer auth and dashboard backend evolve independently.
3. CORS clarity — both happen to allow `irlid.co.uk`, but the surface areas are entirely disjoint.
4. Lower risk for Wednesday — no merging of two ~3k-line Worker source files in 3 days.
5. Reversible — if anything goes wrong, the live consumer Worker is untouched.

Captain can consolidate later (`v6` cleanup) if operational simplicity becomes valuable.

---

## Three phases

Each phase is one PR. They land sequentially. Phase boundaries are deliberate hard-stops so Captain can verify before proceeding.

| Phase | What | Where | Size |
|---|---|---|---|
| 1 | Provision live Org Worker + D1 + schema | `IRLid` repo: new `irlid-api-org/` directory | M |
| 2 | Copy dashboard files into live repo + update API base | `IRLid` repo: top-level + `js/` | M |
| 3 | First-org bootstrap + smoke checklist | `IRLid` repo: `seed/` + this doc | S |

---

## Phase 1 — Worker + D1 provisioning

### Files to create in `IRLid` repo

Create a new top-level directory `irlid-api-org/` mirroring `IRLid-TestEnvironment/irlid-api/`'s structure:

```
irlid-api-org/
  wrangler.toml
  src/
    index.js         (copied verbatim from IRLid-TestEnvironment/irlid-api/src/index.js)
  package.json       (if present in test env, copy)
  schema.sql         (extracted DDL — see below)
```

#### `irlid-api-org/wrangler.toml`

```toml
name = "irlid-api-org"
main = "src/index.js"
compatibility_date = "2025-12-01"
compatibility_flags = ["nodejs_compat"]

[vars]
CORS_ORIGIN = "https://irlid.co.uk"

[[d1_databases]]
binding = "DB"
database_name = "irlid-db-org"
database_id = "<TO BE FILLED IN AFTER wrangler d1 create>"
```

#### `irlid-api-org/src/index.js`

Copy verbatim from `IRLid-TestEnvironment/irlid-api/src/index.js`. **No code changes in this phase** — the source is identical to test env. Differences live in wrangler.toml only. Future fixes can be ported test→live as targeted PRs.

#### Schema extraction

The test env D1 (`irlid-db-test`) has accumulated its current schema through ~30 migrations across the v5.5/v5.7 series. Production-grade schema setup means extracting the *current* shape as a single canonical DDL file rather than replaying migrations.

Steps for Mr. Data:

1. Run `wrangler d1 execute irlid-db-test --command=".schema" --remote` (or local — doesn't matter, schema is the same). Capture the full DDL output.
2. Save the captured DDL to `IRLid/irlid-api-org/schema.sql`.
3. Strip any DEV-only fixture inserts (look for inserts of orgs with name LIKE 'Test%' or with `is_dev = 1`).
4. Add a header comment: `-- IRLid Org dashboard schema, snapshot from irlid-db-test on <date>. v6 migrations begin from this baseline.`

### Captain operations (Mr. Data documents these in the PR description; Captain runs them)

```powershell
# 1. Create the production D1
cd "D:\SkyDrive\Pen Drive\WEBSITES\IRLid-repo\irlid-api-org"
wrangler d1 create irlid-db-org
# Note the database_id from the output. Paste into wrangler.toml [[d1_databases]].database_id.

# 2. Apply the schema
wrangler d1 execute irlid-db-org --file=./schema.sql --remote

# 3. Deploy the Worker
wrangler deploy

# 4. Note the deployed URL (will be https://irlid-api-org.<account>.workers.dev)
```

### Phase 1 acceptance

- [ ] `wrangler d1 list` shows `irlid-db-org` created.
- [ ] `wrangler d1 execute irlid-db-org --command="SELECT name FROM sqlite_master WHERE type='table';" --remote` returns the same table list as `irlid-db-test`.
- [ ] `wrangler deploy` from `irlid-api-org/` succeeds, returns a `*.workers.dev` URL.
- [ ] `curl https://irlid-api-org.<account>.workers.dev/` returns the Worker's health response (whatever shape — usually 404 on root or a JSON ok).
- [ ] No changes to `IRLid/irlid-api/` (the consumer Worker). `git diff main -- irlid-api/` is empty.

### Phase 1 PR shape

- **Branch:** `codex/v5.9-1-live-org-worker`
- **PR title:** `[codex] [M] v5.9-phase1 — provision irlid-api-org Worker + irlid-db-org D1`
- **Files added:** `irlid-api-org/wrangler.toml`, `irlid-api-org/src/index.js`, `irlid-api-org/schema.sql`, `irlid-api-org/package.json` (if applicable).

---

## Phase 2 — Dashboard files into live repo

### Files to copy from `IRLid-TestEnvironment` into `IRLid`

This list was reconned by Number One on Sunday 10 May 2026 — `<script src>`, `<link rel>`, and SW `SHELL_ASSETS` references in `OrgCheckin.html` and `sw.js` were enumerated against the existing live repo to identify collisions and gaps.

**HTML files (three, not one):**

- `OrgCheckin.html` → `IRLid/OrgCheckin.html` (the dashboard itself)
- `org-entry.html` → `IRLid/org-entry.html` (the public-facing gateway / orange QR / attendee scan-in page; loaded as part of the dashboard surface and pre-cached by the SW)
- `org.html` → `IRLid/org.html` (a 1-line meta-refresh redirect stub to `OrgCheckin.html` — preserves any old bookmark links; nice-to-have, not required)

**JS files into `IRLid/js/`:**

- `js/orgapi.js` — NEW to live. **MODIFY during copy:** line 3 `DEFAULT_BASE_URL` must point to the Phase 1 deployed Worker URL (the `*.workers.dev` URL captured by Captain after `wrangler deploy`).
- `js/offline-queue.js` — NEW to live. Verbatim copy.
- `js/offline-snapshot.js` — NEW to live. Verbatim copy.
- `js/qr-fullscreen.js` — NEW to live. Verbatim copy.

**JS vendor files into `IRLid/js/vendor/`:**

- `js/vendor/jsqr.min.js` — NEW to live. Verbatim copy.
- `js/vendor/jsqr.LICENSE.txt` — NEW to live. Required for license compliance (BSD).

**Top-level PWA assets:**

- `manifest.json` → `IRLid/manifest.json` — NEW to live. Verbatim copy. (Live currently has no PWA manifest.)
- `sw.js` → `IRLid/sw.js` — NEW to live. **MODIFY during copy:** see "Service worker scope" below for required path-filter changes; also update `WORKER_API_ORIGIN` constant (line 39) to the Phase 1 deployed Worker URL.

**DO NOT copy these (collisions / already present):**

- `js/sign.js` — Live's existing `IRLid/js/sign.js` is at "Deploy 78 — location hotspot clustering + novelty scoring for diversity"; test env's is at "Deploy 76 — compact payloads for smaller QR codes". Live is **newer**. Keep live's version. The dashboard should work fine against the newer signing module (functions are additive). If anything regresses, raise — that suggests test env's older code depends on a removed function.
- `favicon.ico` — Already exists in live root. Don't overwrite.

### Service worker scope — critical adjustment for shared origin

`IRLid-TestEnvironment` lives at a dedicated origin (`bunhead.github.io/IRLid-TestEnvironment/`), so the test env SW controlling all same-origin requests is harmless — every page on that origin IS dashboard-related.

**Live is different.** `irlid.co.uk` already serves consumer pages (`index.html`, `scan.html`, `receipt.html`, `verify-visual.html`, etc.) that are NOT part of the dashboard surface. If the test env `sw.js` is dropped at the root of `IRLid/` unchanged, its fetch handler will:

1. Apply network-first-with-shell-fallback to ALL same-origin HTML navigation. So an offline user visiting `irlid.co.uk/scan.html` would be served the cached `OrgCheckin.html` — wrong page entirely.
2. Apply cache-first to ALL same-origin static assets. Consumer JS / CSS would be cached and served stale.
3. Pre-cache the dashboard shell on first visit to ANY page (~couple of hundred KB of cache budget for users who'll never use the dashboard).

**Required modification to `sw.js`:** add an early-return path filter at the top of the fetch handler so the SW only intercepts dashboard-surface URLs. Insert immediately after the URL parse, before the "Worker API" check:

```js
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // v5.9 — Live deployment shares origin with consumer pages (index.html,
  // scan.html, receipt.html, etc.). The SW must only intercept dashboard-
  // surface URLs; everything else passes through to the network normally.
  // This is a no-op on test env (every URL there matches), but on live it
  // prevents the SW from catching consumer page navigations.
  const DASHBOARD_PATHS = /^\/(OrgCheckin\.html|org-entry\.html|org\.html|js\/(orgapi|offline-queue|offline-snapshot|qr-fullscreen|sign|vendor\/jsqr\.min)\.js|manifest\.json|sw\.js)/;
  if (url.origin === self.location.origin && !DASHBOARD_PATHS.test(url.pathname)) {
    return; // pass through; no caching, no shell fallback
  }

  // ... existing logic from line ~75 onward ...
});
```

The rest of the SW logic (worker API origin bypass, network-first for HTML, cache-first for assets, vendor CDN caching) is unchanged.

Also add `'./js/offline-queue.js'` and `'./js/offline-snapshot.js'` to `SHELL_ASSETS` (around line 18) — the test env list pre-dates those modules. Without pre-caching they'll just cache on first hit (cache-first), so this is polish rather than blocker.

### Other code changes during the copy

#### 1. API base URL in `js/orgapi.js`

(unchanged from previous version of this brief — line 3 `DEFAULT_BASE_URL` to the Phase 1 deployed Worker URL.)

### Code changes during the copy

#### 1. API base URL in `js/orgapi.js`

Test env line 3:

```js
const DEFAULT_BASE_URL = "https://irlid-api-test.irlid-bunhead.workers.dev";
```

Change to (using the URL captured in Phase 1):

```js
const DEFAULT_BASE_URL = "https://irlid-api-org.<account>.workers.dev";
```

`<account>` will be the same `irlid-bunhead` if the live Worker is deployed under the same Cloudflare account. **Do NOT guess** — use the exact URL printed by `wrangler deploy` in Phase 1.

#### 2. Strip DEV bootstrap from `OrgCheckin.html`

The test env supports `?dev=0` / `?dev=1` query params and a DEV org auto-bootstrap. Live should NOT have this — the only sign-in path on live is real Bearer token.

- Grep for `dev=` in `OrgCheckin.html` and the JS files. Identify the DEV bootstrap branch.
- **Option A (clean):** delete the DEV branch entirely.
- **Option B (gated):** wrap it in `if (window.location.hostname.endsWith('github.io') || window.location.hostname === 'localhost')` so it only runs on test surfaces.

Recommend Option B — keeps test env behaviour unchanged, prevents DEV path on live. Less risk of regressing test env smoke.

#### 3. Build pill location reference

The build pill (`Build v5.7.1v` in the sidebar footer) becomes the **live** version marker. Bump to `Build v5.9` in the same commit. From here on, live versions track separately from test env. (Test env stays at v5.7.1w/x as work continues.)

Add a small comment near the pill:

```html
<!-- v5.9 — first live deployment of the Org dashboard. From here, live and test-env
     version pills track separately. Test env continues from v5.7.1w as new work lands. -->
```

#### 4. Forward-design placeholders (per Captain's 10 May directive)

Add these comments at the noted locations. They are intentionally inert — they mark insertion points for v6 features without implementing them.

**In `OrgCheckin.html`** at the attendance row renderer (grep for `renderTable` or the function that builds expected/checked-in rows):

```html
<!-- v6 placeholder: data-zone attribute for zone-gated VIP access + drone audit window.
     Future: <tr data-zone="vip-lounge"> rows render with a zone badge; entry control
     surface filters by zone. See HANDOVER-V6Promotion.md (when drafted). -->
```

**In `OrgCheckin.html`** at the orange QR / "person not recognised" screen (grep for the orange-state markup):

```html
<!-- v6 placeholder: GPS-nearest-staff map widget mounts here.
     div#nearest-staff-map will render the venue floor with the requesting attendee's
     position and the closest available staff. v6 brief defines the protocol. -->
```

**In `js/orgapi.js`** near the org_settings read:

```js
// v6 placeholder: recognition_mode field will gate the recognition flow:
//   'prebind'      — current behaviour, attendee must be Expected first
//   'postattribute' — attendee scans first, gets attributed to an Expected row after
//   'both'         — either path allowed
// Stub field exists in schema; UI surfaces in v6.
```

**In the Worker source** (`irlid-api-org/src/index.js`) at the receipts/attendance endpoint:

```js
// v6 placeholder: event metadata (event_id, slot, location-fingerprint) will append to receipts.
// receipt.html on the consumer side will render this event metadata when present.
// Schema column event_meta_json TEXT exists; populate in v6 hook.
```

These four placeholders are the totality of forward-design work in Phase 2. **Do not** add stubs that change runtime behaviour — comments only.

### Phase 2 acceptance

- [ ] `IRLid/OrgCheckin.html` exists; matches test env structurally; build pill says `Build v5.9`.
- [ ] All `js/*.js` files referenced by the new OrgCheckin.html exist in `IRLid/js/`.
- [ ] `js/orgapi.js` `DEFAULT_BASE_URL` points to the Phase 1 deployed Worker URL.
- [ ] Loading `https://bunhead.github.io/IRLid/OrgCheckin.html` (or `irlid.co.uk/OrgCheckin.html` once Pages redeploys) renders the dashboard shell. It will fail to load any org data — that's expected, no orgs exist yet (Phase 3).
- [ ] Browser console shows clean network calls to `irlid-api-org.<account>.workers.dev`, not `irlid-api-test...`.
- [ ] DEV bootstrap path does not auto-execute on `irlid.co.uk` (verify by visiting without `?dev=0`).
- [ ] Test env continues to work unchanged — visiting `bunhead.github.io/IRLid-TestEnvironment/OrgCheckin.html?dev=0` still bootstraps the DEV org as before.

### Phase 2 PR shape

- **Branch:** `codex/v5.9-2-dashboard-files`
- **PR title:** `[codex] [M] v5.9-phase2 — port OrgCheckin + JS bundle to live repo`
- **Depends on:** Phase 1 PR merged + Worker deployed + URL captured.

---

## Phase 3 — First-org bootstrap + smoke

### First-org provisioning

Live D1 is empty. Captain needs at least one org row before the dashboard can do anything. Recommended approach: pre-seed the test venue (Captain's own org used for testing) by direct D1 insert.

Mr. Data should produce:

`IRLid/irlid-api-org/seed/first-org.sql`

```sql
-- v5.9 first-org seed. One-shot insert for Captain's test venue.
-- Replace the placeholder values before applying. After applying, the
-- printed Bearer token from the orgs table is Captain's sign-in credential.
-- Captain runs: wrangler d1 execute irlid-db-org --file=./seed/first-org.sql --remote

INSERT INTO orgs (org_id, name, created_at, api_key)
VALUES (
  '<UUID — generate with crypto.randomUUID() and paste here>',
  '<venue name — replace>',
  unixepoch(),
  '<random 64-char hex — generate with: openssl rand -hex 32>'
);

-- Optional: insert default org_settings row if the schema requires one
INSERT INTO org_settings (org_id, ...defaults...)
VALUES ('<same uuid as above>', ...);
```

Mr. Data fills in the column names in the second insert by reading `irlid-api-org/schema.sql` from Phase 1.

Captain workflow:

```powershell
cd "D:\SkyDrive\Pen Drive\WEBSITES\IRLid-repo\irlid-api-org"
# Edit seed/first-org.sql, fill in placeholders
wrangler d1 execute irlid-db-org --file=./seed/first-org.sql --remote
# Then read the api_key back:
wrangler d1 execute irlid-db-org --command="SELECT org_id, name, api_key FROM orgs;" --remote
# Captain pastes the api_key into the dashboard's Bearer field on first sign-in.
```

### Smoke checklist (Captain runs on hardware after Phase 3 lands)

Mr. Data writes this checklist into the Phase 3 PR description so Captain has it inline.

- [ ] Visit `irlid.co.uk/OrgCheckin.html` on Captain's main browser (Edge on Windows 11). Sign in via Bearer token from Phase 3 seed.
- [ ] Verify org name displays in the sidebar.
- [ ] Add an Expected attendee. Verify the row appears.
- [ ] Visit `irlid.co.uk/OrgCheckin.html?v=picker1` on phone. Add the same attendee via WebAuthn. Verify check-in works end-to-end.
- [ ] Toggle DevTools → Network → Offline. Add another Expected attendee. Verify PENDING SYNC pill appears.
- [ ] Toggle Offline off. Verify the row drains to a real Expected entry with the SYNCED green check fade.
- [ ] Sign out. Sign back in. Verify state persists.
- [ ] Open the Audit board view. Verify role badges render correctly (the v5.7.1s invert-when-checked-in logic).
- [ ] Open Settings → Theming. Verify the v5.7.1m image customization + v5.5.8 website extraction UI loads. Don't need to test extraction itself end-to-end — that's a separate smoke (`wrangler deploy` of Phase 1 Worker should have shipped the scrape endpoint).
- [ ] Verify build pill reads `Build v5.9`.
- [ ] Verify no console errors during normal flow.

### Phase 3 PR shape

- **Branch:** `codex/v5.9-3-first-org-seed`
- **PR title:** `[codex] [S] v5.9-phase3 — first-org seed + smoke checklist`
- **Files added:** `irlid-api-org/seed/first-org.sql`. Smoke checklist lives in PR description, not in a tracked file.

---

## Out of scope (deliberately deferred to v6 brief)

- Schema unification across consumer (`irlid-db`) and Org (`irlid-db-org`) D1s. The 5 consolidations identified in the v6 successor letter remain valid; they happen against the live shape as the migration baseline.
- Drone delivery zone-gating, GPS-nearest-staff map widget, recognition-mode UI, event-receipts-on-receipts-page integration. Placeholders only in this PR (Phase 2 step 4 above).
- WCAG 2.1 AA full sweep. Test env has v5.7.1k mobile button floors and v5.7.1v customization sweep applied; those carry to live for free via the file copy. Full pass deferred.
- AssistQR (`v5.6`) — still in-flight on test env. Will port separately when ready.
- Cross-org recognition (`§14.18` OAuth identity, `v5.8` work). Test env cached snapshot is single-org; same-shape on live. Cross-org is its own chapter.
- Dyslexia-friendly typography pass.

---

## Why this matters

Test-env-only is fine for build-it-out, but the value to Captain's actual venue staff lands the moment the dashboard runs against a real production URL with real production isolation. Three phases over three days lets Captain verify each step on hardware before the next lands, with full reversibility (any phase can be reverted without affecting the previous).

Path A is *deliberately small* — it is "the test env, on live, against fresh production infrastructure." It is not "v6." That separation is what makes Wednesday plausible. The v6 promotion brief is its own multi-week chapter.

After Wednesday, the live dashboard provides the baseline against which v6 work designs itself: schema unification, drone audit, zone-gated VIP, recognition-mode settings, event-receipts integration. All of those benefit from being designed against a live shape, not against a still-evolving test env.

---

## Captain handoff sequence

Sunday (today): both briefs (this one + `HANDOVER-PositionGrid.md`) ready to forward to Codex.
Monday: Captain forwards Phase 1 to Codex when rate limit allows. Mr. Data lands Worker + D1. Captain runs `wrangler d1 create` + `wrangler deploy` PowerShell.
Tuesday morning: Captain forwards Phase 2. Mr. Data lands file copy. Captain pushes; GitHub Pages auto-deploys to irlid.co.uk.
Tuesday afternoon: Captain forwards Phase 3. Mr. Data lands seed. Captain runs `wrangler d1 execute` for the seed.
Tuesday evening / Wednesday morning: Captain runs the smoke checklist on hardware. Fix anything that breaks.
Wednesday afternoon: declare v5.9 live.

If any phase slips, the dashboard is *not* live for venue staff but the existing live consumer surface (irlid.co.uk/index.html, /scan.html, /receipt.html, etc.) is unaffected.

---

— Number One, drafted for Mr. Data, Sunday 10 May 2026 morning.
