# HANDOVER — `v5.7.1k` Gateway Sizing + Mobile-Friendly Buttons + Audit Refresh

**Drafted:** 9 May 2026, by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid-TestEnvironment` only.
**Priority:** Independent of all other in-flight work. Can ship in parallel.

---

## Context (read this first)

Three Captain UX calls bundled into one polish PR:

1. **The gateway screens (`org-entry.html`) feel small.** The welcome / accept / deny / review / identity states have plenty of empty real estate around small type. Captain's eye-test 9 May: enlarge the visual hierarchy (logo, checkmark, title, subtitle) for `body.status-allow`, `body.status-deny`, `body.status-review`, `body.status-identity`.
2. **Leave `body.status-orange` alone.** It's the "show your QR for scanning" state and already fills the screen correctly per the `v5.7.1g` six-bug fix (`body.status-orange .wrap { width: 100vw; padding: 16px 10px; }`). Any sizing changes to other states must NOT regress this.
3. **Buttons across the site are too small for mobile** — the checkout button on attendance rows specifically called out, but the principle applies everywhere. Apply 44×44 px minimum touch targets per WCAG 2.1 AA.
4. **Audit mode (`v5.7.1h`) needs a refresh button.** Currently the only floating control in audit mode is "↩ Exit audit". Add a matching "↻ Refresh" floating button that calls `refreshAttendance()` so staff at the door can pull fresh data without exiting fullscreen.

---

## Goal — three changes in one PR

### A. Enlarge gateway states (org-entry.html)

For `body.status-allow`, `body.status-deny`, `body.status-review`, `body.status-identity` (NOT `body.status-orange`):

Bump these clamp ranges in the existing CSS:

| Selector | Current | New |
|---|---|---|
| `.title` | `clamp(32px, 6vw, 72px)` | `clamp(40px, 8vw, 96px)` |
| `.subtitle` | `clamp(18px, 3vw, 30px)` | `clamp(22px, 4vw, 40px)` |
| `.icon-shell` | `width/height: min(42vw, 270px)` | `width/height: min(54vw, 340px)` |
| `.logo` | `width: min(58vw, 240px); max-height: 180px` | `width: min(70vw, 320px); max-height: 240px` |
| `.brand-fallback` | `width/height: min(44vw, 144px)` | `width/height: min(56vw, 200px)` |

Implementation: gate the bumps with a body-class selector so orange stays put. E.g.:

```css
/* v5.7.1k — bumped sizing for non-orange states. Orange keeps its
   v5.7.1g override which already fills the screen for the QR. */
body:not(.status-orange) .title    { font-size: clamp(40px, 8vw, 96px); }
body:not(.status-orange) .subtitle { font-size: clamp(22px, 4vw, 40px); }
body:not(.status-orange) .icon-shell { width: min(54vw, 340px); height: min(54vw, 340px); }
body:not(.status-orange) .logo { width: min(70vw, 320px); max-height: 240px; }
body:not(.status-orange) .brand-fallback { width: min(56vw, 200px); height: min(56vw, 200px); }
```

Verify on a phone-width viewport (375px) and a tablet-width viewport (1024px) that the new sizes still fit without overflow. The existing `html, body { max-width: 100vw; overflow-x: hidden; }` guard from `v5.7.0t` should hold.

### B. Mobile-friendly buttons site-wide (OrgCheckin.html + org-entry.html)

Apply WCAG 2.1 AA touch-target minimums (44×44 px) to every interactive button. The existing `v5.7.1g` mobile escalation modal already does this for its specific buttons (`min-height: 44px`); generalise the pattern:

```css
/* v5.7.1k — site-wide mobile touch-target floor. Applies to all buttons
   on viewports ≤640px so motor-impaired and stylus-free users can
   tap reliably. Per WCAG 2.1 AA Success Criterion 2.5.5. */
@media (max-width: 640px) {
  button, .btn, [role="button"] {
    min-height: 44px;
    min-width: 44px;
  }
  /* The Delete record / Initiate check-out / Refresh / CSV / Sign out
     buttons on attendance rows specifically — Captain called these out. */
  .att-action-cell button,
  .checkout-actions button,
  .conflict-actions button,
  .topbar-actions button {
    min-height: 44px;
    padding: 8px 14px;
    font-size: 14px;
  }
}
```

Pay particular attention to:

- Attendance row action buttons (Delete record, Initiate check-out, Delete expected) — Captain specifically flagged these as too small.
- Topbar action buttons (Refresh, Audit, CSV, Sign out) — currently `font-size: 12px` per `.topbar-actions` rule, which makes them small targets too.
- Expected attendee management Add button + role dropdown.
- Sidebar nav items (already 44px+, verify).

### C. Audit-mode refresh button (OrgCheckin.html)

In audit mode (`v5.7.1h`), add a floating refresh button bottom-right that mirrors the existing "↩ Exit audit" pattern. Captain's request 9 May: staff at the door want to pull fresh data without exiting fullscreen.

Markup (place near the existing Exit Audit button, likely around line ~5070 of `OrgCheckin.html` based on `v5.7.1h` shape):

```html
<button type="button" id="auditRefreshBtn" class="audit-refresh-btn" hidden>
  ↻ Refresh
</button>
```

CSS (mirror the Exit Audit button styling):

```css
/* v5.7.1k — audit-mode refresh button. Mirrors the "↩ Exit audit"
   pattern but bottom-right instead of top-right. Captain's request. */
.audit-refresh-btn {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 100;
  display: none;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 18px;
  min-height: 44px;
  background: rgba(255, 149, 0, 0.92);
  color: #03120a;
  border: none;
  border-radius: 10px;
  font: 700 14px/1 system-ui, sans-serif;
  cursor: pointer;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.35);
}
body.audit-mode .audit-refresh-btn { display: inline-flex; }
.audit-refresh-btn:active { transform: scale(0.97); }
```

JS wire-up (place near the existing `enterAuditMode()` / `exitAuditMode()` helpers):

```javascript
// v5.7.1k — audit-mode refresh button. Calls the existing
// refreshAttendanceFromUI() so staff get the spin animation + status
// text + "Attendance refreshed" toast that came in v5.7.1g.
document.getElementById('auditRefreshBtn')?.addEventListener('click', () => {
  if (typeof refreshAttendanceFromUI === 'function') {
    refreshAttendanceFromUI();
  } else if (typeof refreshAttendance === 'function') {
    refreshAttendance();
  }
});
```

---

## Acceptance checklist

### Gateway sizing
- [ ] On a phone-width viewport (Chrome DevTools mobile emulation: Pixel 8 Pro), open `org-entry.html` in each of the four enlarged states: `status-allow`, `status-deny`, `status-review`, `status-identity`. Verify the title, subtitle, logo, and checkmark are visibly larger than before.
- [ ] On the same viewport, open `org-entry.html` in `status-orange`. Verify it is UNCHANGED — the QR still fills the screen edge-to-edge per `v5.7.1g`.
- [ ] On a desktop viewport (1440px), the enlarged states still fit within the viewport without horizontal overflow.
- [ ] No regression on the v5.7.0t `overflow-x: hidden` guard.
- [ ] No regression on the v5.7.1f auto-staff-sign-in flow (still diverts after green hold).

### Mobile-friendly buttons
- [ ] On Chrome DevTools mobile emulation, tap-test the attendance row buttons (Delete record, Initiate check-out, Delete expected) — each tap target is at least 44×44 px.
- [ ] Topbar action buttons (Refresh, Audit, CSV, Sign out) reach at least 44×44 px on mobile.
- [ ] Expected attendee management Add button is chunky (≥44px).
- [ ] No regression on desktop button styling — the rules are gated by `@media (max-width: 640px)`.

### Audit-mode refresh button
- [ ] Enter audit mode (Topbar `⛶ Audit` button on Dashboard panel). Verify the floating "↻ Refresh" button is visible bottom-right.
- [ ] Tap "↻ Refresh" — the existing refresh feedback fires (spin animation + status text + toast).
- [ ] Exit audit mode. Verify the refresh button disappears (only visible when `body.audit-mode` is set).
- [ ] On a tablet in landscape (e.g. Captain's Huawei), the refresh button doesn't overlap the attendance table data.

---

## Branch & PR shape

- **Branch:** `codex/v5.7.1k-gateway-mobile-audit-refresh`
- **PR title:** `[codex] [M] v5.7.1k — gateway sizing + mobile-friendly buttons + audit-mode refresh`
- **Expected PR scope:** Medium (~80–150 lines new/modified across `org-entry.html` and `OrgCheckin.html`; mostly CSS in two media-query blocks + a small button markup + JS wire-up).
- **Single PR. Stop and raise if scope expands.**

---

## Out of scope

- Restyling audit mode itself (table layout, row height, etc.).
- Touching the orange QR state (`body.status-orange` stays exactly as v5.7.1g shipped it).
- Worker changes.
- Touching the v5.5.12 / v5.5.13 offline indicator or queue.
- The customization-panel image-vs-pattern split (separate brief: `v5.7.1m`).

---

## Why this matters

The dashboard runs on the door staff's tablet at busy events. The current tap targets work for desktop testing but get unreliable when staff are gloved, in motion, or working through their fifth hour. Mobile-friendly button sizing is one of those changes that costs nothing and removes a tier of micro-frustration that adds up. Same for the gateway screens: an attendee approaching the door wants instant visual confirmation of their status, and "instant" means visible from arm's length without squinting.

The audit-mode refresh button closes a small papercut: the airport-board view is otherwise self-sufficient, but staff have no way to pull fresh data without exiting fullscreen and re-entering. One tap, one button, one less reason to leave the view.

---

— Number One, drafted for Mr. Data, 9 May 2026.
