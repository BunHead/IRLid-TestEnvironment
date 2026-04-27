# HANDOVER.md - Mr. Data Brief (Batch 13 Draft)

**Issued:** 27 April 2026 by Mr. Data
**Repo scope:** `BunHead/IRLid-TestEnvironment` only. Do not touch live `BunHead/IRLid`.
**Working rule:** one narrow task per PR. Do not combine Worker schema, frontend gate, and checkout-token work in one PR.
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

## Task 1 - Staff Auth Schema + Session Endpoint

**Goal:** Add the Worker/D1 foundation for staff authentication, without changing Doorman UI behaviour yet.

**Files:** `irlid-api/src/index.js`, `irlid-api/schema.sql`, `js/orgapi.js`.

**Behaviour:**

- Add idempotent D1 migration for a staff auth/session table, for example `org_staff_sessions`.
- Add `POST /org/staff/auth`.
- Request body accepts the staff HELLO payload in the same compact/raw forms used by attendee HELLO QR.
- Worker verifies the HELLO structure and, if the repository already has reusable verification helpers, verifies the signature against the included public JWK. If reusable verification is not locally available, store this as `verification_state: "structure_checked"` and document the gap in the PR rather than inventing incompatible crypto.
- Worker binds the staff session to the organisation API key used by the portal request.
- Return `{ok:true, staff_session:<opaque token>, expires_at, staff_pub_fp}`.
- TTL should be short, suggested 15 minutes.
- No retroactive rewrites of old check-ins.

**Acceptance:**

- Valid HELLO-shaped payload returns a staff session.
- Missing public key / malformed HELLO returns 400/401.
- Expired timestamp returns 401.
- Same HELLO replay within a short tolerance is either idempotent or clearly rejected, but must not corrupt state.
- No Doorman UI gating in this task.

**PR title:** `[codex] Staff auth session foundation`

## Task 2 - Staff Auth UI Smoke Panel

**Goal:** Add a visible but non-blocking Staff Auth panel in Doorman mode so the endpoint can be exercised from the portal before enforcement.

**Files:** `org.html`, `org-entry.html`, `js/orgapi.js`.

**Behaviour:**

- In Doorman mode, show a Staff Auth panel above the manual check-in controls.
- Support a testable scanner path for a staff HELLO QR. If camera scanning is not available in `org.html`, provide a clear debug import/paste route for `H:` / `HZ:` HELLO payloads.
- Store staff session in memory or `sessionStorage`, not durable localStorage.
- Manual check-in remains enabled in this task; this is a smoke/testing panel only.
- Existing attendee HELLO generation remains intact.

**Acceptance:**

- Fresh page in Doorman mode: Staff Auth panel visible.
- Valid staff HELLO auth: panel shows authenticated staff fingerprint and expiry.
- Expired/cleared session: panel returns to unauthenticated state.
- Existing Venue QR mode unaffected.

**PR title:** `[codex] Staff auth portal smoke panel`

## Task 3 - Enforce Staff Auth For Manual Check-in

**Goal:** The Doorman Console cannot record manual check-ins until the current staff/doorman device has an active staff session.

**Files:** `org.html`, `js/orgapi.js`, `irlid-api/src/index.js`.

**Behaviour:**

- Manual check-in button is disabled until staff auth succeeds.
- `manualCheckin()` includes the staff session token.
- Worker rejects doorman/manual check-in requests without a valid staff session.
- Expired session disables the button again and shows a clear message.
- Existing Venue QR and attendee self-check-in paths are unaffected.

**Acceptance:**

- Fresh Doorman mode: manual check-in disabled.
- Valid staff auth: manual check-in enabled.
- Missing/expired staff token: Worker rejects with 401 and UI explains the issue.

**PR title:** `[codex] Enforce staff auth for doorman check-in`

## Task 4 - Checkout Token Schema + API

**Goal:** Add Worker/D1 support for short checkout tokens, without changing the UI yet.

**Files:** `irlid-api/src/index.js`, `irlid-api/schema.sql`, `js/orgapi.js`.

**Behaviour:**

- Add idempotent D1 migration for checkout token storage, for example `org_checkout_tokens`.
- Add `POST /org/checkout-token` for the org portal to create a short token for an active check-in.
- Add `GET /org/checkout-token/:token` or equivalent resolution endpoint.
- Tokens expire quickly, suggested 5 minutes.
- Do not backfill or rewrite old check-ins.

**Acceptance:**

- Token can be created for an active check-in.
- Valid token resolves to the data needed by checkout entry.
- Expired/unknown token returns clear 404/410 style response.

**PR title:** `[codex] Checkout token API foundation`

## Task 5 - Short Checkout QR UI

**Goal:** Replace long checkout URLs with short Worker-backed tokens so checkout QR codes render at scannable density on large screens and mobile devices.

**Files:** `org.html`, `org-entry.html`, `js/orgapi.js`.

**Behaviour:**

- QR should encode a short URL such as `org-entry.html?type=checkout&t=<token>` rather than embedding org key, check-in id, nonce, event, and logo in the visible QR.
- `org-entry.html` resolves the token, then continues the existing signed checkout path.
- If token creation fails, show a clear inline error and do not show a blank QR box.

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

Stop after each task. Report PR link, deployment state, and any D1 migration applied.
