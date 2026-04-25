# HANDOVER.md — Mr. Data Brief (Batch 2)

**Issued:** 26 April 2026 by Number One
**Recipient:** Mr. Data (Codex)
**Repo scope:** `BunHead/IRLid-TestEnvironment` only — do NOT touch `BunHead/IRLid`
**Working rule:** Up to 3 atomic tasks per session, in order, each its own PR. Stop after Task 3.

**Context:** Batch 1 wired the dashboard to the live Worker. This batch adds the **Imbue pilot pattern** — first-visit name registration plus persistent device-key recognition — so attendees show up by name on the dashboard rather than as anonymous fingerprints. This is the minimum needed for Imbue / event check-in / doorman use cases.

**Pre-requisites:** Batch 1 PRs (#2, #3) should be merged to main before starting this batch. If they aren't, ask Number One before proceeding — Task 1 below assumes the dashboard is live-API-backed.

---

## Task 1 — Name-prompt on first-visit check-in

**Goal:** When a device-key is checking in for the first time at a given org, prompt the user for their name once. Store the name client-side and submit it as part of the check-in payload.

**Files in scope:**
- `scan.html` (and any included JS for the check-in flow — `js/scan.js` if it exists)
- `accept.html` if the prompt belongs there instead — your call based on where check-in actually completes

**Acceptance criteria:**
- On a fresh device (no localStorage entry for this org), after a successful scan but before the receipt is finalised, prompt: *"Welcome — what name should we put on the door list?"* with an input field and Continue button
- The entered name is stored locally as `irlid:org:<orgCode>:name` in localStorage, and included in the POST to the Worker check-in endpoint as `name` in the request body
- If the name field is left blank, do NOT block the check-in — submit with no name (anonymous remains a valid path)
- If the device already has a name stored for this org, skip the prompt entirely
- The prompt must be **off the critical path** — pressing Cancel/closing the modal still completes the check-in anonymously

**Out of scope:** name editing UI, name validation beyond non-empty, multi-org name management.

**PR title:** `[codex] Add first-visit name prompt to check-in flow`

---

## Task 2 — Persist `(device_key → name)` in test D1 + Worker endpoint

**Goal:** Extend the `irlid-api-test` Worker so the name from Task 1 is stored against the device key in test D1, and returned alongside attendance rows.

**Files in scope:**
- `irlid-api/schema.sql` (add migration — do NOT rewrite existing tables; append new column or new table)
- `irlid-api/src/index.js` (update check-in POST handler to accept `name`; update `GET /org/attendance` response to include `name` per row)
- `irlid-api/wrangler.toml` only if a binding needs adjusting (probably not)

**Acceptance criteria:**
- Migration is **additive only** — existing rows remain valid (Design Principle: DB is immutable, warts-and-all). Add a `name` column nullable, OR a separate `attendees` lookup table keyed on device_key + org_code. Your call; document the decision in the PR description.
- POST check-in endpoint accepts `name` in the body and stores it
- `GET /org/attendance` returns `name` field per row (null if not provided)
- Migration applied to test D1 (`b7d7ccc9`) via `wrangler d1 execute` — document the exact command in PR description
- Existing rows (without a name) continue to verify and return `name: null` cleanly
- Live Worker smoke: POST a check-in with a name, GET it back via attendance, confirm name field round-trips

**Out of scope:** name editing endpoint, deduplication of names across device keys, GDPR delete endpoint (later).

**Hard rule:** **No retroactive rewrites of existing rows.** If the column is added, old rows get `NULL`, not a backfilled "Anonymous" or anything else. That's the immutability principle.

**PR title:** `[codex] Persist attendee name in test D1 and Worker`

---

## Task 3 — Dashboard renders names + doorman manual-entry

**Goal:** The org dashboard now shows real names where they're known, and lets the doorman type a name against any unknown row inline.

**Files in scope:**
- `org.html`
- `js/orgapi.js` (the file Codex created in Batch 1)

**Acceptance criteria:**
- Dashboard `Attendee` column renders the `name` from the API response when present; falls back to truncated device-key (e.g. `anon_a4f2…`) when null
- Each row with a `null` name shows an inline "+ Add name" button
- Clicking "+ Add name" turns the cell into an input field; pressing Enter or clicking Save sends `PATCH /org/attendance/{rowId}` (or whatever endpoint shape you propose — document in PR) with the new name; cancel discards
- After save, the row updates to show the new name; no full page refresh
- If the PATCH fails, the row reverts and an inline error appears
- Empty/error states from Batch 1 still work — don't regress them

**Out of scope:** bulk edit, undo, name history, who-edited-what audit log.

**Note on the new endpoint:** if you need to add a `PATCH /org/attendance/{id}` endpoint to the Worker, that goes in this PR (it's the doorman-edit feature). Keep auth via `X-Org-Key` like the existing endpoints.

**PR title:** `[codex] Render names on dashboard with doorman manual-entry`

---

## When all three are done

- One short summary message in this thread: which PRs landed, schema decisions made, anything you noticed worth flagging, any questions for Number One
- Then stop. Wait for the next `HANDOVER.md` before picking up further work.

## If you get stuck

- **Stuck on schema choice (Task 2):** add a `name` column to the existing check-ins table is simpler; separate `attendees` lookup table is cleaner long-term. Pick one, justify in PR. Don't ask permission for this — it's a judgement call within scope.
- **Stuck on UI shape (Task 3):** the inline edit pattern is more important than visual polish. Function over form. A doorman just needs it to work fast.
- **Anything that touches `BunHead/IRLid` (the live repo):** stop immediately. Hard wall.
- **Schema migration on test D1 fails:** stop, comment in the PR, wait. Do NOT manually fix the test D1 outside of the migration script.

— Number One
