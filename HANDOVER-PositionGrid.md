# HANDOVER — `v5.7.1y` Background Image Position Grid (Picker + Anchor)

**Drafted:** 10 May 2026 (Sunday morning watch), by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid-TestEnvironment` only.
**Priority:** Medium. Independent of v5.5.8 work that just shipped. Can ship in parallel with `HANDOVER-V5_9_LivePort.md` (separate brief, separate concern).

---

## Context (read this first)

The Settings → Theming customization panel currently picks the background image position via an 11-option dropdown (`#themeBgImagePosition` at `OrgCheckin.html:2734`). Captain's UX call on 10 May:

> "The 9 part grid would be 9 buttons that allowed the user to choose the position of their background image. If the dots could move inside the individual buttons (apart from the centre), to visualise the anchor, that would be fantastic."

The visual 3×3 grid Captain saw in the panel is just the existing decorative indicator. This brief turns it into the actual input.

Three things change at once:

1. The 11-option dropdown is replaced with a **3-chip mode row** (Position / Tile / Cover) plus, when Position is selected, a **9-button grid** that picks one of the 9 directional positions (4 corners + 4 edges + centre).
2. The previous experimental "float toggle" (commit `0bdcd0b`, currently dangling — see "Retired commit" below) is reborn as an **Outer / Centre / Inner** anchor segmented control. Rotation-invariant: works identically for any of the 8 non-centre positions, regardless of which side they're on.
3. Each non-centre grid button has a **dot** inside it that slides toward / away from the centre when the anchor changes — so the picker visualises what the anchor does.

**Net:** users get a spatial picker that looks like what it does, instead of a verbal dropdown that doesn't.

---

## Retired commit

**Do NOT cherry-pick `0bdcd0b` ("v5.7.1u.1 bg image float toggle") back from the dangling git objects.** That commit added a separate "Anchor: Left/Middle/Right" toggle as a bolted-on control. It was force-pushed off the codex branch on 9 May during PR #101 cleanup and exists only as a dangling object. The float concept is being **reborn as the Outer/Centre/Inner anchor** inside the position grid in this PR. If `0bdcd0b` ever reappears as an option in your tooling, ignore it.

The "Anchor: Left/Middle/Right" naming is also retired — it's confusing for the right-side and bottom buttons (where "Left" can mean the centre direction). The new naming is **Outer / Centre / Inner**:

- **Outer** = the dot sits at the actual edge / corner of the cell. The image sits flush against that edge of the page.
- **Centre** = the dot is half-way between edge and middle. The image is offset ~12.5% inward.
- **Inner** = the dot is at the middle of the cell. The image is offset ~25% inward.

For the centre position, anchor doesn't apply — the anchor row hides itself.

---

## Files to modify

### 1. `IRLid-TestEnvironment/OrgCheckin.html`

#### Replace the existing image-position row (lines 2732–2747)

Current markup (delete this block):

```html
<label class="theme-anim-row" data-bg-mode-show="image">
  <span>Image position</span>
  <select id="themeBgImagePosition" class="theme-anim-select">
    <option value="centre">Centre</option>
    <option value="tile">Tile</option>
    ... (all 11 options)
  </select>
</label>
```

New markup:

```html
<!-- v5.7.1y — Background image position picker.
     Three modes (Position / Tile / Cover) via chip row; when Position is
     active, a 3×3 grid of 9 buttons picks one of the directional positions
     (4 corners + 4 edges + centre). Replaces the previous 11-option
     dropdown with a spatial picker that looks like what it does. -->
<div class="theme-anim-row theme-anim-row--stacked" data-bg-mode-show="image">
  <span>Image position</span>
  <div class="bg-pos-controls">
    <div class="bg-pos-mode-chips" role="tablist" aria-label="Image fit mode">
      <button type="button" class="bg-pos-mode-chip" data-bg-pos-mode="position" aria-pressed="true">Position</button>
      <button type="button" class="bg-pos-mode-chip" data-bg-pos-mode="tile" aria-pressed="false">Tile</button>
      <button type="button" class="bg-pos-mode-chip" data-bg-pos-mode="cover" aria-pressed="false">Cover</button>
    </div>
    <div class="bg-pos-grid" id="themeBgPositionGrid" data-anchor="outer" data-active-position="centre" role="radiogroup" aria-label="Image position">
      <button type="button" class="bg-pos-cell" data-pos="top-left"     aria-label="Top left"     aria-pressed="false"><span class="bg-pos-dot"></span></button>
      <button type="button" class="bg-pos-cell" data-pos="top"          aria-label="Top"          aria-pressed="false"><span class="bg-pos-dot"></span></button>
      <button type="button" class="bg-pos-cell" data-pos="top-right"    aria-label="Top right"    aria-pressed="false"><span class="bg-pos-dot"></span></button>
      <button type="button" class="bg-pos-cell" data-pos="left"         aria-label="Left"         aria-pressed="false"><span class="bg-pos-dot"></span></button>
      <button type="button" class="bg-pos-cell bg-pos-cell--centre" data-pos="centre" aria-label="Centre" aria-pressed="true"><span class="bg-pos-dot"></span></button>
      <button type="button" class="bg-pos-cell" data-pos="right"        aria-label="Right"        aria-pressed="false"><span class="bg-pos-dot"></span></button>
      <button type="button" class="bg-pos-cell" data-pos="bottom-left"  aria-label="Bottom left"  aria-pressed="false"><span class="bg-pos-dot"></span></button>
      <button type="button" class="bg-pos-cell" data-pos="bottom"       aria-label="Bottom"       aria-pressed="false"><span class="bg-pos-dot"></span></button>
      <button type="button" class="bg-pos-cell" data-pos="bottom-right" aria-label="Bottom right" aria-pressed="false"><span class="bg-pos-dot"></span></button>
    </div>
  </div>
</div>

<!-- Anchor row: only meaningful when Position mode is active AND a non-centre cell is selected. JS hides this row otherwise. -->
<div class="theme-anim-row" data-bg-mode-show="image" id="themeBgAnchorRow">
  <span>Anchor</span>
  <div class="bg-anchor-seg" role="radiogroup" aria-label="Anchor offset for the selected position">
    <button type="button" class="bg-anchor-btn" data-bg-anchor="outer"  aria-pressed="true" >Outer</button>
    <button type="button" class="bg-anchor-btn" data-bg-anchor="centre" aria-pressed="false">Centre</button>
    <button type="button" class="bg-anchor-btn" data-bg-anchor="inner"  aria-pressed="false">Inner</button>
  </div>
</div>
```

The Alpha cycle row (currently at lines 2748–2754) and everything below stays as-is.

#### Add CSS for the new controls

Place near the existing `.theme-anim-select` rules (around line 1700–1720). New rules:

```css
/* v5.7.1y — Background image position grid + anchor segmented control.
   Replaces the 11-option position dropdown with a spatial 3×3 button grid
   plus a 3-chip mode row. The dot inside each non-centre button slides
   to visualise the Outer/Centre/Inner anchor offset. */

.theme-anim-row--stacked { align-items: flex-start; }
.theme-anim-row--stacked > span { padding-top: 6px; }

.bg-pos-controls { display: flex; flex-direction: column; gap: 10px; }

/* Mode chips */
.bg-pos-mode-chips { display: inline-flex; gap: 4px; background: var(--surface-2, #1a1f29); border-radius: 8px; padding: 3px; }
.bg-pos-mode-chip {
  background: transparent;
  border: 1px solid transparent;
  color: var(--muted, #9aa3b2);
  font-size: 12px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 120ms, color 120ms;
}
.bg-pos-mode-chip:hover { color: var(--text, #e6edf3); }
.bg-pos-mode-chip[aria-pressed="true"] {
  background: var(--accent, #2f81f7);
  color: #fff;
}

/* 3×3 grid */
.bg-pos-grid {
  display: grid;
  grid-template-columns: repeat(3, 36px);
  grid-template-rows:    repeat(3, 36px);
  gap: 4px;
  width: max-content;
}
.bg-pos-cell {
  width: 36px;
  height: 36px;
  background: var(--surface-2, #1a1f29);
  border: 1px solid var(--border, #30363d);
  border-radius: 6px;
  position: relative;
  cursor: pointer;
  padding: 0;
  transition: border-color 120ms, background 120ms;
}
.bg-pos-cell:hover { border-color: var(--accent, #2f81f7); }
.bg-pos-cell[aria-pressed="true"] {
  border-color: var(--accent, #2f81f7);
  background: rgba(47,129,247,0.15);
}

/* The dot — base style centred, then per-position overrides slide it to the appropriate corner / edge */
.bg-pos-dot {
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text, #e6edf3);
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  transition: top 200ms ease, left 200ms ease, right 200ms ease, bottom 200ms ease;
}
.bg-pos-cell[aria-pressed="true"] .bg-pos-dot { background: var(--accent, #2f81f7); width: 8px; height: 8px; }

/* Position the dot inside its cell — Outer anchor (default) */
.bg-pos-cell[data-pos="top-left"]     .bg-pos-dot { top: 4px;  left: 4px;  transform: none; }
.bg-pos-cell[data-pos="top"]          .bg-pos-dot { top: 4px;  left: 50%;  transform: translateX(-50%); }
.bg-pos-cell[data-pos="top-right"]    .bg-pos-dot { top: 4px;  left: auto; right: 4px; transform: none; }
.bg-pos-cell[data-pos="left"]         .bg-pos-dot { top: 50%;  left: 4px;  transform: translateY(-50%); }
.bg-pos-cell[data-pos="centre"]       .bg-pos-dot { /* base centred is fine */ }
.bg-pos-cell[data-pos="right"]        .bg-pos-dot { top: 50%;  left: auto; right: 4px; transform: translateY(-50%); }
.bg-pos-cell[data-pos="bottom-left"]  .bg-pos-dot { top: auto; bottom: 4px; left: 4px;  transform: none; }
.bg-pos-cell[data-pos="bottom"]       .bg-pos-dot { top: auto; bottom: 4px; left: 50%;  transform: translateX(-50%); }
.bg-pos-cell[data-pos="bottom-right"] .bg-pos-dot { top: auto; bottom: 4px; left: auto; right: 4px; transform: none; }

/* Anchor: Centre — only applies to the selected cell, slides the dot half-way toward the cell centre */
.bg-pos-grid[data-anchor="centre"] .bg-pos-cell[aria-pressed="true"][data-pos="top-left"]     .bg-pos-dot { top: 12px; left: 12px; }
.bg-pos-grid[data-anchor="centre"] .bg-pos-cell[aria-pressed="true"][data-pos="top"]          .bg-pos-dot { top: 12px; }
.bg-pos-grid[data-anchor="centre"] .bg-pos-cell[aria-pressed="true"][data-pos="top-right"]    .bg-pos-dot { top: 12px; right: 12px; }
.bg-pos-grid[data-anchor="centre"] .bg-pos-cell[aria-pressed="true"][data-pos="left"]         .bg-pos-dot { left: 12px; }
.bg-pos-grid[data-anchor="centre"] .bg-pos-cell[aria-pressed="true"][data-pos="right"]        .bg-pos-dot { right: 12px; }
.bg-pos-grid[data-anchor="centre"] .bg-pos-cell[aria-pressed="true"][data-pos="bottom-left"]  .bg-pos-dot { bottom: 12px; left: 12px; }
.bg-pos-grid[data-anchor="centre"] .bg-pos-cell[aria-pressed="true"][data-pos="bottom"]       .bg-pos-dot { bottom: 12px; }
.bg-pos-grid[data-anchor="centre"] .bg-pos-cell[aria-pressed="true"][data-pos="bottom-right"] .bg-pos-dot { bottom: 12px; right: 12px; }

/* Anchor: Inner — slides the dot all the way to the cell centre */
.bg-pos-grid[data-anchor="inner"] .bg-pos-cell[aria-pressed="true"][data-pos="top-left"]     .bg-pos-dot,
.bg-pos-grid[data-anchor="inner"] .bg-pos-cell[aria-pressed="true"][data-pos="top"]          .bg-pos-dot,
.bg-pos-grid[data-anchor="inner"] .bg-pos-cell[aria-pressed="true"][data-pos="top-right"]    .bg-pos-dot,
.bg-pos-grid[data-anchor="inner"] .bg-pos-cell[aria-pressed="true"][data-pos="left"]         .bg-pos-dot,
.bg-pos-grid[data-anchor="inner"] .bg-pos-cell[aria-pressed="true"][data-pos="right"]        .bg-pos-dot,
.bg-pos-grid[data-anchor="inner"] .bg-pos-cell[aria-pressed="true"][data-pos="bottom-left"]  .bg-pos-dot,
.bg-pos-grid[data-anchor="inner"] .bg-pos-cell[aria-pressed="true"][data-pos="bottom"]       .bg-pos-dot,
.bg-pos-grid[data-anchor="inner"] .bg-pos-cell[aria-pressed="true"][data-pos="bottom-right"] .bg-pos-dot {
  top: 50%; left: 50%; right: auto; bottom: auto; transform: translate(-50%, -50%);
}

/* Anchor segmented control */
.bg-anchor-seg { display: inline-flex; gap: 0; background: var(--surface-2, #1a1f29); border-radius: 8px; padding: 3px; }
.bg-anchor-btn {
  background: transparent;
  border: 1px solid transparent;
  color: var(--muted, #9aa3b2);
  font-size: 12px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 120ms, color 120ms;
}
.bg-anchor-btn:hover { color: var(--text, #e6edf3); }
.bg-anchor-btn[aria-pressed="true"] {
  background: var(--accent, #2f81f7);
  color: #fff;
}

/* Mobile sizing — bring buttons up to 44×44 floor per WCAG 2.1 AA */
@media (max-width: 640px) {
  .bg-pos-grid { grid-template-columns: repeat(3, 48px); grid-template-rows: repeat(3, 48px); }
  .bg-pos-cell { width: 48px; height: 48px; }
  .bg-pos-mode-chip, .bg-anchor-btn { min-height: 44px; padding: 10px 16px; font-size: 14px; }
}

/* Light theme tweak — the dot needs to be dark on light surfaces */
:root[data-theme="light"] .bg-pos-dot { background: var(--text, #1f2328); }
:root[data-theme="light"] .bg-pos-cell[aria-pressed="true"] .bg-pos-dot { background: var(--accent, #0969da); }
```

#### Add body-level CSS for the actual image positioning under each anchor

The existing `body[data-bg-image-position="X"]` selectors apply `background-position`. Add `data-bg-image-anchor` modifiers. Place near the existing image background rules (grep for `data-bg-image-position` to find them):

```css
/* v5.7.1y — anchor offsets the image inward by ~12.5% (centre) or ~25% (inner)
   from the position dictated by data-bg-image-position. Outer = flush, the
   default that already exists. Centre position ignores anchor entirely. */

body[data-bg-mode="image"][data-bg-image-position="top-left"][data-bg-image-anchor="centre"]     { background-position: 12.5% 12.5%; }
body[data-bg-mode="image"][data-bg-image-position="top"][data-bg-image-anchor="centre"]          { background-position: 50% 12.5%; }
body[data-bg-mode="image"][data-bg-image-position="top-right"][data-bg-image-anchor="centre"]    { background-position: 87.5% 12.5%; }
body[data-bg-mode="image"][data-bg-image-position="left"][data-bg-image-anchor="centre"]         { background-position: 12.5% 50%; }
body[data-bg-mode="image"][data-bg-image-position="right"][data-bg-image-anchor="centre"]        { background-position: 87.5% 50%; }
body[data-bg-mode="image"][data-bg-image-position="bottom-left"][data-bg-image-anchor="centre"]  { background-position: 12.5% 87.5%; }
body[data-bg-mode="image"][data-bg-image-position="bottom"][data-bg-image-anchor="centre"]       { background-position: 50% 87.5%; }
body[data-bg-mode="image"][data-bg-image-position="bottom-right"][data-bg-image-anchor="centre"] { background-position: 87.5% 87.5%; }

body[data-bg-mode="image"][data-bg-image-position="top-left"][data-bg-image-anchor="inner"]      { background-position: 25% 25%; }
body[data-bg-mode="image"][data-bg-image-position="top"][data-bg-image-anchor="inner"]           { background-position: 50% 25%; }
body[data-bg-mode="image"][data-bg-image-position="top-right"][data-bg-image-anchor="inner"]     { background-position: 75% 25%; }
body[data-bg-mode="image"][data-bg-image-position="left"][data-bg-image-anchor="inner"]          { background-position: 25% 50%; }
body[data-bg-mode="image"][data-bg-image-position="right"][data-bg-image-anchor="inner"]         { background-position: 75% 50%; }
body[data-bg-mode="image"][data-bg-image-position="bottom-left"][data-bg-image-anchor="inner"]   { background-position: 25% 75%; }
body[data-bg-mode="image"][data-bg-image-position="bottom"][data-bg-image-anchor="inner"]        { background-position: 50% 75%; }
body[data-bg-mode="image"][data-bg-image-position="bottom-right"][data-bg-image-anchor="inner"]  { background-position: 75% 75%; }
```

#### JS wiring — replace the dropdown change handler (lines 7693–7702)

Current:

```js
const bgImagePositionEl = document.getElementById('themeBgImagePosition');
if (bgImagePositionEl) bgImagePositionEl.addEventListener('change', function (e) {
  const v = e.target.value;
  activeTheme.bgImagePosition = BG_IMAGE_POSITIONS.indexOf(v) !== -1 ? v : THEME_DEFAULTS.bgImagePosition;
  applyActiveTheme();
});

const bgImageAlphaCycleEl = document.getElementById('themeBgImageAlphaCycle');
if (bgImageAlphaCycleEl) bgImageAlphaCycleEl.addEventListener('change', function (e) {
  activeTheme.bgImageAlphaCycle = e.target.checked === true;
  applyActiveTheme();
});
```

Replace with:

```js
// v5.7.1y — Position grid wiring.
// Three modes (position/tile/cover) gate which control surface is interactive.
// In "position" mode, the 9-button grid drives the directional values
// (top-left, top, top-right, left, centre, right, bottom-left, bottom, bottom-right).
// "tile" and "cover" map directly to the legacy dropdown values 'tile' / 'cover'.
const bgPosGrid     = document.getElementById('themeBgPositionGrid');
const bgPosModeBtns = document.querySelectorAll('.bg-pos-mode-chip');
const bgPosCells    = document.querySelectorAll('.bg-pos-cell');
const bgAnchorRow   = document.getElementById('themeBgAnchorRow');
const bgAnchorBtns  = document.querySelectorAll('.bg-anchor-btn');

function syncBgPosUI() {
  // Mode chip pressed-state
  const isTile  = activeTheme.bgImagePosition === 'tile';
  const isCover = activeTheme.bgImagePosition === 'cover';
  const mode = isTile ? 'tile' : isCover ? 'cover' : 'position';
  bgPosModeBtns.forEach(b => b.setAttribute('aria-pressed', b.dataset.bgPosMode === mode ? 'true' : 'false'));

  // Grid: dim it when tile/cover is active (dimming via CSS opacity is fine)
  if (bgPosGrid) {
    bgPosGrid.style.opacity = (mode === 'position') ? '1' : '0.4';
    bgPosGrid.style.pointerEvents = (mode === 'position') ? 'auto' : 'none';

    // Cell pressed-state mirrors the active position (only when in position mode)
    const activePos = (mode === 'position') ? (activeTheme.bgImagePosition || 'centre') : null;
    bgPosCells.forEach(c => c.setAttribute('aria-pressed', c.dataset.pos === activePos ? 'true' : 'false'));
    bgPosGrid.setAttribute('data-active-position', activePos || '');
    bgPosGrid.setAttribute('data-anchor', activeTheme.bgImageAnchor || 'outer');
  }

  // Anchor row: hide for centre position or non-position modes
  if (bgAnchorRow) {
    const showAnchor = (mode === 'position') && (activeTheme.bgImagePosition && activeTheme.bgImagePosition !== 'centre');
    bgAnchorRow.style.display = showAnchor ? '' : 'none';
    bgAnchorBtns.forEach(b => b.setAttribute('aria-pressed', b.dataset.bgAnchor === (activeTheme.bgImageAnchor || 'outer') ? 'true' : 'false'));
  }
}

// Mode chip clicks: switch between position / tile / cover
bgPosModeBtns.forEach(btn => btn.addEventListener('click', function () {
  const mode = btn.dataset.bgPosMode;
  if (mode === 'tile')  activeTheme.bgImagePosition = 'tile';
  else if (mode === 'cover') activeTheme.bgImagePosition = 'cover';
  else {
    // Switching to position mode — pick the centre position by default unless we already
    // have a directional value cached. Easiest: just go to centre.
    if (activeTheme.bgImagePosition === 'tile' || activeTheme.bgImagePosition === 'cover') {
      activeTheme.bgImagePosition = 'centre';
    }
  }
  syncBgPosUI();
  applyActiveTheme();
}));

// Grid cell clicks: pick a directional position (only fires when grid is interactive)
bgPosCells.forEach(cell => cell.addEventListener('click', function () {
  activeTheme.bgImagePosition = cell.dataset.pos;
  syncBgPosUI();
  applyActiveTheme();
}));

// Anchor button clicks
bgAnchorBtns.forEach(btn => btn.addEventListener('click', function () {
  activeTheme.bgImageAnchor = btn.dataset.bgAnchor;
  syncBgPosUI();
  applyActiveTheme();
}));

// Alpha cycle (unchanged from prior — keep this block as-is)
const bgImageAlphaCycleEl = document.getElementById('themeBgImageAlphaCycle');
if (bgImageAlphaCycleEl) bgImageAlphaCycleEl.addEventListener('change', function (e) {
  activeTheme.bgImageAlphaCycle = e.target.checked === true;
  applyActiveTheme();
});

// Initial sync after activeTheme has loaded
syncBgPosUI();
```

**Also delete** the read-back at line 7523–7524 (`bgImagePositionEl` lookup against the dropdown) and replace with a call to `syncBgPosUI()` at the end of the `populateThemeForm()` function (or wherever the equivalent read-back happens).

#### Theme defaults + applyActiveTheme

Add `bgImageAnchor` to `THEME_DEFAULTS` (around line 7080):

```js
const THEME_DEFAULTS = {
  // ... existing fields ...
  bgImagePosition: 'centre',
  bgImageAnchor: 'outer',  // NEW: outer | centre | inner
  bgImageAlphaCycle: false,
  // ...
};
```

Add validation in the theme normaliser (around line 7124):

```js
const BG_IMAGE_ANCHORS = ['outer','centre','inner'];
// ...
return {
  // ... existing fields ...
  bgImagePosition: BG_IMAGE_POSITIONS.indexOf(t.bgImagePosition) !== -1 ? t.bgImagePosition : THEME_DEFAULTS.bgImagePosition,
  bgImageAnchor:   BG_IMAGE_ANCHORS.indexOf(t.bgImageAnchor) !== -1 ? t.bgImageAnchor : THEME_DEFAULTS.bgImageAnchor,
  bgImageAlphaCycle: t.bgImageAlphaCycle === true,
  // ...
};
```

In `applyActiveTheme()` (around line 7250), add an attribute write:

```js
body.setAttribute('data-bg-image-position', BG_IMAGE_POSITIONS.indexOf(theme.bgImagePosition) !== -1 ? theme.bgImagePosition : THEME_DEFAULTS.bgImagePosition);
body.setAttribute('data-bg-image-anchor',   BG_IMAGE_ANCHORS.indexOf(theme.bgImageAnchor)   !== -1 ? theme.bgImageAnchor   : THEME_DEFAULTS.bgImageAnchor);   // NEW
body.setAttribute('data-bg-image-alpha-cycle', theme.bgImageAlphaCycle === true ? 'true' : 'false');
```

### 2. `IRLid-TestEnvironment/irlid-api/src/index.js`

Add Worker-side validation for `bgImageAnchor`. Locate the `bgImagePosition` validation block at lines 1624–1629:

```js
if (t.bgImagePosition !== undefined) {
  // v5.7.1m.1 — added edge anchors top/bottom/left/right alongside the four corner anchors.
  const POSITIONS = ["centre","tile","cover","top","top-left","top-right","bottom","bottom-left","bottom-right","left","right"];
  if (typeof t.bgImagePosition !== "string" || POSITIONS.indexOf(t.bgImagePosition) === -1) {
    return "theme.bgImagePosition must be one of: centre, tile, cover, top, top-left, top-right, bottom, bottom-left, bottom-right, left, right";
  }
}
```

Add immediately after:

```js
// v5.7.1y — bgImageAnchor: outer (flush, default) | centre (~12.5% inset) | inner (~25% inset).
// Visualised in the dashboard's 9-button position grid by sliding the dot inside
// the active cell. Only meaningful for non-centre positions.
if (t.bgImageAnchor !== undefined) {
  const ANCHORS = ["outer","centre","inner"];
  if (typeof t.bgImageAnchor !== "string" || ANCHORS.indexOf(t.bgImageAnchor) === -1) {
    return "theme.bgImageAnchor must be one of: outer, centre, inner";
  }
}
```

Also add `bgImageAnchor` to the comment listing theme fields (line 1527).

### 3. Build pill bump

`OrgCheckin.html` `.sidebar-footer` div (around line 2359 — verify by grep `Build v5\.`) currently shows `Build v5.7.1x` (post-Number One logo fix). Bump to `Build v5.7.1y` in the same commit per BOOTSTRAP §4 discipline.

---

## Acceptance checklist

- [ ] Open Settings → Theming → Background Animation → Mode = Image. The old dropdown is gone; replaced by a row showing 3 mode chips (Position / Tile / Cover) and a 3×3 grid below.
- [ ] **Default state** on a fresh org / unset theme: Position chip is pressed; centre cell is pressed; anchor row is hidden (because centre).
- [ ] Click a corner cell (e.g. top-right). Cell becomes highlighted. Anchor row appears with Outer pressed. Image jumps to top-right of page (background-position: 100% 0).
- [ ] Click Centre on the anchor row. The dot inside the top-right cell visibly slides toward the middle of the cell (~200ms ease). Page background image shifts to ~87.5% 12.5% (slightly inset from top-right corner).
- [ ] Click Inner. The dot slides all the way to the cell centre. Image shifts to ~75% 25%.
- [ ] Click the Tile chip. Grid dims to 40% opacity, becomes non-interactive. Image renders as a tiled background. Anchor row hides.
- [ ] Click the Cover chip. Same dim behaviour. Image stretches to cover the page.
- [ ] Click Position chip again. Grid lights up. The previously-active position is preserved (e.g. top-right stays highlighted) and anchor preference is preserved.
- [ ] Click Save theme. Reload the page. Position + anchor + mode all restore correctly from the Worker round-trip.
- [ ] Worker rejects `bgImageAnchor: "diagonal"` with a 400 (or whatever the validation error path returns).
- [ ] On mobile viewport (≤640px): grid cells are 48×48px each, mode chips and anchor buttons hit 44×44 minimum. No iOS auto-zoom on focus (none of these are text inputs anyway).
- [ ] Light theme: dots render dark, active dot uses the light-theme accent colour. No invisible dots.
- [ ] No regression on existing image upload / alpha cycle / cycle duration controls.

---

## Branch & PR shape

- **Branch:** `codex/v5.7.1y-position-grid`
- **PR title:** `[codex] [M] v5.7.1y — background image position grid + anchor`
- **Expected scope:** Medium. ~150 lines HTML, ~140 lines CSS, ~80 lines JS, ~10 lines Worker. Single PR.
- **Stop and raise** if you find that BG_IMAGE_POSITIONS is referenced from elsewhere in unexpected ways (e.g. preview rendering, CSV export columns) — those would need parallel updates.

---

## Out of scope

- Touching the celebration animation panel (mirrors background but keeps its own dropdown — separate brief if Captain wants it).
- Migrating any existing org's stored `bgImageAnchor` field — there are none yet; default `'outer'` matches today's flush behaviour, so no migration needed.
- The retired `0bdcd0b` float-toggle commit — do NOT cherry-pick it. The float concept is reborn here as the Outer/Centre/Inner anchor.

---

## Why this matters

The position dropdown is one of those controls where the verbal name ("top-left") and the visual outcome (image in the top-left of the page) require a small mental translation every time. The grid removes the translation — the picker IS the page in miniature. The anchor dot moving inside the button is a one-glance preview of what the image will do. Half-a-day of work that turns one of the panel's worst controls into one of its best.

Captain's framing on 10 May: "if the dots could move inside the individual buttons, that would be fantastic." That's the stretch we're going for.

---

— Number One, drafted for Mr. Data, Sunday 10 May 2026 morning.
