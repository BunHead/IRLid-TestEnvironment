# HANDOVER — Celebration glow not visible on venue QR (white-background contrast issue)

**Drafted:** 11 May 2026 late morning, by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid` (live repo).
**Priority:** Medium-high. Follow-up to your v5.9.0.10 celebration overhaul. Your implementation is correct in code — the targets, JS triggers, keyframes, and CSS variables are all wired properly. **But the visual effect doesn't show on the real venue QR.** Captain verified: Preview Celebration produces a clear halo on the small preview chip in Settings, but a phone scan that fires `triggerAcceptCycleAnimation()` against the actual `#venueQRWrap` on the Check-in panel produces **no visible animation at door distance**. Same problem for Preview Deny — works on the preview chip, doesn't visibly fire on the venue QR.

---

## Context — the diagnosis

The `#venueQRWrap` element contains a `<div class="qr-box">` whose CSS sets `background: #fff` (white). The QR canvas/img inside the qr-box is also predominantly white. Your pseudo-element overlays for `cycle-accept-glow`, `cycle-burst-page`, `cycle-burst-pattern`, and `cycle-deny-burst` use:

```css
mix-blend-mode: screen;
```

`mix-blend-mode: screen` lightens the underlying pixels — perfect for dark backgrounds (the preview chip `#themePreviewQrCycle` is dark, so the halo pops there), but **invisible against white**. Screen blend formula: `result = 1 - (1-base) * (1-blend)`. When `base = 1` (white), `result = 1` regardless of blend value. The overlay literally cannot lighten white.

So the pseudo-element rings + central pulse + deny bands + deny slash that are visually carrying your accept-glow / deny-burst designs go silent against the venue QR's white interior.

Compounding: the **outer box-shadow animation** (`themeAcceptCycle` keyframes lines 1622-1630) extends OUTSIDE the wrap's dark `#0b1220` background into the page's also-dark backdrop. Low contrast → subtle even when firing. Captain reports not seeing it from typical viewing distance.

Result: preview chip = clear halo ✓ ; venue QR = no visible effect ✗.

---

## Goal

Redesign the accept-glow and deny-burst visuals so they're **clearly visible at door distance (~3-5m)** on the **real venue QR with its white interior**, without breaking what already works on the preview chip (dark background) and fullscreen overlay (dark holder).

This is purely a CSS / visual-design problem — your JS trigger logic, keyframe wiring, CSS-variable plumbing, and DOM targets are all correct. Don't change those.

---

## Design constraints

- **Target backgrounds in scope:**
  - `#venueQRWrap` — dark wrap (`#0b1220`) containing a white `.qr-box` with QR canvas inside. **This is the primary visibility surface.**
  - `.irlid-qr-fullscreen.active .irlid-qr-fullscreen-holder` — fullscreen overlay (dark page, white QR centre). **Currently works for preview-style visuals; preserve.**
  - `#themePreviewQrCycle` (Settings preview chip) — small dark-background chip. **Currently works; preserve.**
- **Visibility bar:** an observer at 3-5m distance, glancing at the dashboard's Check-in panel during a check-in event, should immediately know whether the scan was accepted or denied. Halo, ring, pulse, or flash — your design call. Must work over both dark wrap area AND white QR interior.
- **Palette respect:** Continue using `--theme-cycle-1` through `--theme-cycle-7` for accept (org's Celebration palette). Deny can stay red-shifted (the existing `rgba(255, 22, 52, ...)` etc. are fine).
- **Duration respect:** Continue using `--theme-cycle-anim-duration` (default 1.4s for accept; deny is `acceptMs * 0.55` per `denyCycleMs()`).
- **No new DOM elements** — keep using pseudo-elements + CSS classes the way you already did. The fix is in the CSS rules themselves.

---

## Suggested approaches (pick one or combine)

These are starting points — your design judgement is the bar.

### Option A: Drop `mix-blend-mode: screen`, push pseudo-elements OUTSIDE the qr-box

Replace the inset values to position the ::before / ::after **around** the white qr-box rather than overlaying it. They'd render in the dark wrap area where they don't need a blend mode to be visible.

```css
/* current — inside the qr-box */
body #venueQRWrap.cycle-accept-glow::before { inset: clamp(8px, 2.4vw, 28px); mix-blend-mode: screen; ... }

/* proposed — around it, in the dark wrap area */
body #venueQRWrap.cycle-accept-glow::before { inset: -8px; mix-blend-mode: normal; ... }
```

Issue: the qr-box on the Check-in panel grows to fill most of the wrap on small viewports (line 2488 — `width: clamp(190px, ...700px)`). Negative insets might push the pseudo-element outside the visible wrap entirely. Test at multiple viewport sizes.

### Option B: Layer a vivid ring inside the qr-box using non-screen blend modes

Use `mix-blend-mode: multiply` or `mix-blend-mode: difference` instead of screen. Multiply darkens (so a saturated colour multiplied with white = the saturated colour — visible). Difference inverts intensely (very loud, perhaps too loud for a celebration).

### Option C: Boost the box-shadow on the wrap so the OUTER glow alone carries the visual

Drop the pseudo-element overlays as the headline; rely on a much-louder outer box-shadow animation. Larger spread (60-120px), more saturated palette colours, possibly a brief scale pulse on the wrap itself.

### Option D: Two-layer approach — outer ring around wrap + inner solid-colour border on qr-box

Animate the wrap's `box-shadow` AND animate the qr-box's `border` (or `outline`) colour through the palette. Outline doesn't get clipped by overflow:hidden the way ::before sometimes does, and it sits flush against the QR canvas.

---

## Acceptance checklist

- [ ] Captain runs a real check-in (phone scans venue QR) on live; the accept animation is **clearly visible** on `#venueQRWrap` from across the room.
- [ ] Captain runs a denied check-in (or clicks Preview Deny then watches the venue QR); the deny animation is **clearly visible** AND **distinct from accept** (red-shifted, sharper, shorter).
- [ ] Preview celebration in Settings still produces a visible halo on `#themePreviewQrCycle` (don't break what worked).
- [ ] Fullscreen audit-board mode (`⛶ Audit` button) — if a check-in fires while audit is active, the animation should be visible on the fullscreen QR overlay.
- [ ] Light theme (Settings → Interface mode → Light): animations also visible. (Mr. Data may want to add `:root[data-theme="light"]` overrides if the colour palette needs adjustment for light backgrounds.)
- [ ] No regression on existing modes — off/glow/page/pattern dropdown still toggles correctly.

---

## Pill bump

`v5.9.0.11 → v5.9.0.12`. Note pre-bump state may be `v5.9.0.11` (the device_key routing fix that just merged before this brief). If something else has landed, bump from there.

---

## Out of scope

- Don't change `triggerAcceptCycleAnimation`, `triggerDenyCycleAnimation`, `cycleBurstTargets`, or `triggerCycleClassOnTargets` — all working.
- Don't change the fire sites — `flashDoormanPanel('success')` / `flashDoormanPanel('error')` patterns + the v5.9.0.9 hooks are all correct.
- Don't change the Settings panel UI — Preview Celebration / Preview Deny buttons stay.
- Don't change the palette / cycleAnimDuration system.
- Don't add sound, confetti, or DOM-element-spam celebration variants — stay within the existing CSS surface.
- Don't forward-port to test env in this PR — Captain may want to validate on live first, then port.

---

## PR title

`[codex] v5.9.0.12 — Celebration animations visible on venue QR (white-background fix)`

Branch: `codex/v5.9.0.12-celebration-glow-visible-on-venue-qr`.

Expected PR scope: Small-Medium (~50-150 lines of CSS adjustment, possibly a few keyframe updates).

---

— Number One, 11 May 2026 late morning watch.
