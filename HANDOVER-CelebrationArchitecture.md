# HANDOVER — Celebration architecture: own settings + Vibrant Palette toggles

**Drafted:** 11 May 2026 late morning, by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid` (live repo).
**Priority:** Medium. Architecture change to give Celebration animation its own settings (decoupled from Background), expand the celebration mode dropdown to 10 accept + 5 deny variations (Captain's "more options more good"), and add a Vibrant Palette toggle to both Background AND Celebration panels.

**Land AFTER `v5.9.0.13` Settings visual polish** — that brief removes the duplicator buttons that this brief assumes are gone.

---

## Context

Captain's been refining Settings. After the visual polish (v5.9.0.13: halo-only celebrations, preview placement, duplicator removal, grid dot fix), the architecture changes here add new state surface.

Today the celebration animation shares:
- The mode dropdown shape with Background (off / glow / page / pattern)
- The `--theme-cycle-1..7` palette CSS variables (driven from `theme.palette` which the Celebration palette swatches in Settings set)
- The `--theme-cycle-anim-duration` CSS variable

What Captain wants:
1. **Celebration gets its own controls** — own mode dropdown with 10 accept + 5 deny variations, own palette (already exists as a separate field — `theme.palette` vs `theme.bgPalette`), own duration slider.
2. **Vibrant Palette toggle on BOTH Background and Celebration panels** — a boolean that switches the panel's palette between a "muted" and "vibrant" curated set, OR can be left manual when the user wants to pick exact colours. Mockup from Captain's screenshot shows it below Alpha cycle on the Background panel; mirror it on Celebration.

---

## Goal

Two new settings surfaces (Celebration mode dropdown expanded; Vibrant Palette toggles), full state persistence through `portalState` → `settings_json` → Worker, backward-compat with existing saved theme data (don't break the live orgs that already have a `cycleMode` of `'glow' | 'page' | 'pattern' | 'off'`).

---

## Items in detail

### Item A: Celebration mode dropdown — 10 accept variations

Replace the existing 4-value dropdown (`Off / Page cycle / QR glow halo / Pattern flash`) with a 10-value dropdown. All "on" values are halo-shaped per Captain's directive (v5.9.0.13 strips the non-halo visuals). Mode names + behaviours:

| Value | Label | Description |
|---|---|---|
| `off` | Off (no celebration) | Silent. No animation. |
| `halo_subtle` | Subtle halo | Soft palette glow around QR. 1.4s. |
| `halo_normal` | Normal halo (default) | Medium-intensity halo. The v5.9.0.13 default. 1.4s. |
| `halo_vivid` | Vivid halo | Louder spread + saturation. 1.4s. |
| `beacon` | Beacon flash | Single bright halo flash + scale pulse. 0.6s. |
| `slow_pulse` | Slow pulse | Breathing halo over 2.5s. Ambient venues. |
| `rainbow` | Rainbow cycle | Halo cycles through all 7 palette stops in 1.4s. |
| `centre_pulse` | Centre pulse | Radial pulse from QR centre outward. 1.0s. |
| `outer_ring` | Outer ring | Animated ring around QR border only (no fill glow). 1.2s. |
| `halo_scale` | Halo + scale | Halo with brief 1.05× QR scale pulse. 1.4s. |

Each "on" mode needs its own CSS class (e.g. `.cycle-mode-halo-subtle`, `.cycle-mode-beacon`, etc.) with keyframes designed to meet the door-distance-visibility bar from your v5.9.0.10 work. Reuse the palette + duration CSS variables.

**Backward compat:**
- Legacy stored value `'glow'` → migrate to `'halo_normal'` on load.
- Legacy stored value `'pattern'` → migrate to `'halo_vivid'` (the closest "loud" option).
- Legacy stored value `'page'` → migrate to `'rainbow'`.
- Legacy stored value `'off'` stays.

Migration is one-way (read → translate → use the new value). When the user saves, the new value goes to the Worker.

Default for new orgs / no value: `'halo_normal'`.

### Item B: Celebration mode dropdown — 5 deny variations

A NEW separate deny mode dropdown on the Celebration Animation panel (currently deny mode is hardcoded to "vivid red"). Values:

| Value | Label | Description |
|---|---|---|
| `off` | Off (no deny animation) | Silent on rejection. |
| `pulse_subtle` | Subtle red pulse | Soft red glow. 0.6s. |
| `pulse_vivid` | Vivid red flash (default) | Strong red burst (v5.9.0.13's halo-shaped deny). 0.8s. |
| `quick_shake` | Quick shake | Red flash + screen-shake of QR. 0.6s. |
| `deny_tattoo` | Deny tattoo | 3 quick red pulses in sequence. 1.0s total. |

CSS classes follow same pattern: `.deny-mode-pulse-subtle`, `.deny-mode-quick-shake`, etc.

Default: `'pulse_vivid'`.

Persist as `theme.denyMode` in settings_json. New field — no migration needed for existing orgs (they'll get the default).

### Item C: Vibrant Palette toggles (Background + Celebration)

Two new boolean toggles in Settings:

**Background panel** (mockup from Captain's screenshot):
- Label: "Vibrant Palette"
- Position: below "Alpha cycle" toggle in the Background Animation panel
- When ON: use a curated saturated colour set for `theme.bgPalette` (replaces whatever's currently in bgPalette).
- When OFF: use a curated muted/desaturated colour set for `theme.bgPalette`.
- When the user manually picks palette colours (via the existing palette swatch UI), it's neither vibrant nor muted — it's `custom`. The toggle should become indeterminate visually, OR show a third state "Custom". Pick the cleaner UX call.

**Celebration panel** (mirror):
- Label: "Vibrant Palette"
- Position: below the cycle duration slider, before the Preview buttons
- Same three states (Vibrant / Muted / Custom) applied to `theme.palette` (the Celebration palette).

Curated palettes (suggestions — your design call):

```javascript
const VIBRANT_PALETTE = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#5856D6', '#AF52DE'];
const MUTED_PALETTE   = ['#A85A55', '#A87A40', '#B0A050', '#5F9070', '#5A8585', '#7068A0', '#876090'];
```

Persist as `theme.bgPaletteMode` (`'vibrant' | 'muted' | 'custom'`) and `theme.paletteMode` (same values). Default for new orgs: `'vibrant'` on both.

Worker validator: add `bgPaletteMode` and `paletteMode` to the theme allow-list. Enum values: `vibrant | muted | custom`.

### Item D: Full state persistence

All new fields:
- `theme.cycleMode` (existing — values expanded from 4 to 10)
- `theme.denyMode` (NEW)
- `theme.bgPaletteMode` (NEW)
- `theme.paletteMode` (NEW)

Should flow through `applyThemeVars`, `writeThemeToUI`, `normalizeThemeForSave`, the Settings panel collect/restore paths, and the Worker's theme allow-list.

Backward compatibility:
- Existing orgs without these new fields get the defaults.
- Existing `cycleMode` values get migrated per Item A.

---

## Acceptance checklist

- [ ] Celebration Mode dropdown shows 10 accept values + "Off" — all 10 produce visibly distinct, halo-shaped animations.
- [ ] Deny Mode dropdown (NEW) shows 5 values + "Off" — all 5 produce visibly distinct red-shifted animations.
- [ ] Vibrant Palette toggle on Background panel switches `theme.bgPalette` between curated vibrant and muted sets. Manual palette edits set state to "custom".
- [ ] Vibrant Palette toggle on Celebration panel does the same for `theme.palette`.
- [ ] All four new fields (`cycleMode` expanded, `denyMode`, `bgPaletteMode`, `paletteMode`) persist through Save → reload → confirm round-trip via the lost-fields verifier.
- [ ] Worker validator accepts the new fields (added to `validateTheme` enum/allow-list).
- [ ] Legacy `cycleMode` values (`glow`, `page`, `pattern`) migrate correctly on load.
- [ ] Preview Celebration button (placed adjacent to its Preview chip per v5.9.0.13) fires the currently-selected mode's animation on the preview chip.
- [ ] Preview Deny button (placed adjacent) fires the currently-selected deny mode.
- [ ] No regression on production check-in firing: `triggerAcceptCycleAnimation()` and `triggerDenyCycleAnimation()` still hit `#venueQRWrap` with the right CSS class per mode.

---

## Pill bump

`v5.9.0.13 → v5.9.0.14` (assuming v5.9.0.13 Settings visual polish lands first).

---

## Out of scope

- DO NOT add sound options.
- DO NOT add new palette-picker UI (the existing swatch UI is preserved).
- DO NOT change `triggerAcceptCycleAnimation` / `triggerDenyCycleAnimation` interfaces — they still take the active mode from `activeTheme.cycleMode` / `activeTheme.denyMode`.
- DO NOT change Background animation modes (still off / glow / page / pattern with bg-prefix as today). This brief is celebration + palette only.
- DO NOT touch the Org Terms field — that's done.
- DO NOT touch check-in routing, doorman flow, or any non-Settings code paths.

---

## PR title

`[codex] v5.9.0.14 — Celebration architecture: 10 accept + 5 deny modes, Vibrant Palette toggles on both panels`

Branch: `codex/v5.9.0.14-celebration-architecture-vibrant-palette`.

Expected PR scope: Large (~400-700 lines across CSS keyframes for 10 new accept + 5 new deny modes, Settings UI for new toggles + expanded dropdowns, persistence plumbing for 3 new fields, Worker validator update, migration logic for legacy values).

Single PR. Stop and raise if scope expands.

---

— Number One, 11 May 2026 late morning watch.
