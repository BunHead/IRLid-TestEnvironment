# HANDOVER — `v5.7.1m` Customization Panel: Image as Separate Mode + Positioning + Alpha

**Drafted:** 9 May 2026, by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid-TestEnvironment` only.
**Priority:** Independent of v5.7.1k and v5.5.13.1. Can ship in parallel.

---

## Context (read this first)

The Settings panel in `OrgCheckin.html` (around line 2344-2402, the "Background animation" / `themeBgAnimPanel` section) currently has a Background mode dropdown with four options: `off / page / glow / pattern`. When the user picks "Pattern", they can choose from 8 built-in tiled patterns OR pick "Custom image (PNG / SVG / JPEG)" which reveals an image upload field.

Today, **image upload is a sub-option of pattern**. Captain's design call 9 May: split image OUT from pattern. They're conceptually different — pattern is generated, image is uploaded — and bundling them limits what the image mode can do.

This brief makes "image" its own first-class background mode with its own controls: positioning (centre / tile / fit-to-corners / stretch) and alpha-aware compositing (transparent regions of the uploaded image let the cycling palette colours show through, mirroring the IRLid logo trick).

The infrastructure is half-built already: `activeTheme.bgImageUrl` exists, `--theme-pattern-image` CSS variable exists, `themeBgImageUpload` input exists with a 200KB limit and validation. You're refactoring the wiring, not building from scratch.

---

## Goal

Three changes in one PR:

### A. Add `image` as a new top-level Background mode

Modify the `themeBgMode` `<select>` (line ~2349):

```html
<select id="themeBgMode" class="theme-anim-select">
  <option value="off">Off (flat dark)</option>
  <option value="page">Page colour cycle</option>
  <option value="glow">QR glow halo</option>
  <option value="pattern">Pattern</option>
  <option value="image">Custom image</option>      <!-- NEW -->
</select>
```

Remove the "Custom image (PNG / SVG / JPEG)" option from the `themeBgPattern` select (line ~2374) — it now lives at the top level.

The CSS class machinery `[data-bg-mode="..."] [data-bg-mode-show="..."]` already handles the show/hide of mode-specific rows. Add `data-bg-mode="image"` and `data-bg-mode-show="image"` selectors to mirror the existing `pattern` ones (around line ~1499-1502).

### B. Image-mode controls

When mode = `image`, show:

1. **Upload field** (move existing `themeBgImageUpload` into a new image-mode-specific row, or duplicate-and-deprecate the pattern-mode row). Same 200KB limit, same accept types, same legal note.

2. **Positioning radio group** — new control. Five options:
   - `centre` (default) — image centred at viewport, original size.
   - `tile` — image repeats to fill (current pattern-mode behaviour).
   - `cover` — image stretched to fill viewport, may crop edges.
   - `top-left / top-right / bottom-left / bottom-right` — image anchored to that corner, original size.

   Markup:
   ```html
   <label class="theme-anim-row" data-bg-mode-show="image">
     <span>Position</span>
     <select id="themeBgImagePosition" class="theme-anim-select">
       <option value="centre">Centre</option>
       <option value="tile">Tile</option>
       <option value="cover">Cover (stretch to fill)</option>
       <option value="top-left">Top left</option>
       <option value="top-right">Top right</option>
       <option value="bottom-left">Bottom left</option>
       <option value="bottom-right">Bottom right</option>
     </select>
   </label>
   ```

   Persist `bgImagePosition` on `activeTheme` (default `'centre'`). Add to the `theme` object's serialise/deserialise paths and the readback verification.

3. **Alpha compositing toggle** — new control. When ON and the uploaded image has transparent regions, the page colour cycle (or current palette colour if cycle is off) shows through the transparent pixels.

   Markup:
   ```html
   <label class="theme-anim-row" data-bg-mode-show="image">
     <span>Cycle palette behind transparent areas</span>
     <input type="checkbox" id="themeBgImageAlphaCycle" />
   </label>
   ```

   Implementation: when ON, the body background renders the page-cycle gradient AND the image as a foreground layer (image painted over the cycling background). When OFF, the image renders against a flat dark background. CSS sketch:

   ```css
   /* v5.7.1m — image mode with optional alpha-cycle compositing */
   body[data-bg-mode="image"] {
     background-image: var(--theme-bg-image, none);
     background-color: var(--theme-page-bg, #0d1117);
   }
   body[data-bg-mode="image"][data-bg-image-position="centre"] {
     background-position: center; background-repeat: no-repeat; background-size: auto;
   }
   body[data-bg-mode="image"][data-bg-image-position="tile"] {
     background-repeat: repeat;
   }
   body[data-bg-mode="image"][data-bg-image-position="cover"] {
     background-size: cover; background-repeat: no-repeat; background-position: center;
   }
   body[data-bg-mode="image"][data-bg-image-position="top-left"] {
     background-position: top left; background-repeat: no-repeat;
   }
   body[data-bg-mode="image"][data-bg-image-position="top-right"] {
     background-position: top right; background-repeat: no-repeat;
   }
   body[data-bg-mode="image"][data-bg-image-position="bottom-left"] {
     background-position: bottom left; background-repeat: no-repeat;
   }
   body[data-bg-mode="image"][data-bg-image-position="bottom-right"] {
     background-position: bottom right; background-repeat: no-repeat;
   }

   /* Alpha-cycle: page-cycle gradient shows through transparent image pixels */
   body[data-bg-mode="image"][data-bg-image-alpha-cycle="true"] {
     background-image:
       var(--theme-bg-image, none),
       linear-gradient(45deg, var(--theme-cycle-a, #ff6b35), var(--theme-cycle-b, #FF9500));
     animation: theme-cycle var(--theme-cycle-duration, 30s) ease infinite;
   }
   ```

   The `--theme-cycle-a` / `--theme-cycle-b` / `--theme-cycle-duration` already exist for the page-mode cycling (search for them — they're set in `applyTheme()` or similar). Reuse, don't duplicate.

### C. Apply to `<body>` data attributes

Modify the `applyTheme()` (or equivalent) function that already sets `data-bg-mode` on the body / panel root. When mode is `image`, also set:
- `data-bg-image-position` from `theme.bgImagePosition`
- `data-bg-image-alpha-cycle` from `theme.bgImageAlphaCycle`

So the CSS selectors above resolve cleanly without JS having to touch `style.background-*` directly.

---

## Files to modify

- `IRLid-TestEnvironment/OrgCheckin.html`:
  - `<select id="themeBgMode">` — add `image` option (line ~2349).
  - `<select id="themeBgPattern">` — remove `custom` option (line ~2374).
  - Move `#themeBgImageUploadRow` and `#themeBgImageNote` from `data-bg-mode-show="pattern"` to `data-bg-mode-show="image"`.
  - Add new `#themeBgImagePosition` select and `#themeBgImageAlphaCycle` checkbox in the image mode row block.
  - Add CSS rules from section B above (place near the existing `[data-bg-mode]` rules around line 1499-1502).
  - Update `applyTheme()` (or whichever function sets `data-bg-mode`) to also set `data-bg-image-position` and `data-bg-image-alpha-cycle` body attributes.
  - Update the `activeTheme` model defaults and serialise/deserialise paths to include `bgImagePosition` (default `'centre'`) and `bgImageAlphaCycle` (default `false`).
  - Update the Save Theme readback verification to include the two new fields.

- `IRLid-TestEnvironment/irlid-api/src/index.js`:
  - The `/org/settings` POST handler validates settings JSON. Add `bgImagePosition` (string from the allowed enum) and `bgImageAlphaCycle` (boolean) to the allowlist of theme fields. Reject if `bgImagePosition` is not one of the seven valid values.

---

## Acceptance checklist

- [ ] Background mode dropdown shows five options including new `Custom image`.
- [ ] Pattern dropdown no longer shows `Custom image (PNG / SVG / JPEG)` — just the 8 generated patterns.
- [ ] Selecting `Custom image` from Background mode reveals the upload field, position dropdown, and alpha-cycle checkbox.
- [ ] Selecting `Pattern` does NOT reveal the upload field (it's image-mode-only now).
- [ ] Uploading a PNG with transparent regions, choosing `centre` position, and toggling alpha-cycle ON: the page cycle gradient is visible through the transparent pixels.
- [ ] Same image with alpha-cycle OFF: transparent pixels show the flat dark page colour, no cycling.
- [ ] Each of the seven positioning options (centre, tile, cover, top-left, top-right, bottom-left, bottom-right) renders the image correctly.
- [ ] Save Theme persists `bgImagePosition` and `bgImageAlphaCycle` to the Worker. Reload the page; both fields restore correctly.
- [ ] Switching between modes (image → pattern → image) preserves the uploaded image and selected position.
- [ ] No regression on the existing 8 pattern options.
- [ ] No regression on the page-cycle / glow / off modes.
- [ ] Worker rejects an invalid `bgImagePosition` value with a 400.

---

## Branch & PR shape

- **Branch:** `codex/v5.7.1m-customization-image-pattern-split`
- **PR title:** `[codex] [L] v5.7.1m — customization panel: image as separate mode + positioning + alpha`
- **Expected PR scope:** Large (~250–350 lines: HTML markup additions, CSS for image mode and positioning variants, JS for serialise/deserialise + applyTheme + Worker validation patch).
- **Single PR. Stop and raise if scope expands.**

---

## Out of scope

- Restyling the existing 8 patterns or pattern-mode behaviour.
- Changing the page-cycle / glow / off mode behaviour.
- Changing the Celebration Animation panel (separate concern, may follow same shape later if Captain wants).
- Multiple uploaded images / image library / image rotation.
- Image cropping / editing in-browser.
- Worker storage limits beyond the existing 200KB validation.

---

## Why this matters

Splitting image from pattern unlocks the design space: image-mode can have its own controls (positioning, alpha compositing) without affecting the simpler pattern-mode workflow. The alpha-cycle option is the IRLid logo trick made user-accessible — a venue can upload their logo with a transparent background, position it bottom-right, and have the cycling brand colours show through. That's the kind of branding flexibility venues will actually use, and it costs the protocol nothing.

---

— Number One, drafted for Mr. Data, 9 May 2026.
