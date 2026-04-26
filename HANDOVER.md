# HANDOVER.md — Mr. Data Brief (Batch 10 — Demo-Polish Fixes)

**Issued:** 27 April 2026 (evening) by Number One
**Recipient:** Mr. Data (Codex)
**Repo scope:** `BunHead/IRLid-TestEnvironment` only — do NOT touch `BunHead/IRLid`
**Working rule:** 3 atomic tasks. Polish + fixes. No protocol changes.

**Context:** Captain tested the demo flow after Batch 9 merge. Two issues surfaced and one design decision needs implementation:

1. **Fullscreen QR still overflows** — PR #25's responsive sizing fix may not have applied correctly, OR was not yet merged when tested. Investigate live state and fix.
2. **Expected attendees list not visible in Venue mode** — currently only shows in Doorman Console panel. Per Captain's design call (one shared list), should be visible in both modes.
3. **Worker-signed venue QR** — not part of this batch but worth flagging that the existing trust cues are still human-readable only. Captured for v6.

**Pre-requisite:** PRs #25, #26, #27 (Batch 9) merged to main and Worker deployed. Verify with `git log origin/main --oneline -10` — if you don't see commits referencing "responsive sizing", "logo top-left", or "doorman dwell", stop and tell Captain to merge before proceeding.

---

## Task 1 — Fullscreen Venue QR sizing — investigate and fix

**Goal:** The fullscreen QR overlay must fit cleanly within the viewport on all screen sizes (phone, tablet, desktop) without overflow on either axis. PR #25 attempted this; either it didn't merge or the fix isn't taking effect live.

**Files in scope:**
- `org.html` (the fullscreen QR overlay markup + scoped CSS)
- Any associated stylesheet

**Investigation steps:**
1. Check live `org.html` on main: does it contain the responsive CSS from PR #25? If not, the merge didn't carry the changes.
2. If the CSS is there but still overflowing, inspect the rendered QR on a 1080p viewport: what's the actual computed size of the QR module? Is `max-width` being overridden by an inline style? Is `aspect-ratio` supported in the layout context?
3. Likely culprit: the QR generation library may be setting explicit `width`/`height` attributes on the canvas/img element that override CSS.

**Acceptance criteria:**
- On a 1920×1080 desktop viewport: fullscreen overlay shows org logo + heading + QR module + trust text, ALL fitting on screen with no scroll
- QR module: roughly 60-65% of viewport min-dimension (~600px on 1080p, ~360px on iPad portrait, ~250px on phone)
- On any viewport ≥ 320px wide: no horizontal scroll
- Maintains 1:1 aspect ratio
- The fix must survive QR regeneration (e.g., the responsive CSS isn't overwritten when the QR refreshes)

**PR title:** `[codex] Fullscreen Venue QR — fix responsive sizing (debug + repair)`

---

## Task 2 — Expected attendees list visible in both Check-in modes

**Goal:** The Expected Attendees panel currently only renders when the page is in "Doorman Scans Attendee" mode (Doorman Console visible). Per Captain's design call (one shared list across modes), the panel should be visible in both modes — same data, same admin controls.

**Files in scope:**
- `org.html` (the check-in page, both mode layouts)
- `js/orgapi.js` if the data fetching needs to move to a shared init

**Acceptance criteria:**
- When "Active at door" toggle is set to **Attendee Scans Venue QR** (Venue mode): Expected attendees panel still renders below the Venue QR display, with the same data as Doorman mode
- When **Doorman Scans Attendee** mode is active: Expected attendees panel renders as today, in the same position relative to the Doorman Console
- The Add expected attendee form (First Name / Surname / green Add / red Delete) is visible in both modes
- The list data is the same — switching modes does not lose or duplicate entries
- All existing Add/Delete/Edit/Auto-link functionality works identically in both modes
- Live smoke: add an attendee in Venue mode → switch to Doorman mode → row is there. Vice versa.

**Out of scope:** mode-specific list filters (e.g., "show only paid members in doorman mode") — future enhancement.

**PR title:** `[codex] Show Expected attendees list in both Venue and Doorman modes`

---

## Task 3 — Identity recovery foundation — `rebind_history` table + admin recovery endpoint

**Goal:** Lay the schema and Worker groundwork for v5 identity recovery (when a user gets a new phone). This task adds the persistent backing without UI — the UI lives in a future batch once v5 is implemented.

**Files in scope:**
- `irlid-api/schema.sql` (additive: new `rebind_history` table)
- `irlid-api/src/index.js` (new endpoint `POST /org/expected/:id/rebind`)
- `js/orgapi.js` (helper for rebind; UI optional in this batch)

**Schema (additive):**
- New table `rebind_history`:
  - `id` INTEGER PRIMARY KEY AUTOINCREMENT
  - `org_code` TEXT NOT NULL
  - `expected_id` INTEGER NOT NULL (foreign-key style; references `org_expected.id`)
  - `old_device_fp` TEXT
  - `new_device_fp` TEXT NOT NULL
  - `admin_signature` TEXT (for now, just admin's `org_code` + timestamp; full crypto signing comes with v5)
  - `reason` TEXT (e.g., "device_replaced", "key_lost")
  - `created_at` INTEGER NOT NULL

**Worker behaviour — `POST /org/expected/:id/rebind`:**
- Auth: `X-Org-Key` (admin)
- Body: `{new_device_fp, reason, one_time_token?}` (one_time_token unused in this batch — schema only)
- Cooldown check: count rows in `rebind_history` for this `expected_id` in the current calendar month. If ≥ 2, return 429 `{error: "rebind_limit_exceeded", retry_after: <unix_timestamp_first_of_next_month>}`
- If allowed: insert into `rebind_history`, update `org_expected.device_key_fp` to `new_device_fp`, return `{ok: true, rebind_id: <id>}`
- Old device's previous receipts remain valid forever (immutability principle)

**Acceptance criteria:**
- Schema migration applied to test D1 cleanly via the existing idempotent migration pattern (see `apply_batch8_crypto_identity_loop.ps1` for reference)
- New endpoint accessible; returns 429 after 2 rebinds in a month
- Old device fp recorded; new device fp bound to expected attendee
- No UI in this batch — endpoint exercisable via curl/PowerShell for now
- Live smoke: register a DEV expected attendee, rebind once (success), rebind twice (success), rebind third time same month (429)
- Migration handles re-runs safely — re-applying does not duplicate the table

**Hard rule:** **No retroactive rewrites.** Old device fps are recorded in `rebind_history`, not deleted from past receipts. Past receipts stay valid forever.

**PR title:** `[codex] Identity recovery foundation — rebind history schema + admin endpoint`

---

## When all three are done

- One short summary message: which PRs landed, schema decisions, Worker version deployed, anything noticed
- Stop. Wait for the next `HANDOVER.md`.

## If you get stuck

- **Pre-requisite missing (Batch 9 not on main):** stop, tell Captain to merge PR #25/#26/#27
- **Task 1 root cause is the QR generation library forcing width/height:** mention in PR; the fix is to wrap the QR module in a flex container with the responsive constraints, OR to override the canvas attributes after generation
- **Task 3 cooldown logic ambiguity (what counts as "calendar month"):** use UTC-month boundaries (`strftime('%Y-%m', created_at)` in SQLite). Document choice in PR.
- **Anything that touches `BunHead/IRLid` (the live repo):** stop immediately. Hard wall.

## Captain's note (relayed by Number One)

Cross-device Passkey sync (iCloud Keychain, Google Password Manager) is the *primary* recovery path — it works automatically with any WebAuthn implementation that uses `residentKey: "preferred"`. The admin rebind in Task 3 is the *fallback* for users who don't have sync working (lost device + no cloud backup). Both paths complement each other.

— Number One
