# HANDOVER — `v5.7.1v` Mobile Sweep — Customization Panel + Remaining Gaps

**Drafted:** 9 May 2026, by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid-TestEnvironment` only.
**Priority:** Independent of all other in-flight work. Can ship in parallel.

---

## Context (read this first)

`v5.7.1k` (your PR #100, just merged) shipped site-wide 44×44 px touch target floors via `@media (max-width: 640px)` for buttons in the topbar, attendance rows, Process scan, Expected management. That covers the day-to-day staff dashboard surfaces.

Captain's follow-up directive 9 May afternoon: *"make everything mobile friendly"*. The remaining gap is the **Settings → Theming customization panel** — color wheels, palette swatches with delete buttons, mode dropdowns, sliders, upload inputs, Save buttons. Many of these compute below 44 px on phones today. This brief closes that gap and any other mobile-unfriendly surfaces you find while you're in there.

---

## Goal

When `OrgCheckin.html`'s viewport is ≤640 px wide, every interactive element in the Settings panel (Theming + any other Settings sub-section) hits WCAG 2.1 AA touch-target minimums (44×44 px). Form inputs use 16 px font (prevents iOS auto-zoom on focus). Color wheels stack vertically instead of side-by-side. Palette swatch delete buttons (the small `×` overlays) become chunky enough to tap reliably with a thumb.

Existing mobile rules from `v5.7.1k` are unchanged; this PR adds parallel rules for the Settings panel surface.

---

## Files to modify

### `IRLid-TestEnvironment/OrgCheckin.html`

Add a new `@media (max-width: 640px)` block scoped to the Settings panel surface. Place near the existing `v5.7.1k` mobile button rules.

```css
/* v5.7.1v — Mobile sweep for the Settings → Theming customization panel.
   Captain's "make everything mobile friendly" follow-up after v5.7.1k.
   The dashboard surfaces got 44×44 mobile touch targets in v5.7.1k;
   this extends the same discipline to the Settings panel where the
   customization controls live (color wheels, palettes, sliders, form
   inputs). WCAG 2.1 AA Success Criterion 2.5.5 across the whole UI. */
@media (max-width: 640px) {
  /* === Color wheel stacking === */
  /* Three color wheels (Primary / Accent / QR foreground) sit side-by-side
     on desktop. On phones, stack vertically so each gets full width and
     the touch surface is comfortable. */
  body[data-active-panel="settings"] .theme-colour-grid,
  body[data-active-panel="settings"] .grid-colours,
  body[data-active-panel="settings"] .colour-wheel-row {
    grid-template-columns: 1fr !important;
    gap: 24px !important;
  }
  /* (Locate the actual class wrapping the three color wheels — likely
     `.theme-colour-grid` or similar around line 2200-2300. Update the
     selector list to match.) */

  /* === Hex input fields under each color wheel === */
  body[data-active-panel="settings"] input[type="text"][id^="theme"],
  body[data-active-panel="settings"] input[type="text"].hex-input {
    min-height: 48px;
    font-size: 16px; /* prevents iOS zoom-on-focus */
    padding: 12px 14px;
  }

  /* === Palette swatch delete buttons (the small × overlays) === */
  body[data-active-panel="settings"] .palette-swatch-delete,
  body[data-active-panel="settings"] .swatch-x,
  body[data-active-panel="settings"] [class*="swatch"] button {
    min-width: 28px;
    min-height: 28px;
    /* The swatch itself is ~40×40; the × overlay sits top-right. Bump it
       from typical ~16×16 to 28×28 so it's tappable without zoom-pinch. */
  }

  /* === Palette + Add colour button === */
  body[data-active-panel="settings"] .palette-add-btn,
  body[data-active-panel="settings"] button[id*="AddColour"],
  body[data-active-panel="settings"] button[id*="addColour"] {
    min-height: 44px;
    min-width: 44px;
    padding: 10px 14px;
    font-size: 14px;
  }

  /* === Mode dropdowns (Background mode, Image position, Pattern, etc) === */
  body[data-active-panel="settings"] select.theme-anim-select,
  body[data-active-panel="settings"] select[id^="theme"] {
    min-height: 48px;
    font-size: 16px;
    padding: 12px 14px;
  }

  /* === Cycle duration sliders === */
  body[data-active-panel="settings"] input[type="range"] {
    height: 44px; /* touchable thumb hit area */
  }
  body[data-active-panel="settings"] input[type="range"]::-webkit-slider-thumb {
    width: 28px;
    height: 28px;
  }
  body[data-active-panel="settings"] input[type="range"]::-moz-range-thumb {
    width: 28px;
    height: 28px;
  }

  /* === Upload image input + label === */
  body[data-active-panel="settings"] input[type="file"] {
    min-height: 44px;
    font-size: 16px;
  }

  /* === Toggle switches (Bio-metric Required / Privacy Mode / etc) === */
  body[data-active-panel="settings"] .switch-wrap,
  body[data-active-panel="settings"] label[for*="tog"],
  body[data-active-panel="settings"] .toggle-row {
    min-height: 44px;
    padding: 8px 0;
  }

  /* === Save All Settings + Save theme buttons === */
  body[data-active-panel="settings"] #saveAllSettingsBtn,
  body[data-active-panel="settings"] #themeSaveBtn,
  body[data-active-panel="settings"] .theme-actions button,
  body[data-active-panel="settings"] .settings-actions button {
    min-height: 48px;
    padding: 12px 18px;
    font-size: 15px;
    font-weight: 700;
  }

  /* === Reset to defaults buttons === */
  body[data-active-panel="settings"] button[id*="Reset"],
  body[data-active-panel="settings"] button[id*="reset"] {
    min-height: 44px;
    padding: 10px 14px;
  }

  /* === Form inputs throughout Settings (branding URLs, welcome message, etc) === */
  body[data-active-panel="settings"] input[type="text"],
  body[data-active-panel="settings"] input[type="url"],
  body[data-active-panel="settings"] input[type="email"],
  body[data-active-panel="settings"] textarea {
    min-height: 48px;
    font-size: 16px;
    padding: 12px 14px;
  }

  /* === Section headings spacing on mobile (avoid cramped layout) === */
  body[data-active-panel="settings"] .settings-section h3,
  body[data-active-panel="settings"] .settings-section h4 {
    margin-top: 24px;
    margin-bottom: 12px;
  }
}
```

### Selector verification

The class names above are best-guesses based on grep results. Before shipping, locate the actual class names by inspecting the DOM in DevTools:

1. Open Settings panel in `OrgCheckin.html`.
2. Inspect each interactive element (color wheel container, swatch × button, palette Add button, mode dropdown, slider, upload input, toggle, Save button).
3. Note the actual class / id names.
4. Update the selector list above to match exactly.

**Do NOT add CSS for selectors that don't exist** — would be dead code. Trim the rule list to what actually matches.

---

## Acceptance checklist

- [ ] On Chrome DevTools mobile emulation (Pixel 8 Pro, 412×915) → Settings panel:
  - [ ] Color wheels (Primary / Accent / QR foreground) stack VERTICALLY, not side-by-side.
  - [ ] Each hex input field below the wheels is at least 48 px tall, 16 px font (no iOS zoom on focus).
  - [ ] Background palette swatches' delete `×` buttons are at least 28×28 px and tappable without pinch-zoom.
  - [ ] `+ Add colour` buttons are at least 44×44 px.
  - [ ] Background mode / Image position / Pattern dropdowns are at least 48 px tall.
  - [ ] Cycle duration sliders have a thumb at least 28×28 px (visibly chunkier on touch).
  - [ ] Upload image input is at least 44 px tall, 16 px font.
  - [ ] Bio-metric Required, Privacy Mode, Anonymous Mode toggle rows are at least 44 px tall.
  - [ ] Save All Settings + Save theme buttons are at least 48 px tall.
  - [ ] Reset to defaults buttons are at least 44 px tall.
  - [ ] Branding URL inputs + Custom welcome message textarea are at least 48 px tall, 16 px font.
- [ ] On desktop viewport (>640 px), Settings panel layout is UNCHANGED from before this PR (color wheels still side-by-side, all sizing as before).
- [ ] No regression on existing v5.7.1k mobile rules (topbar buttons, attendance row buttons, Expected management).
- [ ] No regression on the v5.7.1m / m.1 customization functionality (background modes, positions, alpha cycle still work).

---

## Branch & PR shape

- **Branch:** `codex/v5.7.1v-mobile-sweep-customization`
- **PR title:** `[codex] [M] v5.7.1v — mobile sweep for customization panel`
- **Expected PR scope:** Medium (~100–180 lines new CSS in one media-query block, plus selector verification commits if any element class names need updating from the brief's best-guesses).
- **Single PR. Stop and raise if scope expands.**
- **Build pill bump:** include `v5.7.1u → v5.7.1v` in the same commit per BOOTSTRAP §4 discipline (the `.sidebar-footer` div around line 2045 of `OrgCheckin.html`).

---

## Out of scope

- Restyling the Settings panel layout (just sizing).
- Touching the third-party iro.js color wheel widget itself (only the wrapper layout).
- Worker changes.
- The v5.7.1.x logo contrast bug (separate diagnostic queued).

---

## Why this matters

The Settings panel is where venue staff configure their event branding, palettes, theming, gates, and policies — typically once per event setup. Doing that on a phone today means pinch-zooming to hit small targets, struggling with sliders, fighting iOS auto-zoom on input focus. Half an hour of CSS work removes a tier of friction that compounds whenever a venue manager sets up an event from their phone (which is most non-laptop-equipped operators).

This is the last big mobile-friendliness gap before the v5.9 live port. After this PR ships, the test env meets the WCAG 2.1 AA touch-target standard end-to-end, ready to carry the same discipline into live deployment.

---

— Number One, drafted for Mr. Data, 9 May 2026.
