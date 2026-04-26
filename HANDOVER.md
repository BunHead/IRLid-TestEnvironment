# HANDOVER.md — Mr. Data Brief (Batch 7 — Presentation Polish)

**Issued:** 27 April 2026 (midday) by Number One
**Recipient:** Mr. Data (Codex)
**Repo scope:** `BunHead/IRLid-TestEnvironment` only — do NOT touch `BunHead/IRLid`
**Working rule:** Up to 5 atomic tasks (visual polish only — no protocol changes).

**Context:** The test environment is functional end-to-end (PRs #14, #15, #16 now on main; DEV auto-login works; check-in, attendee list, expected attendees, fullscreen venue QR, branding, and check-out all live). The Captain demoed it to family with a real phone scan and the redirect/branding worked. Now the goal is **presentation polish** — make every visible state look intentional and confident, ready to show Donald at Imbue.

This batch is **visual/UX only**. No schema changes, no Worker changes (unless adding a presentational endpoint becomes necessary — flag and stop if so).

**Pre-requisite:** PRs #14 and #15 (with #16 stacked) must be on main. If not, stop and ask.

---

## Task 1 — Welcome page logo sizing + spacing

**Goal:** The post-scan welcome page (the one the attendee's phone shows after scanning the venue QR) currently shows the org logo at small size. Make it presentation-grade: prominent logo, generous spacing, clear hierarchy.

**Files in scope:**
- The attendee-facing welcome/confirm page (likely `accept.html`, `org-entry.html`, or wherever the post-scan flow lives — check existing routing to confirm the right file)
- Associated CSS

**Acceptance criteria:**
- Logo displayed at `max-width: 240px` (or similar tasteful size — match the green checkmark proportionally)
- Logo has at least 32px breathing room above and below
- Logo container `object-fit: contain` so non-square logos (like Imbue's wordmark) render correctly
- "Welcome to [org]" heading is at least `2rem` size, weight 600+
- The custom welcome message appears below the heading at comfortable readable size
- Re-entry/policy line stays subtle but legible
- Page works on portrait phone widths (320px+) — no logo overflow
- Logo loading failure gracefully falls back to initials or a neutral icon (don't show broken-image)

**Out of scope:** changing the green checkmark, animating the page entrance (Task 5 covers some animation).

**PR title:** `[codex] Welcome page — logo sizing and spacing polish`

---

## Task 2 — Fullscreen Venue QR — final polish pass

**Goal:** The fullscreen venue QR (Settings → QR test tools → fullscreen) is the centrepiece of the doorman demo. Currently functional thanks to PR #15. Now make it confident and clear from 2-3 metres away.

**Files in scope:**
- `org.html` (the Settings panel and the fullscreen overlay)
- Associated CSS

**Acceptance criteria:**
- QR module size: at least 70% of the smaller viewport dimension on landscape monitors (so a 1080p screen shows a QR at minimum ~750px)
- Org logo displayed above the QR at a tasteful size (~120px)
- "Scan to check in to [Org Name]" tagline above QR, large and legible
- Trust cue text (org key fingerprint, scan domain — already present from PR #15) below QR, in a smaller subtle font
- Solid dark background to maximise QR scan contrast (white background already matches QR convention; keep)
- Subtle pulse animation on the QR border (~2s cycle, very gentle) to draw eye without distracting
- Exit-fullscreen button visible but unobtrusive (top-right corner, low-opacity until hover)

**Out of scope:** Worker-signed QR payload (deferred — see Task 5 caveat note)

**PR title:** `[codex] Fullscreen Venue QR — presentation polish`

---

## Task 3 — Doorman scan flow — visual feedback states

**Goal:** When the doorman uses Manual check-in or scans an attendee, give immediate visual feedback for each outcome. Currently the form just submits silently and the row appears in the list. Demo-grade requires confidence-building feedback.

**Files in scope:**
- `org.html` (Doorman Console section)
- CSS for transitions

**Acceptance criteria:**
- **In-progress:** Record Check-in button shows a subtle spinner inline while the request is in flight; button text changes to "Checking in..."; button is disabled
- **Success — auto-link match:** brief green flash on the Doorman Console panel (300ms), the inline "✓ Matched expected attendee: [Name]" message from PR #14 stays visible for 4 seconds then fades
- **Success — walk-in:** brief amber flash; "Recorded as walk-in" message stays for 4 seconds
- **Failure:** brief red flash; error inline; button re-enables; input field stays filled so the doorman can retry
- All transitions use CSS only; no library dependencies
- Reduced-motion preference (`prefers-reduced-motion: reduce`) skips the flash animations but keeps the text feedback

**Out of scope:** sound effects (later); screenreader live regions (worth doing eventually but not this batch).

**PR title:** `[codex] Doorman flow — scan feedback animations`

---

## Task 4 — Checkout confirmation flow

**Goal:** The Check-out button from PR #16 currently fires immediately on click. For demo confidence and safety, add a quick inline confirmation: hover/click reveals "Confirm check-out?" inline, only the second click commits.

**Files in scope:**
- `org.html` (Dashboard attendance table)
- `js/orgapi.js` if needed
- CSS

**Acceptance criteria:**
- Click Check-out → button transforms inline into "Confirm" (red) + small "Cancel" (grey) — does NOT use a modal
- Confirm click → fires the existing `POST /org/checkout` call, button shows brief spinner
- On success → row's status badge transitions from "🟢 IN" to "🔴 OUT", check-out time stamps in
- On failure → revert button, inline error appears
- Cancel click → button returns to "Check out" without firing anything
- Dashboard stats (CHECKED IN / CHECKED OUT) update without full-page refresh
- ESC key while in confirm state → cancels

**Out of scope:** undo-checkout (later); checkout reason tracking (later).

**PR title:** `[codex] Check-out — inline confirmation + status transition`

---

## Task 5 — Dashboard sparkle pass

**Goal:** Make the four headline stat cards (Checked In, Checked Out, Avg Score, Bio-metric Verified) feel alive. Currently they snap from one value to another. Demo-grade should count up smoothly when values change.

**Files in scope:**
- `org.html` (Dashboard component)
- CSS / a tiny inline JS counter helper

**Acceptance criteria:**
- When stat values change (after refresh, after check-in, after checkout): numbers animate from old value to new over ~600ms (ease-out)
- For percentage scores: animate from 0% to current value on first load
- The "Min threshold: 70%" line under Avg Score: subtle progress bar (already partially there as the orange line) showing distance from threshold
- Status indicator dot next to "Attendance — Today" header pulses subtly (~2s cycle) to indicate live data
- Reduced-motion preference disables count animations; uses snap to final value
- "Last updated: HH:MM:SS" is replaced by a relative time ("just now", "2 minutes ago") that updates every 30 seconds

**Out of scope:** Charts / graphs (deferred to a later batch); CSV export polish.

**PR title:** `[codex] Dashboard — stat animations and live indicators`

---

## When all five are done

- One short summary message: which PRs landed, anything noticed worth flagging
- Stop. Wait for the next `HANDOVER.md`.

## If you get stuck

- **PRs #14/#15/#16 not yet on main when you start:** stop, comment, ask Captain to merge first
- **Need a Worker change to support polish (e.g., new endpoint):** stop and propose; do NOT implement Worker changes in this batch
- **Library dependency required for animation:** prefer CSS-only or a tiny inline JS helper. Do not pull in a new library.
- **Anything that touches `BunHead/IRLid` (the live repo):** stop immediately. Hard wall.

## Captain's note (relayed by Number One)

The Worker-signed QR payload work you proposed at the end of Batch 6 is captured for v6 — good architectural thinking, deferred deliberately so this presentation batch stays purely visual. Carry on with the polish.

— Number One
