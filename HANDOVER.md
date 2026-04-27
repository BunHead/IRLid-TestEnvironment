# HANDOVER.md - Mr. Data Brief (Batch 13 Draft)

**Issued:** 27 April 2026 by Mr. Data
**Repo scope:** `BunHead/IRLid-TestEnvironment` only. Do not touch live `BunHead/IRLid`.
**Working rule:** 3 atomic tasks, stacked only if each PR clearly states its base branch.
**Current main:** Batch 12 carried to `main` by PR #40.

## Batch 12 Live Hardening Prerequisite

Before starting Batch 13 protocol work, merge and deploy the live-hardening fix that:

- Makes checkout QR rendering robust when the generated QR image appears as a white square.
- Keeps the Check-in settings control and sidebar bottom area clear of the viewport/taskbar edge.
- Re-tests GitHub Pages after deployment, not just local files.

If the live site still shows a blank checkout QR or a bottom control hidden by the taskbar, stop and fix that first.

## Batch 13 Goal

Move the test environment one step closer to real protocol behaviour:

1. A doorman/staff device must cryptographically authenticate itself with its own signed HELLO before it can record check-ins.
2. Checkout QR payloads should become short, scannable URLs backed by Worker-side token resolution.

This is not a polish batch. It touches frontend state, Worker endpoints, and D1 schema.

## Task 1 - Staff HELLO Auth Foundation

**Goal:** Add a Worker-backed staff authentication primitive that verifies a signed HELLO and returns a short-lived staff session.

**Files:** `irlid-api/src/index.js`, `irlid-api/schema.sql`, `js/orgapi.js`.

**Behaviour:**

- Add idempotent D1 migration for a staff auth/session table, for example `org_staff_sessions`.
- Add `POST /org/staff/auth`.
- Request body accepts the staff HELLO payload in the same compact/raw forms used by attendee HELLO QR.
- Worker verifies the HELLO signature against the included public JWK using existing canonical/signature helpers or the closest local equivalent.
- Worker binds the staff session to the organisation API key used by the portal request.
- Return `{ok:true, staff_session:<opaque token>, expires_at, staff_pub_fp}`.
- TTL should be short, suggested 15 minutes.
- No retroactive rewrites of old check-ins.

**Acceptance:**

- Valid signed HELLO returns a staff session.
- Tampered HELLO returns 400/401.
- Expired timestamp returns 401.
- Same HELLO replay within a short tolerance is either idempotent or clearly rejected, but must not corrupt state.

**PR title:** `[codex] Staff HELLO auth foundation`

## Task 2 - Gate Doorman Check-in Behind Staff Auth

**Goal:** The Doorman Console cannot record manual check-ins until the current staff/doorman device has authenticated.

**Files:** `org.html`, `org-entry.html`, `js/orgapi.js`.

**Behaviour:**

- In Doorman mode, show an authentication panel above the manual check-in controls.
- Support a testable scanner path for a staff HELLO QR. If camera scanning is not available in `org.html`, provide a clear debug import/paste route for `H:` / `HZ:` HELLO payloads.
- Store staff session in memory or `sessionStorage`, not durable localStorage.
- Manual check-in button remains disabled until staff auth succeeds.
- Expired staff session disables manual check-in again.
- Existing attendee HELLO generation remains intact.

**Acceptance:**

- Fresh page in Doorman mode: manual check-in disabled.
- Valid staff HELLO auth: manual check-in enabled and shows authenticated staff fingerprint.
- Expired/cleared session: manual check-in disabled again.
- Existing Venue QR mode unaffected.

**PR title:** `[codex] Gate doorman check-in behind staff HELLO auth`

## Task 3 - Short Checkout QR Tokens

**Goal:** Replace long checkout URLs with short Worker-backed tokens so checkout QR codes render at scannable density on large screens and mobile devices.

**Files:** `irlid-api/src/index.js`, `irlid-api/schema.sql`, `org.html`, `org-entry.html`, `js/orgapi.js`.

**Behaviour:**

- Add idempotent D1 migration for checkout token storage, for example `org_checkout_tokens`.
- Add `POST /org/checkout-token` for the org portal to create a short token for an active check-in.
- Add `GET /org/checkout-token/:token` or equivalent resolution endpoint.
- QR should encode a short URL such as `org-entry.html?type=checkout&t=<token>` rather than embedding org key, check-in id, nonce, event, and logo in the visible QR.
- `org-entry.html` resolves the token, then continues the existing signed checkout path.
- Tokens expire quickly, suggested 5 minutes.
- Do not backfill or rewrite old check-ins.

**Acceptance:**

- Checkout QR visibly contains black modules and passes a pixel/density smoke test.
- Token URL is substantially shorter than the previous checkout URL.
- Valid token resolves and checkout still requires the same attendee signing path.
- Expired/unknown token shows a clear error.

**PR title:** `[codex] Short checkout QR tokens`

## Verification Required Per Task

- Inline scripts parse with Node.
- `node --check` for changed JS files.
- `git diff --check` clean aside from normal Windows CRLF warnings.
- Worker endpoints tested with local or remote smoke commands.
- Browser smoke tests for the actual UI path, including QR pixel checks where a QR is expected.

## Stop Point

Stop after Task 3. Report PR links, deployment state, and any D1 migration applied.
