# HANDOVER — `v5.7.1j` Mobile Dashboard Reshape (Audit-as-Primary)

**Drafted:** 9 May 2026 morning, by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid-TestEnvironment` only.
**Priority:** Independent of `v5.5.13` and `v5.7.1k`. Can ship in parallel with either.

---

## Context (read this first)

Mid-watch on 8 May, Captain flagged that the Expected attendee management panel on mobile is cramped: list and Add form crammed into a narrow viewport with small tap targets. Initial brief was going to be *"list at top, Add below, larger buttons"*.

On 9 May morning Captain pushed the design further with the right question: *"Why did we have Attendance Today here, could the Audit button serve the same purpose?"*

He's right. The Audit button (shipped in `v5.7.1h`) already gives the airport-board view: fullscreen, landscape, big rows, no chrome. It's the better surface for "show me who's at this event right now". Meanwhile, the Dashboard panel's inline Attendance Today table is cluttered on mobile (horizontal scroll, squeezed columns, crowded action buttons). **Why have both on phones?**

This brief reshapes the Dashboard panel for mobile around the Audit-as-primary principle: hide the inline Attendance Today on phones, give the Audit button prominent placement, and dedicate the freed real estate to the Expected attendee management surface where staff actually work.

---

## Goal

When `OrgCheckin.html`'s viewport is ≤640px wide:

1. **Attendance Today panel — hidden.** Staff who want to see attendees tap the prominent "View Attendance Board" button (described below), which calls the existing `enterAuditMode()`.
2. **Stats cards — compressed.** 2×2 grid instead of 1×4 horizontal row. Smaller numbers, smaller labels.
3. **"View Attendance Board" button — prominent.** Full-width call-to-action below the stats cards. Same visual weight as a primary action button. Calls `enterAuditMode()` directly. Replaces the topbar `⛶ Audit` button on mobile (which is too small a tap target on phones).
4. **Process attendee scan — primary expander.** Default-expanded on phones (currently default-collapsed).
5. **Expected attendee management — restructured.**
   - List at top, filling the available vertical space (max-height: 60vh, scrollable).
   - Add attendee form below, with chunky inputs (min-height: 48px) and a chunky submit button (min-height: 56px).
   - Role dropdown larger and easier to tap.
6. **Developer diagnostics expander — hidden on mobile** (it's a dev-only surface; phones aren't where you'd use it).
7. **Viewing-as Role dropdown — hidden on mobile** (same reasoning; prototype-only affordance, surfaces in desktop).

When viewport > 640px (desktop / tablet), behaviour is unchanged from today.

---

## Files to modify

### `IRLid-TestEnvironment/OrgCheckin.html`

**Add a "View Attendance Board" button** in the Dashboard panel, between the stats cards and the Attendance Today panel. Markup:

```html
<button type="button" class="view-board-btn" id="viewBoardBtn" hidden>
  <span class="view-board-icon">⛶</span>
  <span class="view-board-label">View Attendance Board</span>
</button>
```

JS to wire it up (place near existing audit-mode helpers):

```javascript
// v5.7.1j — On mobile, the inline Attendance Today panel is hidden in
// favour of a prominent "View Attendance Board" button that enters audit
// mode directly. This is the better surface for the airport-board view
// at the door.
function syncMobileBoardButton() {
  const btn = document.getElementById('viewBoardBtn');
  if (!btn) return;
  btn.hidden = window.innerWidth > 640;
}
document.getElementById('viewBoardBtn')?.addEventListener('click', enterAuditMode);
window.addEventListener('resize', syncMobileBoardButton);
document.addEventListener('DOMContentLoaded', syncMobileBoardButton);
```

**Add a single CSS block** near the existing escalation-modal mobile rules (around line ~325). Use the `@media (max-width: 640px)` breakpoint that's already established:

```css
@media (max-width: 640px) {
  /* v5.7.1j — Mobile dashboard reshape: hide Attendance Today in favour
     of the View Attendance Board button → audit mode. */
  body[data-active-panel="dashboard"] #attendanceTodayPanel,
  body[data-active-panel="dashboard"] #developerDiagnostics,
  body[data-active-panel="dashboard"] #prototypeRoleSelect-wrap,
  body[data-active-panel="dashboard"] .topbar-action-audit {
    display: none !important;
  }

  /* Stats cards 2x2 grid instead of 1x4 row. */
  body[data-active-panel="dashboard"] .stats-grid {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  body[data-active-panel="dashboard"] .stats-grid .stat-card {
    padding: 12px;
  }
  body[data-active-panel="dashboard"] .stats-grid .stat-value {
    font-size: 32px;
  }

  /* Prominent View Attendance Board button. */
  .view-board-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    margin: 16px 0 20px;
    padding: 18px 16px;
    background: var(--accent, #2563eb);
    color: #fff;
    border: none;
    border-radius: 10px;
    font: 700 16px/1.2 system-ui, sans-serif;
    cursor: pointer;
    min-height: 56px;
  }
  .view-board-btn:active {
    transform: scale(0.98);
  }
  .view-board-icon { font-size: 20px; }

  /* Process attendee scan — default expanded on phones. */
  body[data-active-panel="dashboard"] details#processScanExpander {
    /* Mr. Data: open this <details> by default on mobile by setting the
       open attribute in JS on first DOMContentLoaded if window.innerWidth <= 640. */
  }

  /* Expected attendee management reshape. */
  body[data-active-panel="dashboard"] #expectedAttendeeManagement .expected-list {
    max-height: 60vh;
    overflow-y: auto;
    margin-bottom: 16px;
  }
  body[data-active-panel="dashboard"] #expectedAttendeeManagement .expected-add-form {
    display: grid;
    gap: 12px;
  }
  body[data-active-panel="dashboard"] #expectedAttendeeManagement input[type="text"] {
    min-height: 48px;
    font-size: 16px; /* prevents iOS zoom-on-focus */
    padding: 12px 14px;
  }
  body[data-active-panel="dashboard"] #expectedAttendeeManagement select {
    min-height: 48px;
    font-size: 16px;
    padding: 12px 14px;
  }
  body[data-active-panel="dashboard"] #expectedAttendeeManagement .add-btn {
    min-height: 56px;
    font-size: 16px;
    font-weight: 700;
  }
}
```

**Default-expand Process scan on phones.** Add to the existing `DOMContentLoaded` init block:

```javascript
// v5.7.1j — On phones, default-expand the Process scan expander.
if (window.innerWidth <= 640) {
  document.getElementById('processScanExpander')?.setAttribute('open', '');
}
```

**Note on existing element IDs:** the brief assumes IDs like `attendanceTodayPanel`, `developerDiagnostics`, `processScanExpander`, `expectedAttendeeManagement`. If those don't exist verbatim, locate the corresponding elements by their existing class or context and add the IDs as part of this PR. Don't refactor surrounding markup beyond adding the IDs needed for the selectors above.

---

## Acceptance checklist

- [ ] On a viewport ≤640px wide (Chrome DevTools mobile emulation: Pixel 8 Pro), the Dashboard panel:
  - [ ] Stats cards render in a 2×2 grid.
  - [ ] "View Attendance Board" button is visible and full-width below the stats.
  - [ ] Tapping the button enters audit mode (fullscreen + landscape, attendance table visible).
  - [ ] Attendance Today panel is HIDDEN.
  - [ ] Developer diagnostics expander is HIDDEN.
  - [ ] Viewing-as Role dropdown is HIDDEN.
  - [ ] Topbar `⛶ Audit` button is HIDDEN (the View Board button replaces it on mobile).
  - [ ] Process attendee scan expander is OPEN by default.
  - [ ] Expected attendee management list scrolls within max-height 60vh.
  - [ ] Add attendee form has chunky inputs (≥48px tall) and a chunky submit button (≥56px tall).
- [ ] On a viewport >640px wide (desktop, tablet landscape), behaviour is UNCHANGED from today: Attendance Today panel visible inline, stats horizontal, Audit button in topbar, Developer diagnostics + Viewing-as visible.
- [ ] Tapping "View Attendance Board" on mobile, then tapping "↩ Exit audit", returns to the mobile Dashboard panel with all the mobile rules still applied.
- [ ] No regression on the v5.5.12 offline indicator (still bottom-left, still pulses red, still shows queue depth badge).
- [ ] No regression on `v5.7.1g` six-bug polish (Refresh button feedback, F5 api_key preservation, etc).

---

## Branch & PR shape

- **Branch:** `codex/v5.7.1j-mobile-dashboard-reshape`
- **PR title:** `[codex] v5.7.1j — mobile dashboard reshape (audit-as-primary)`
- **Expected PR scope:** Medium (~150-200 lines new/modified — mostly CSS in one media query block + a small JS helper + one button markup addition + one default-expand line).
- **Single PR. Stop and raise if scope expands.**

---

## Out of scope

- **Tablet-specific layout** (641px–1024px viewport). Use the existing desktop behaviour for now. A separate brief can address tablet-portrait specifically if Captain raises it.
- **Re-styling the audit-mode view itself.** That ships in `v5.7.1h` and is verified on hardware.
- **Changing the Expected list's row markup** (just the container reshape).
- **Adding new tabs or panels** beyond the View Attendance Board button.
- **Touching the Worker.**

---

## Why this matters

The Captain's instinct is right: the dashboard at the door is operationally just two things — *"who's here"* (the attendance board) and *"someone new just arrived"* (Process scan + Expected management). The desktop layout exposes both inline because there's room. The phone layout doesn't have room, and the existing v5.7.1h Audit button already nails the *"who's here"* surface. Demoting the inline table to a one-tap audit-mode entry frees the phone screen for the *"someone new just arrived"* workflow, which is where staff actually act.

Net effect: a phone-wielding doorman has one prominent button to see the board, one prominent expander to process a scan, and a chunky list-and-form to add or check Expected attendees. The cluttered desktop view doesn't survive the squeeze to phone width — the audit-mode button does.

---

— Number One, drafted for Mr. Data, 9 May 2026.
