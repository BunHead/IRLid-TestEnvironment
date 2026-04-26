# HANDOVER.md — Mr. Data Brief (Batch 9 — Demo-Ready Polish)

**Issued:** 27 April 2026 (evening) by Number One
**Recipient:** Mr. Data (Codex)
**Repo scope:** `BunHead/IRLid-TestEnvironment` only — do NOT touch `BunHead/IRLid`
**Working rule:** 3 atomic tasks. Visual + UX polish. No protocol changes.

**Context:** Batch 8 added the cryptographic identity loop (signed check-out, device recognition, conflict detection). The test environment is now functionally Imbue-grade. This batch closes three demo-readiness gaps surfaced during live testing:

1. The fullscreen venue QR overflows the viewport on smaller screens (overshoots both axes; needs responsive sizing)
2. There's no org logo in the chrome — when Imbue is signed in, the top-left should show the Imbue logo (default to IRLid logo if missing/broken)
3. Doorman scan flow (Review / Deny modes) currently redirects to the post-scan URL after each scan, breaking the doorman's rhythm; should return to scan window and dwell on Review/Deny states longer

**Pre-requisite:** PR #24 (Batch 8) merged to main and deployed. If GitHub Pages still shows old Batch 7 code, stop and ask.

---

## Task 1 — Fullscreen Venue QR responsive sizing

**Goal:** The fullscreen venue QR fits cleanly on phone, tablet, and desktop viewports without overflow on either axis. Maintains 1:1 aspect ratio.

**Files in scope:**
- `org.html` (the fullscreen QR overlay)
- Associated CSS

**Acceptance criteria:**
- QR module sized via: `max-width: min(70vmin, 600px); width: 70vmin; aspect-ratio: 1; height: auto;` (or equivalent — feel free to use modern CSS that achieves this)
- On a 1920×1080 desktop: QR is ~600px square, surrounded by branding
- On an iPad portrait (820×1180): QR is ~574px square, fits with breathing room
- On a phone (375×812): QR is ~262px square, no horizontal scroll, vertical scroll only if needed
- Org logo above QR scales proportionally (max ~25% of QR height)
- Trust cue text below QR remains legible at all sizes
- No horizontal scroll on any viewport ≥320px wide
- Exit-fullscreen button stays in top-right corner, accessible at all sizes

**Out of scope:** orientation-change animations; print media query.

**PR title:** `[codex] Fullscreen Venue QR — responsive sizing`

---

## Task 2 — Org logo top-left when signed in (IRLid fallback)

**Goal:** When an org is signed in, their logo (from Settings → Branding → Logo URL) appears in the top-left corner of the org portal chrome (`org.html`). Falls back to the IRLid logo if no URL is set or if the image fails to load.

**Files in scope:**
- `org.html` (header/sidebar layout)
- Associated CSS
- May need to wire to the existing `settings.logoUrl` field

**Acceptance criteria:**
- Top-left of org portal shows the org logo at a tasteful size (~32-40px height; horizontal logos like Imbue's wordmark scale to fit; max-width ~160px)
- Image element uses `onerror` handler that swaps to the IRLid logo (`logo.png` or whatever the existing repo's IRLid logo path is) if the URL fails
- If `settings.logoUrl` is empty/null: show IRLid logo by default
- Existing `IRLid` text label / org name display in the sidebar (e.g., "Imbue / Signed in locally (DEV auto-login)") stays where it is — this task is about the chrome logo, not the sidebar identity
- Logo updates live when org admin changes `logoUrl` in Settings (no page reload required)

**Note:** Captain mentioned eventual move to bottom-left near Settings. Keep it top-left for this batch; bottom-left position is a future tweak.

**Out of scope:** logo upload (just URL); cropping tools; multiple logos for different contexts.

**PR title:** `[codex] Org logo top-left chrome with IRLid fallback`

---

## Task 3 — Doorman scan flow: stay in scan window + dwell on Review/Deny

**Goal:** When a doorman is in active scan mode (Review or Deny outcomes), after each scan the page returns to the scan window for the next person, instead of redirecting to the org's post-scan URL. Review and Deny outcome states stay visible long enough to read (currently flash too quickly).

**Files in scope:**
- `org.html` (Doorman Console / scan flow)
- Likely `accept.html` or wherever the post-scan handler lives — branch on whether the request is from the doorman context vs attendee self-scan
- Associated JS / state machine

**Acceptance criteria:**
- **Doorman context detection:** check-in/scan requests originating from the doorman flow (e.g., a query param `from=doorman`, or the active "Doorman Scans Attendee" mode toggle on the page) are flagged
- **Doorman flow after scan:**
  - Review outcome: shows full-page success state with attendee name, score, status — stays visible for **8 seconds** (was previously briefer/redirected)
  - Deny outcome: shows full-page deny state with reason — stays visible for **8 seconds**
  - At end of dwell: returns to the scan window (camera ready for next scan), NOT to the post-scan redirect URL
  - Manual "Next" / "Continue" button visible during dwell to skip the wait
- **Attendee-self-scan flow (Attendee Scans Venue QR mode):** unchanged — they still get the post-scan redirect to org's welcome page
- The two flows share the underlying check-in API call but diverge on the post-result UI behaviour

**Acceptance criteria continued:**
- Live smoke: doorman scan in Review mode → 8s dwell on success → returns to scan window. Repeat without leaving the page.
- Live smoke: doorman scan in Deny mode → 8s dwell on deny → returns to scan window
- Live smoke: attendee scans venue QR (separate flow) → still redirects to org welcome page after success
- ESC key or "Next" button skips dwell early in doorman mode
- No regression in any existing scan path

**Out of scope:** sound effects; haptic feedback on mobile; doorman session timeout / auto-lock.

**PR title:** `[codex] Doorman scan flow — stay in scan window + dwell on Review/Deny`

---

## When all three are done

- One short summary message: which PRs landed, anything noticed worth flagging
- Stop. Wait for the next `HANDOVER.md`.

## If you get stuck

- **Pre-requisite missing (PR #24 not merged / Pages not live):** stop and ask
- **Existing layout breaks at small viewports during Task 1:** prefer narrowing the QR over breaking the page; if the trade-off is real, flag it in PR description and pick the less ugly option
- **Doorman vs attendee context detection unclear (Task 3):** prefer an explicit query param (`?ctx=doorman`) over implicit detection; stop and ask if the existing code structure makes this hard
- **Anything that touches `BunHead/IRLid` (the live repo):** stop immediately. Hard wall.

## Captain's note (relayed by Number One)

The shared-Expected-list question (one list across both modes vs separate lists per mode) was decided: **one shared list**. Same org, same event, same humans. Future VIP/general split is queued for if a customer asks.

— Number One
