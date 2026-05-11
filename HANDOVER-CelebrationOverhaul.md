# HANDOVER — Celebration Overhaul: visible accept + new deny animations on the venue QR

**Drafted:** 11 May 2026 morning, by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid` (live repo) primarily; you may also want to mirror the same overhaul to `BunHead/IRLid-TestEnvironment` so the test env tracks. Captain's call on whether to ship both in one PR pair or one at a time.
**Priority:** Medium. Captain reports the existing celebration "does nothing as best I can tell" — the symptom is partly that the default mode's targets don't include the venue check-in QR, partly that the existing modes are too subtle to read "across the room", and the deny side was never built. This is the visible-event-feedback layer of the doorman flow.

---

## Context (read this first)

Yesterday (10 May watch 2) shipped the full check-in/check-out cycle end-to-end on live. Kerry scan_count=5, Spencer scan_count=4, 7 check-outs over the testing session. Functionally everything works. What Captain noticed afterwards: **when an attendee's phone shows the green tick of a successful check-in, the dashboard's venue check-in QR display SHOULD also fire a visible celebration** — so anyone looking at the dashboard's QR screen at the door knows "someone just checked in successfully", at the same moment the attendee themselves see the success on their phone. Both devices, one visual event.

This morning (`v5.9.0.9`) Number One wired `triggerAcceptCycleAnimation()` into the production check-in paths (`runRecognisedDeviceKeyCheckin` queued + completed, `runDoormanCheckin` queued + completed) so the hook actually fires. But the existing `triggerAcceptCycleAnimation` function targets the WRONG elements for the venue-QR-visibility use case:

- `glow` mode (the default) targets `.scan-panel.flash-success`, `.checkin-success-overlay`, `.scan-panel`, `.irlid-qr-fullscreen.active .irlid-qr-fullscreen-holder` — these are the **dashboard's scan panel / fullscreen overlay**, not the inline venue QR on the Check-in panel.
- `page` and `pattern` modes do target `#venueQRWrap` but the visuals are subtle and the modes aren't the default.

Captain's intent: a noticeable visual on the inline venue QR (`#venueQRWrap` on the Check-in panel), visible at door-attendance distance (~3-5 metres), running off the existing palette + mode dropdown system from the v5.5.x theming work.

Plus a parallel **deny animation** that fires when a check-in is rejected (catch path in `manualCheckin`, error responses from `runRecognisedDeviceKeyCheckin` / `runDoormanCheckin`, staff_session 401, etc.) — Captain mentioned "There should be a deny animation as well, but that was meant to be in the overhaul." So it was always part of the design intent; just hadn't been built.

---

## Goal

Two complementary improvements:

1. **Accept animation overhaul** — when `triggerAcceptCycleAnimation()` fires (already wired in v5.9.0.9), the visible result on the dashboard's venue check-in QR (`#venueQRWrap`) should be a clear celebration burst — across-the-room visible, palette-respecting (uses the Celebration palette from the existing Theme settings), tunable via the existing mode dropdown (off/glow/page/pattern as starting modes, but the GLOW default needs to actually be visible).
2. **Deny animation (new)** — add a parallel `triggerDenyCycleAnimation()` function that fires on error/rejection paths, producing a clearly different visual (red-shifted, sharper, shorter burst, or whatever you design). Should also target the venue QR primarily. Wire it into the catch blocks of the four check-in paths and any other 4xx/error path that means "this attendee was rejected at the door".

Both animations should be visually distinct from each other — accept is celebratory, deny is "no". An observer at the door looking at the dashboard QR screen should be able to tell from across the room whether the last scan was accepted or denied without having to look at the small attendance table.

---

## Where the existing code lives

### `OrgCheckin.html` line ~7815 — `triggerAcceptCycleAnimation()`

```javascript
function triggerAcceptCycleAnimation() {
  const mode = (activeTheme && activeTheme.cycleMode) || 'glow';
  if (mode === 'off') return;
  const ms = Math.max(600, ((activeTheme && activeTheme.cycleAnimDuration) || 1.4) * 1000 + 200);

  if (mode === 'glow') {
    const candidates = [
      document.querySelector('.scan-panel.flash-success'),
      document.querySelector('.checkin-success-overlay'),
      document.querySelector('.scan-panel'),
      document.querySelector('.irlid-qr-fullscreen.active .irlid-qr-fullscreen-holder')
    ].filter(Boolean);
    // ... adds .cycling class
  }
  // page/pattern modes target #venueQRWrap correctly
}
```

The bug-in-the-default: `glow` mode doesn't target `#venueQRWrap` at all. Fix is either (a) add `#venueQRWrap` to the glow candidate list, OR (b) consolidate so all modes target both the venue QR AND any active fullscreen overlay AND the scan panel. (b) is probably better since the fullscreen mode is the audit-board view that DOES need to flash too.

### `OrgCheckin.html` line ~6411 — accept hook fire sites (already in v5.9.0.9)

```javascript
// manualCheckin success:
flashDoormanPanel(result.linked ? 'success' : 'walkin');
try { if (typeof triggerAcceptCycleAnimation === 'function') triggerAcceptCycleAnimation(); } catch(_) {}

// runRecognisedDeviceKeyCheckin queued (line ~6236) + completed (line ~6242) — same pattern
// runDoormanCheckin queued (line ~6272) + completed (line ~6278) — same pattern
```

### Where deny should fire (currently only `flashDoormanPanel('error')` exists)

- `manualCheckin` catch block (line ~6414) — fires on any check-in error
- `runRecognisedDeviceKeyCheckin` — currently no catch block at the top level; the calls bubble up to caller (`processDashboardScan`). The escalation flow handles errors via toasts. You'd add a deny hook in `processDashboardScan`'s catch block (line ~5687).
- `runDoormanCheckin` — same as above; errors bubble to caller
- Score-below-min rejection (Worker returns 403 with `Score N below minimum M`) — caught by callers
- staff_session 401 — caught by callers

Cleanest pattern: wherever `flashDoormanPanel('error')` is called today, ALSO call `triggerDenyCycleAnimation()`. That's the single fire-site convention to mirror the accept side.

### CSS animation classes

The existing `cycling`, `cycle-burst-page`, `cycle-burst-pattern` classes drive the current animations. They're defined in the CSS block around line 1893 (`/* Mode-aware visibility on the celebration panel (Batch 6.5f) */`) and 2266 (`/* Batch 6.5f — Celebration burst variants */`).

For the overhaul:
- Either redesign the existing classes to be more visible at the door distance, OR
- Add new classes (`cycle-accept-vivid`, `cycle-deny-vivid` or similar) that the overhauled function uses as default
- The Celebration palette and Cycle duration from Settings should still drive the timing + colour values

### Mode dropdown

The Settings panel has Mode dropdown (line ~3035 in OrgCheckin.html) with values `off`, `glow`, `page`, `pattern`. Captain hasn't asked for the dropdown to be removed — he wants the animations behind those modes to be better. Preserve the dropdown; redesign what each mode looks like.

For the deny side: should the deny animation ALSO be tunable via a parallel dropdown, or just be a single "Deny burst" that fires unconditionally regardless of mode? Captain didn't specify. **My recommendation: single deny burst (not modal) for v1, add modality later if needed.** Saves complexity.

---

## Design latitude (you decide)

These are decisions Captain didn't pin down — make a call and ship:

- **Accept-mode default visuals.** Glow halo around the venue QR is the existing default. Make it pop more: bigger glow radius, palette colour cycling, maybe a brief scale pulse on the QR itself. Visible at door distance.
- **Deny-mode visual.** Red-shifted, shorter, sharper. Maybe a quick screen-shake on the QR wrap, or a red ring that contracts inward. Distinct enough from accept that an observer doesn't confuse them.
- **Duration.** The existing `cycleAnimDuration` slider (0.5s..5s) drives the accept duration. Deny is probably shorter by default (0.5-1s) regardless — denials should feel decisive, not lingering.
- **Sound.** Off-by-default. Captain's whole protocol philosophy is "every feature off by default". If you want to add a sound option for accept/deny, gate it behind a Settings toggle that defaults to OFF.
- **Audit board view.** If the audit-board fullscreen view (`.irlid-qr-fullscreen.active`) is showing when a check-in fires, the celebration should be visible there too. The current code targets the fullscreen holder but it's worth verifying with hardware.

---

## Acceptance checklist

- [ ] When `triggerAcceptCycleAnimation()` fires with `cycleMode='glow'` (default), the venue check-in QR on the Check-in panel (`#venueQRWrap`) shows a visible celebration burst — observable from ~3-5 metres away.
- [ ] When the audit-board fullscreen view is active, the same celebration also fires there.
- [ ] New `triggerDenyCycleAnimation()` function exists, fires on error/rejection paths, produces a clearly different visual.
- [ ] Deny hook wired into all sites where `flashDoormanPanel('error')` currently fires.
- [ ] Deny animation is shorter than accept (decisive, not lingering) and visually distinct (red-shifted, different shape).
- [ ] Settings page "Preview celebration" button now produces a visibly clear burst.
- [ ] Add a "Preview deny" button next to the existing Preview celebration so Captain can visually compare both side-by-side without faking a real check-in.
- [ ] Mode dropdown preserved (off/glow/page/pattern still work) — just the visuals behind each mode are improved.
- [ ] Build pill bump `v5.9.0.10 → v5.9.0.11`. Note: Number One landed `v5.9.0.10` inline (Organisation Terms display field — adds an `orgTerms` setting persisted to Worker settings_json + rendered on `org-entry.html` as an informational footer) before this brief lands, so the pre-bump pill state is `v5.9.0.10`. If it shows anything different when you start, check `git log` for an intervening Number One commit and bump from whatever pill actually shows.

---

## Out of scope

- Sound. If you add it, gate behind a toggle defaulted OFF. Don't make it the headline.
- Changing the celebration fire sites — those are wired correctly in v5.9.0.9.
- Changing the existing palette / theme system — celebration animation reads from `activeTheme.palette` and `activeTheme.cycleAnimDuration`, preserve that contract.
- Forward-port to test env — Captain may want this on live first to validate, then port. Don't bundle both repos in one PR unless he explicitly asks.

---

## Two-phone hardware verification (Captain runs)

1. Sign into live dashboard as developer. Navigate to Check-in panel (so venue QR is visible).
2. Have one phone scan the venue QR. Phone goes through org-entry → IF recognised (Kerry, Spencer) → green tick on phone AT THE SAME TIME the dashboard's venue QR fires the new accept celebration.
3. Have a phone scan with bio score below threshold OR a denied-permission state to trigger an error path. Dashboard's venue QR should fire the deny animation.
4. Both observable from across the room.
5. Try each mode (off/glow/page/pattern) and confirm they all produce visible results.

---

## PR title

`[codex] v5.9.0.11 — Celebration overhaul: accept on venue QR + new deny animation`

Branch: `codex/v5.9.0.11-celebration-overhaul`.

Expected PR scope: Medium-Large (~200-400 lines: CSS animations, new triggerDenyCycleAnimation function, fire-site wiring, Settings panel Preview Deny button, pill bump).

Single PR. Stop and raise if scope expands beyond "accept + deny animations on venue QR with associated settings + previews".

---

— Number One, 11 May 2026 morning watch.
