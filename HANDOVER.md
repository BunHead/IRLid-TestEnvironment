# HANDOVER.md — Mr. Data Brief

**Issued:** 26 April 2026 by Number One
**Recipient:** Mr. Data (Codex)
**Repo scope:** `BunHead/IRLid-TestEnvironment` only — do NOT touch `BunHead/IRLid`
**Working rule:** Up to 3 atomic tasks per session, in order, each its own PR. Stop after Task 3.

---

## Task 1 — Wire `org.html` attendee list to `irlid-api-test`

**Goal:** Replace any mocked attendee data in `org.html` with real `fetch()` calls against the live `irlid-api-test` Worker.

**Files in scope:**
- `org.html`
- `js/orgapi.js` (create if it doesn't exist — keep API calls out of the HTML)
- `irlid-api/src/index.js` (read-only; reference existing endpoints, do not modify Worker behaviour in this PR)

**Acceptance criteria:**
- Org portal loads attendee list from `irlid-api-test` Worker via `GET /attendees` (or whichever endpoint already exists; check `irlid-api/src/index.js` first)
- Org token sent in request header per existing auth scheme
- Each attendee row renders: name (or first-seen ID), first-seen timestamp, last-seen timestamp, scan count
- No mocked / hardcoded attendee data left in `org.html`
- Smoke test passes: load org portal in fresh browser → real test-DB rows appear within 2 seconds

**Out of scope:** pagination, filtering, sorting (those are Task 4+ for a future session).

**PR title:** `[codex] Wire org.html attendee list to irlid-api-test`

---

## Task 2 — Empty and error states for `org.html`

**Goal:** Define what `org.html` shows when things aren't happy. Currently undefined.

**Files in scope:**
- `org.html`
- `js/orgapi.js` (from Task 1)

**Acceptance criteria:**
- **Empty state:** when `GET /attendees` returns zero rows, render a friendly empty message ("No attendees yet — share your QR to get started") instead of a blank panel
- **Worker down:** when fetch fails (network / 5xx), render an error banner with retry button; do not throw an uncaught error
- **Auth failure:** when fetch returns 401/403, render "Session expired — please re-authenticate" with a re-login link
- **Loading state:** spinner or skeleton while fetch is in flight; do not show empty state during loading
- All four states reachable in test (mock the Worker response with browser dev tools; document the test in PR description)

**Out of scope:** retry-with-backoff logic, offline mode (future).

**PR title:** `[codex] Add empty and error states to org.html`

---

## Task 3 — `README.md` for `IRLid-TestEnvironment`

**Goal:** A new contributor (or future Mr. Data session) can clone this repo and understand what it is, what it isn't, and how to run it.

**Files in scope:**
- `README.md` (new file at repo root)

**Acceptance criteria:** README contains the following sections, each at least 2–3 sentences of real content:
1. **What this is** — IRLid test environment: live `BunHead/IRLid-TestEnvironment` GitHub Pages + `irlid-api-test` Cloudflare Worker + test D1 (`b7d7ccc9`)
2. **What this is NOT** — not the production repo (`BunHead/IRLid`), not the canonical protocol spec (that lives in `BunHead/IRLid/PROTOCOL.md` — reference only, do not import)
3. **How to run locally** — wrangler dev for the Worker, any static server for the HTML; document the env vars / token needed
4. **How to reset the test DB** — wrangler d1 execute commands; reference `irlid-api/schema.sql`
5. **Working rules** — link back to this `HANDOVER.md`; note the "up to 3 atomic tasks per session, separate PR each, stay in this repo" rule
6. **Tagged commits convention** — Codex commits prefixed `[codex]`; Number One updates prefixed `[no1]`

**Out of scope:** badges, contributor list, CI status (future polish).

**PR title:** `[codex] Add README.md for IRLid-TestEnvironment`

---

## When all three are done

- Open one short summary message in this thread: which PRs landed, anything you noticed mid-task that's worth flagging, any questions for Number One
- Then stop. Wait for the next `HANDOVER.md` before picking up further work.

## If you get stuck

- **Stuck on scope:** stop, comment in the PR with the question, wait for Number One's reply. Do not improvise scope.
- **Stuck on Worker behaviour:** read `irlid-api/src/index.js` for ground truth, do NOT change Worker code in this batch
- **Anything that touches `BunHead/IRLid` (the live repo):** stop immediately. That's a hard wall.

— Number One
