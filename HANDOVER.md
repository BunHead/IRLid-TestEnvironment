# HANDOVER.md — Mr. Data Brief (Batch 4)

**Issued:** 27 April 2026 by Number One
**Recipient:** Mr. Data (Codex)
**Repo scope:** `BunHead/IRLid-TestEnvironment` only — do NOT touch `BunHead/IRLid`
**Working rule:** Up to 3 atomic tasks per session, in order, each its own PR. Stop after Task 3.

**Context:** Batches 1–3 built the editable database — dashboard wiring, name capture, persistence, admin frame, Add/Delete, server persistence of Expected Attendees. This batch closes the gap between "expected attendees list" and "actual check-ins" so the org admin can see, in real time, who has arrived. This is what makes the Imbue pilot demo actually compelling.

**Pre-requisite:** PR #9 from Batch 3 must be merged to `main` and the Worker must be deployed to `irlid-api-test` before starting. If `GET /org/expected` returns a 404 against the live test Worker, **stop immediately and ask** — don't improvise around a missing endpoint.

---

## Task 1 — Auto-link on manual check-in

**Goal:** When a doorman performs a manual check-in (the existing "Name or ID" input + Record Check-in flow), and the name they enter matches an Expected Attendee for that org (case-insensitive), the system auto-links them — flipping the attendee's status from `assist` to `linked` and stamping first-seen time.

**Files in scope:**
- `irlid-api/src/index.js` — extend the existing `/org/checkin` endpoint
- `org.html` — display the link result in the doorman flow
- `js/orgapi.js` — helper if needed

**Server behaviour:**
- On `POST /org/checkin` with a `name` field: after recording the check-in, query `org_expected` for any row matching `(org_code, lower(first_name + ' ' + surname) = lower(submitted_name))`. If a match exists, update its `status` from `assist` to `linked` and set a new `linked_at` timestamp column.
- Schema migration: add nullable `linked_at INTEGER` column to `org_expected` (additive only, no rewrites)
- Response includes `{linked: true, expected_id: <id>}` when an auto-link occurred, otherwise `{linked: false}`
- Existing rows already with `status = 'linked'` are not touched (no double-stamping)

**Client behaviour (`org.html` doorman flow):**
- After Record Check-in returns `{linked: true}`: show a small inline confirmation: *"✓ Matched expected attendee: [Full Name]"*
- After Record Check-in returns `{linked: false}` with a name: show: *"Recorded as walk-in (not on expected list)"*
- Empty name still works (anonymous walk-in path remains unchanged)
- Refresh the Expected attendees list view so the status badge updates from `assist` to `linked` without a full page reload

**Acceptance criteria:**
- Schema migration applied to test D1 cleanly (additive)
- Worker version deployed to `irlid-api-test`; documented in PR description
- Live smoke: add expected attendee "Test Person" via UI → manual check-in with name "test person" (lowercase) → status flips to `linked` → "✓ Matched" message appears
- Live smoke: manual check-in with name not on expected list → "walk-in" message appears, no errors
- No regression in the anonymous (no-name) walk-in path
- Old check-in records remain unchanged

**Hard rule:** **No retroactive linking of past check-ins.** Only new check-ins flowing through the endpoint trigger the link. Old rows stay as they were. (Immutability principle.)

**PR title:** `[codex] Auto-link manual check-in to Expected Attendee match`

---

## Task 2 — Alphabetical sort + duplicate prevention on Expected list

**Goal:** The Expected Attendees list is now sorted alphabetically by surname (then first name). Adding a duplicate name (case-insensitive match on first + surname) is rejected with a clear inline message instead of silently creating a second row.

**Files in scope:**
- `irlid-api/src/index.js` — sort in the `GET /org/expected` query; duplicate check in `POST /org/expected`
- `org.html` — handle the duplicate error response cleanly
- `js/orgapi.js` — error path if needed

**Server behaviour:**
- `GET /org/expected` — return rows ordered by `LOWER(surname) ASC, LOWER(first_name) ASC`
- `POST /org/expected` — before inserting, query for `LOWER(first_name) = LOWER(?) AND LOWER(surname) = LOWER(?) AND org_code = ?`. If a match exists, return HTTP 409 Conflict with body `{error: "duplicate", existing_id: <id>}`. Otherwise insert as normal.

**Client behaviour:**
- On 409 Conflict from Add: show inline error message under the inputs: *"[Full Name] is already on the expected list."* — keep the inputs filled so the user can correct
- All other error paths from Batch 3 continue to work (network down, auth fail, etc.)

**Acceptance criteria:**
- Live smoke: add "Alice Smith" → success. Add "alice smith" again → inline duplicate error shown, no second row created. Add "Bob Smith" → success, sorts after Alice.
- After page refresh, list is in alphabetical order by surname
- No regression on Delete or other existing flows

**PR title:** `[codex] Sort Expected list alphabetically; reject duplicates`

---

## Task 3 — Inline edit-name on Expected list rows

**Goal:** Click an Expected Attendee's name → it becomes editable inline (two text inputs: First / Surname) → Save commits the change to test D1; Cancel reverts. Allows correcting typos without delete-then-readd.

**Files in scope:**
- `irlid-api/src/index.js` — new `PATCH /org/expected/:id` endpoint
- `org.html` — inline edit UI
- `js/orgapi.js` — new helper

**Server behaviour:**
- `PATCH /org/expected/:id` — body `{first_name, surname}`. Auth via `X-Org-Key`. Updates the row only if it belongs to the authenticated org. Returns the updated row.
- Same case-insensitive duplicate check as Task 2 on PATCH (don't allow renaming "Alice Smith" → "Bob Jones" if a "Bob Jones" already exists for this org).
- Does NOT change `status`, `created_at`, `linked_at`, or any other field.

**Client behaviour:**
- Pencil icon (or click on the name itself) on each Expected Attendee row → row enters edit mode: two inline text inputs (First / Surname) replace the name display, Save and Cancel buttons appear
- Save → calls PATCH → on success, row re-renders with new name; on duplicate (409) or error, inline message under that row, edit mode stays active
- Cancel → discards changes, row returns to display mode
- Only one row in edit mode at a time — clicking pencil on another row cancels the first edit
- ESC key cancels edit
- Status badges (`linked`, `assist`) and Delete button remain visible during edit (just the name field becomes editable)

**Acceptance criteria:**
- Live smoke: edit "Alice Smith" → "Alicia Smith" → save → list re-sorts (alphabetical sort from Task 2 still applies) → name persists across refresh
- Editing to a duplicate name shows inline error, doesn't save
- ESC and Cancel both abort cleanly
- Delete still works on rows whether in edit mode or not (delete cancels edit first)
- No regression on Add, Delete, auto-link from Tasks 1–2

**PR title:** `[codex] Inline edit-name on Expected Attendee rows`

---

## When all three are done

- One short summary message: which PRs landed, schema decisions, Worker version deployed, anything noticed worth flagging
- Stop. Wait for the next `HANDOVER.md`.

## If you get stuck

- **PR #9 not merged when you start:** stop immediately, ask in chat. Do not improvise.
- **Schema migration on test D1 fails:** stop, comment in PR, wait. Do NOT manually fix the test D1 outside of the migration script.
- **Auto-link logic ambiguity (Task 1):** if a name matches multiple expected attendees somehow (shouldn't happen due to Task 2's duplicate prevention, but in case of legacy data), link only the first match by `id ASC` and document the choice in the PR description.
- **Anything that touches `BunHead/IRLid` (the live repo):** stop immediately. Hard wall.

— Number One
