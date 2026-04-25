# HANDOVER.md — Mr. Data Brief (Batch 3)

**Issued:** 26 April 2026 by Number One
**Recipient:** Mr. Data (Codex)
**Repo scope:** `BunHead/IRLid-TestEnvironment` only — do NOT touch `BunHead/IRLid`
**Working rule:** Up to 3 atomic tasks per session, in order, each its own PR. Stop after Task 3.

**Context:** Batch 2 added user-driven name capture on check-in (PR #5 + #6 — should be merged to main before this batch starts). This batch adds the **org-admin-driven Expected Attendees management flow** — letting an organisation pre-load known attendees by name *before* the event, so the doorman has a list to match against. This is the other half of the Imbue pilot pattern.

**Pre-requisites:** PR #5 and PR #6 must be merged to main before starting Task 3. Tasks 1 and 2 are UI/client-only and can run regardless. If PR #5/#6 aren't merged when you start, do Tasks 1 and 2 anyway and stop before Task 3.

---

## Task 1 — UI restructure: Expected Attendees admin frame

**Goal:** Add a new input panel on the check-in page for the org admin to type expected attendees by name. Visual restructure only — no wiring yet.

**Files in scope:**
- `org.html` (check-in page)
- Any associated CSS in `<style>` blocks or external stylesheets

**Layout requirements:**
- In the **lowest frame area** of the check-in page (currently containing "When identity is unclear")
- Restructure into **two columns**:
  - **Left column (NEW):** "Expected Attendees Admin" panel
    - Heading: "Add expected attendee"
    - Two input fields side-by-side: `First Name` | `Surname` (label above each input)
    - Below the inputs, two buttons in a row:
      - **Add** — green (e.g., `bg-emerald-500` or matching the existing "Record Check-in" green button)
      - **Delete** — red (e.g., `bg-red-500`)
  - **Right column (MOVED):** existing "When identity is unclear" content, unchanged
- Responsive: stacks single-column on mobile; side-by-side on desktop (≥768px)

**Acceptance criteria:**
- New left-column panel visible with heading, two labeled inputs, and two buttons
- Existing "When identity is unclear" content is preserved exactly, just moved to right column
- Layout works on both mobile (stacked) and desktop (side-by-side)
- No JavaScript wiring yet — buttons are inert; inputs accept text but do nothing
- No regression in existing check-in flow (Doorman Console, attendee QR mode, Quick Settings)

**Out of scope:** Add/Delete behaviour (Task 2), persistence (Task 3), validation (later batch).

**PR title:** `[codex] Add Expected Attendees admin frame to check-in page`

---

## Task 2 — Wire Add/Delete behaviour (client-side, in-memory)

**Goal:** Make the buttons from Task 1 functional against client-side state. No persistence yet — just in-memory list updates.

**Files in scope:**
- `org.html`
- `js/orgapi.js` if it makes sense to add helpers there; otherwise inline in `org.html`

**Behaviour — Add button:**
- Click Add → reads First Name and Surname inputs
- If either is blank, show inline validation message: "Please enter both first name and surname"
- If both filled: prepends a new row to the Expected attendees list with:
  - Display name: `First Name + " " + Surname`
  - Status badge: `assist` (matching existing styling for "assist" rows)
  - Subscription state: `manual · added by admin`
- Inputs clear after successful add
- Existing Expected attendees rows stay where they are — new rows go at the top of the list

**Behaviour — Delete button:**
- Click Delete → enters "delete mode":
  - The Expected attendees list becomes the **only** interactive element on the page
  - Everything else greys out (apply `opacity: 0.4; pointer-events: none;` or similar to all other panels)
  - The Expected attendees list rows become hover-highlighted; cursor: pointer
- Click any row in delete mode → show confirmation modal/dialog: *"Remove [Full Name] from expected attendees?"* with Cancel and Confirm buttons
- Confirm → remove that row from in-memory state, exit delete mode (un-grey everything)
- Cancel → close modal, stay in delete mode (allows clicking a different row)
- ESC key or clicking outside the list → exit delete mode without changes
- A subtle visual indicator that delete mode is active (e.g., "Delete mode — click a row to remove" banner above the list)

**Acceptance criteria:**
- Add prepends rows correctly with the right state
- Delete enters its mode visually (greys everything else)
- Delete confirmation dialog appears and behaves correctly
- ESC and outside-click exit delete mode without changes
- Existing Expected attendees rows (the seed/debug data) can be deleted same as newly-added ones
- No regression in any existing check-in functionality

**Out of scope:** Persistence (Task 3), edit/rename of existing rows, bulk delete.

**PR title:** `[codex] Wire Expected Attendees Add/Delete (client-side)`

---

## Task 3 — Persist Expected Attendees list in test D1

**Goal:** Move the Expected attendees list from in-memory / debug state to actual persistence in test D1 via the Worker. Org admins can now add/remove expected attendees and have them survive page refresh and be shared across devices viewing the same org.

**Pre-requisite:** PR #5 and PR #6 from Batch 2 must be merged to main first. If they aren't, **do not start Task 3** — comment in the chat and stop.

**Files in scope:**
- `irlid-api/schema.sql` (additive migration only)
- `irlid-api/src/index.js` (new endpoints)
- `js/orgapi.js`
- `org.html`

**Schema (additive):**
- New table `org_expected` with columns: `id` (auto-increment primary key), `org_code` (text, indexed), `first_name` (text), `surname` (text), `status` (text, default `'assist'`), `created_at` (integer timestamp)
- Existing tables and rows are not touched — this is purely additive

**Worker endpoints (auth via `X-Org-Key`, same as existing org endpoints):**
- `GET /org/expected` — returns array of expected attendees for the authenticated org, ordered by `created_at DESC`
- `POST /org/expected` — body `{first_name, surname}` — inserts row, returns the inserted row including its `id`
- `DELETE /org/expected/:id` — removes the row if it belongs to the authenticated org

**Client wiring:**
- On page load: replace the seed/debug Expected attendees data by calling `GET /org/expected`
- Add button (from Task 2): now calls `POST /org/expected`, appends the returned row to the list
- Delete confirmation (from Task 2): now calls `DELETE /org/expected/:id`, removes from list on success
- Empty / loading / error states handled the same as Batch 1's `org/attendance` panel:
  - Loading: spinner while fetching
  - Empty: "No expected attendees yet — add some above"
  - Error: banner with retry button
  - Auth failure: "Session expired — please re-authenticate"

**Acceptance criteria:**
- Migration is **additive only** — no rewriting of existing tables. Document the exact `wrangler d1 execute` command in the PR description.
- All three endpoints work end-to-end against `irlid-api-test`
- Live smoke: add via UI → refresh page → row persists; delete via UI → refresh → row gone
- Worker version deployed to `irlid-api-test` documented in PR description
- No regression in existing `/org/attendance` or `/org/checkin` endpoints

**Hard rule:** **No retroactive rewrites.** New table is purely additive. Existing tables untouched.

**PR title:** `[codex] Persist Expected Attendees list in test D1`

---

## When all three are done

- One short summary message: which PRs landed, schema decision (table chosen, indexes, etc.), Worker version deployed, anything noticed worth flagging
- Stop. Wait for the next `HANDOVER.md`.

## If you get stuck

- **PR #5 / #6 not yet merged when you reach Task 3:** stop, comment in chat, do not improvise. Tasks 1 and 2 are still useful even without Task 3.
- **Layout choice ambiguity (Task 1):** match the visual register of the rest of the page; check existing CSS classes in use (e.g., the existing green "Record Check-in" button — match that green for the Add button).
- **Schema migration on test D1 fails:** stop, comment in PR, wait. Do NOT manually fix the test D1 outside of the migration script.
- **Anything that touches `BunHead/IRLid` (the live repo):** stop immediately. Hard wall.

— Number One
