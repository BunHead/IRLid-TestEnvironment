# HANDOVER.md — Mr. Data Brief (Batch 11 — First-Scan Identity Flow)

**Issued:** 27 April 2026 (evening) by Number One
**Repo scope:** `BunHead/IRLid-TestEnvironment` only.
**Working rule:** 3 atomic tasks. UX + small Worker work.

**Pre-requisite:** Batch 10 PRs #29/#30/#31 merged to main. Verify via `git log origin/main --oneline -10`. If not, stop.

---

## Task 1 — First-scan: detect unrecognised device → orange flash + Expected list picker

**Goal:** When an attendee scans the venue QR and their device key is not yet bound to any Expected Attendee for this org, present the Expected list as a picker so they can claim themselves.

**Files:** `org-entry.html` (or wherever the post-scan attendee page lives), `js/orgapi.js`.

**Behaviour:**
- On scan-arrival page load: client computes its own `device_key_fp` from its localStorage key (or generates one if first ever) and calls `GET /org/recognize?device_pub=<fp>`
- If `recognized: true`: existing flow — proceed to check-in (this is unchanged)
- If `recognized: false`:
  - Background of the page flashes **orange** (matching the Review-state colour from Doorman flow) — single flash, ~600ms ease-out, then settles to a steady amber tinted background to indicate "needs identity"
  - Page shows the org's Expected attendees list as a tappable picker
  - Search box at the top of the list filters by First+Surname (case-insensitive, real-time)
  - "I'm not on the list" walk-in option at the bottom (preserves current anonymous path)
- On pick: `POST /org/expected/:id/claim` with body `{device_pub_fp}`. Worker binds `device_key_fp` on the row IF not already bound to a different device (otherwise returns 409 conflict — handled by Task 2 of Batch 8 already; surface conflict here as "Already claimed by another device — see organiser")
- On successful claim: short success state, then return to the fullscreen venue QR (the scan window) so the attendee can scan again now-recognised

**Acceptance:**
- New device first scan → orange flash + Expected list with search → pick → claim succeeds → returns to scan window
- Recognised device on subsequent scans: existing fast-path, no list shown
- "I'm not on the list" → existing walk-in flow unchanged
- Conflict on claim (someone else's device already bound to that name) → clear inline error, no state corruption

**PR title:** `[codex] First-scan unrecognised flow — orange flash + Expected list picker`

---

## Task 2 — Outcome flashes on scan: green accept, red deny

**Goal:** When a scan completes (after recognition or after fresh claim), the post-scan page background flashes green (accepted) or red (denied) before showing the welcome/redirect or the deny state.

**Files:** `org-entry.html` (or post-scan handler), CSS, `accept.html` if separate.

**Behaviour:**
- On accept (recognised + within score threshold): background flashes green ~600ms then settles to existing welcome state (with logo + "Welcome to [org]")
- On deny (score below threshold, or conflict, or other rejection): background flashes red ~600ms then shows deny state with reason
- Orange flash from Task 1 (unrecognised → needs identity) coexists; no conflict
- `prefers-reduced-motion: reduce` swaps flashes for solid colour without animation
- Flashes are CSS-only

**Acceptance:**
- Accept path: orange flash on first scan (Task 1) → claim → return → second scan green flash → welcome
- Deny path: red flash → deny state visible
- Reduced-motion respected

**PR title:** `[codex] Scan outcome flashes — green accept, red deny`

---

## Task 3 — Worker `POST /org/expected/:id/claim` endpoint

**Goal:** Backing endpoint for Task 1's pick-from-list flow. Binds the chosen Expected Attendee's `device_key_fp` to the scanning device's key.

**Files:** `irlid-api/src/index.js`, `irlid-api/schema.sql` (no new tables — uses existing `org_expected.device_key_fp`).

**Behaviour:**
- `POST /org/expected/:id/claim` with body `{device_pub_fp}`. Auth: org context (the scanner is on the org's check-in page; pass org's public key in headers as today, or use the same DEV auto-login pattern).
- If `org_expected.device_key_fp` is null → set it to `device_pub_fp`, return `{ok: true, expected: <row>}`
- If already set to same fp → idempotent success (handles double-tap)
- If already set to a *different* fp → return `409 {error: "already_claimed", existing_fp_short: <first 8 chars>}` so client can surface "claimed by another device"
- No new schema; piggybacks on Task 2 of Batch 8's `device_key_fp` column

**Acceptance:**
- Live smoke: claim unbound expected → success. Claim same expected with same fp → idempotent success. Claim with different fp → 409.
- Worker version documented in PR description

**PR title:** `[codex] Worker /org/expected/:id/claim — bind device to Expected row`

---

## Stop after Task 3

**Hard wall:** no live `IRLid` repo. No protocol changes. No retroactive rewrites.

— Number One
