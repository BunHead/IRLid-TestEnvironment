# HANDOVER — Settings panel visual polish pass

**Drafted:** 11 May 2026 late morning, by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid` (live repo).
**Priority:** Medium. Captain's been iterating on Settings and surfaced five distinct visual issues. None are functional bugs — all are "looks off / placement wrong / not visually clean enough for prime time" findings. Cluster them into one PR.

---

## Context

After your v5.9.0.10 (celebration overhaul) and v5.9.0.12 (white-background halo fix), the core animation is working — Captain confirmed "Loving the animation on recognised an attendee". But across Settings he wants a polish pass:

1. **Celebration → halo only.** Your v5.9.0.12 added pattern bands / diagonal stripes that overlay the QR. Captain wants those removed. Keep the halo (the palette glow around the QR) — that's the win. Lose the stripes, bands, and overlay rings that sit on top of the QR pixels.
2. **Remove the BG↔CEL duplicator arrows.** The two arrow buttons (`themeDupBgToCel` and `themeDupCelToBg`) between Background and Celebration panels. Captain decided they're no longer wanted now that Celebration is getting its own settings (separate brief).
3. **Preview Celebration / Preview Deny animate in the wrong place.** Captain reports they're animating "over/behind the QR at the bottom of the screen (in panel with sample button)" — the bottom Sample-button/Sample-badge/demo-QR strip. They should animate **adjacent to their own buttons**, or on a small dedicated preview chip directly next to each Preview button — not down on the bottom-page demo QR area.
4. **Image position grid dot animation still imperfect.** The 3×3 Image position picker with Outer/Centre/Inner anchor segmented control was added in `v5.7.1w` but the dot-travel inside each cell is "still cosmetically subtle" per `memory/pending-work.md` from 10 May. Captain wants it visibly correct: when Outer is selected, dots should travel to the cell edges; Centre = middle; Inner = closer to centre with proportional offset. Currently the visual feedback is too understated.
5. **Broader styling audit — clear, clean, functional.** Captain's verbatim direction. Look across the Settings panel for inconsistencies: label alignment, spacing rhythm, button styles, section hierarchy. Tidy any obvious rough edges.

---

## Goal

One PR landing all five items as a cohesive visual polish pass on Settings. Strict CSS / DOM rearrangement scope — no JS contract changes, no Worker changes, no persistence-layer changes.

---

## Items in detail

### Item 1: Celebration halo only

Find the CSS classes you wrote in v5.9.0.10 / v5.9.0.12 that produce the diagonal-stripe pattern overlays on `cycle-burst-pattern` (and the `cycle-deny-burst` deny bands). Remove or simplify the pseudo-elements so only the halo (palette-coloured outer glow + ring sweep) remains for the default modes. Captain liked the colour palette + the ring sweep around the venue QR; that's what should stay. Pattern bands at lines ~2447-2456 (deny bands) and similar accept-side rules go.

Specifically what Captain wants gone (looking at the screenshot evidence):
- The diagonal red/orange/yellow stripes layered ACROSS the QR pixels.
- The repeating-linear-gradient overlays.
- Anything that obscures the QR content during the animation.

What stays:
- The palette-coloured halo / box-shadow around the QR perimeter.
- The ring sweep animation just outside the QR border (the conic-gradient ring effect, if it sits OUTSIDE the QR rather than overlaying it).
- The deny variant should also be halo-shaped (red palette glow), not stripe-bands.

If a clean halo-only deny visual is unobvious, default to: a brief red box-shadow pulse, sharper and shorter than accept. No bands.

### Item 2: Remove BG↔CEL duplicator arrows

Two buttons in the markup around line ~2920-2924:

```html
<div class="theme-anim-duplicators grid-dups" aria-label="Duplicate all settings between Background and Celebration">
  <button type="button" class="dup-btn" id="themeDupBgToCel" ...>→</button>
  <button type="button" class="dup-btn" id="themeDupCelToBg" ...>←</button>
</div>
```

Delete the entire `<div class="theme-anim-duplicators grid-dups">` block, plus any associated JS event handlers wired in the script section (search for `themeDupBgToCel` / `themeDupCelToBg`). Remove the CSS for `.theme-anim-duplicators` and `.dup-btn` if those classes are only used here.

### Item 3: Preview button placement

Currently `previewAcceptCycle()` and `previewDenyCycle()` trigger animations on `#themePreviewQrCycle` AND fire `triggerAcceptCycleAnimation()` / `triggerDenyCycleAnimation()` which target the venue QR AND the fullscreen overlay AND the legacy scan-panel sites. The legacy targets include `.scan-panel` and `.checkin-success-overlay` which may be the "bottom Sample/QR area" Captain's seeing.

Two parts to this fix:

**(a)** Find `#themePreviewQrCycle` — the small dedicated preview chip. Make sure it's positioned **immediately next to** the Preview Celebration and Preview Deny buttons (not somewhere else on the page). Probably needs to live inside the Celebration Animation panel, adjacent to or below the Preview buttons.

**(b)** When user clicks Preview, the animation should fire on `#themePreviewQrCycle` ONLY — not also on the venue QR, the legacy scan-panel sites, or the bottom Sample area. The Preview is for tuning the look; it shouldn't ALSO trigger the real animation. (This decouples preview from production hooks. Production fires on real check-ins via the existing `triggerAcceptCycleAnimation` hook calls — that's unchanged.)

Update `previewAcceptCycle()` and `previewDenyCycle()`:

```javascript
function previewAcceptCycle() {
  const mode = (activeTheme && activeTheme.cycleMode) || 'glow';
  if (mode === 'off') return;
  const previewClass = mode === 'page' ? 'cycle-burst-page'
    : mode === 'pattern' ? 'cycle-burst-pattern'
      : 'cycle-accept-glow';
  triggerCycleClassOnTargets([document.getElementById('themePreviewQrCycle')], previewClass, acceptCycleMs());
  // v5.9.0.13 — removed triggerAcceptCycleAnimation() call. Preview only fires
  // on the local preview chip; the real animation only fires from production
  // check-in success paths. Captain's directive: preview button feedback
  // shouldn't trigger animations across the whole page.
}

function previewDenyCycle() {
  triggerCycleClassOnTargets([document.getElementById('themePreviewQrCycle')], 'cycle-deny-burst', denyCycleMs());
  // v5.9.0.13 — see previewAcceptCycle: preview is local-only.
}
```

### Item 4: Image position grid dot travel

The 3×3 grid in the Background Animation panel has cells representing the 9 image-position options. Each cell has a dot that should visibly travel based on the Outer/Centre/Inner anchor selection. From `memory/pending-work.md`:

> position grid's anchor function works correctly (changing Outer/Centre/Inner does shift the actual background image on the page), but the visual feedback dot inside the active cell only travels partway — it animates toward the cell centre rather than reaching the visual extreme expected. Functional, just imperfect feedback. ... Likely fix involves either making cells larger again, increasing the active-state dot size, or recalibrating the percentage offsets to use bigger steps (e.g. Outer at 10% / Centre at 30% / Inner at 50% instead of the current 4px / 33% / 50%).

Captain wants this fix landed. Pick the recalibration approach (third option) — adjust the percentage offsets so the dot visibly moves to clear positions: Outer = within 8-12% of cell edge, Centre = exact middle (50%), Inner = ~30% from edge / 70% from centre. Bump dot size if needed for visibility (4-6px → 8-10px).

### Item 5: Broader styling audit

Look across the Settings panel — Branding section, Theme section, Background Animation panel, Celebration Animation panel, Sample button strip at the bottom. Captain's bar: "clear, clean, functional". Likely candidates for tidy:

- Label alignment (all labels should align consistently in their grids)
- Spacing rhythm (consistent vertical spacing between settings groups)
- Section heading hierarchy (h3 / h4 / h5 should be visually distinct)
- Button styles (Save All Settings, Save theme, Reset to defaults — should look like a cohesive family)
- Helper text consistency (font size + colour for `.theme-hint` style)
- Sample button / Sample badge / demo QR at the bottom — should they even still be there, or are they prototype residue?

Don't add new features. Don't remove functionality. Just shake out the rough edges. If something is unclear about intent, leave it untouched — better to under-deliver here than break Captain's mental model.

---

## Acceptance checklist

- [ ] Celebration accept animation produces ONLY a halo / palette glow + ring sweep around the venue QR — no diagonal stripes, no overlays on the QR pixels.
- [ ] Celebration deny animation is also halo-shaped (red palette), no stripe-bands.
- [ ] BG↔CEL duplicator arrows removed from markup, JS, and CSS.
- [ ] Preview Celebration + Preview Deny animate ONLY on the local `#themePreviewQrCycle` chip (placed adjacent to the Preview buttons), not on the venue QR / fullscreen overlay / bottom Sample area.
- [ ] Image position grid dot travel is visibly clear at each Outer/Centre/Inner setting — dot reaches the visual extremes, not partway.
- [ ] Settings panel feels cohesive — spacing, labels, headings, buttons consistent.
- [ ] Production check-in (phone scans venue QR) still fires the halo on `#venueQRWrap` cleanly. No regression on what's already working.

---

## Pill bump

`v5.9.0.12 → v5.9.0.13`.

---

## Out of scope

- DO NOT touch `triggerAcceptCycleAnimation` / `triggerDenyCycleAnimation` / `cycleBurstTargets` / `triggerCycleClassOnTargets` — those are working.
- DO NOT change the fire sites in `runRecognisedDeviceKeyCheckin` / `runDoormanCheckin` / `manualCheckin`.
- DO NOT add new Settings UI controls — that's a separate brief (Celebration architecture, queued).
- DO NOT touch the Worker.
- DO NOT add sound, confetti, or new celebration variants — separate brief.

---

## PR title

`[codex] v5.9.0.13 — Settings panel visual polish (halo-only, no duplicators, preview placement, position-grid dots, styling audit)`

Branch: `codex/v5.9.0.13-settings-visual-polish`.

Expected PR scope: Medium (~100-250 lines across CSS adjustments, HTML element removal, JS handler removal, dot-position recalibration, audit tweaks).

Single PR. Stop and raise if scope expands beyond these five items.

---

— Number One, 11 May 2026 late morning watch.
