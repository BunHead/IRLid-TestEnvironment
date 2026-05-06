# HANDOVER — `v5.5.12` Offline Shell (Tier 1 of `PROTOCOL.md §16`)

**Drafted:** 6 May 2026 night, by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid-TestEnvironment` only. Live repo deploy comes later, after test-env soak.
**Priority:** First task of Tuesday's morning watch.

---

## Context (read this first)

Captain ratified `PROTOCOL.md §16` (Offline-capable operation) on 6 May 2026 night watch. The full specification is at `IRLid-repo/PROTOCOL.md §16`; the design rationale lives in `IRLid-repo/archive/OFFLINE-MODE-PROPOSAL.md`. **You should read at least §16.1 (position statement), §16.2 (what already works offline), §16.3 Tier 1 (PWA shell), and §16.7 (progressive enhancement framing) before touching code.**

This handover delivers Tier 1 of the four-tier path. Tiers 2-4 are NOT in scope for this PR. Stop and raise if scope expands.

---

## Goal

`OrgCheckin.html` and the related dashboard surface load and operate from cold with zero connectivity, provided the page has been visited at least once. Existing behaviour must remain unchanged when online.

**Acceptance scenario:**

1. User visits `https://bunhead.github.io/IRLid-TestEnvironment/OrgCheckin.html?dev=0` while online.
2. The Service Worker installs silently in the background. No UX disruption.
3. User goes offline (DevTools → Network → Offline, or genuinely disconnects).
4. User reloads the page.
5. The page renders the full `OrgCheckin.html` shell — header, sidebar, dashboard skeleton — instead of Chrome's "you are offline" interstitial.
6. Last-known cached state from `localStorage` / `IndexedDB` populates UI as it does online.
7. Worker calls fail gracefully: dashboard rows that depend on a fresh fetch may show empty or stale, but no JavaScript exception breaks the shell.

**Out of scope (deferred to `v5.5.13`+):**

- Write queueing for offline scans (Tier 2 — IndexedDB pending_ops).
- Cached org snapshot (Tier 3 — pre-pulled Expected list, settings, theme).
- The blinking-red-dot offline indicator (`§16.5`) — UI work for the Tier 2 PR; this PR only delivers the shell.
- PWA install prompts on mobile (Tier 1 polish; `v5.5.12.1` if needed).
- Live-repo deploy of any of this.

If you find yourself wanting any of the above to make Tier 1 work, stop and raise — they're separate PRs.

---

## Files to add

### `IRLid-TestEnvironment/sw.js` (new)

Service Worker, root-scoped. Registers a versioned cache (`irlid-shell-v1` or similar — bump on schema changes). Caches:

- `OrgCheckin.html` (this is the canonical app shell)
- `js/orgapi.js`
- `js/qr-fullscreen.js`
- `js/sign.js` (even though not currently loaded by `OrgCheckin.html` — Tier 2 will need it; cache now)
- `js/vendor/jsqr.min.js`
- The vendor CDN scripts (qrcodejs, iro). These can be cached with a `cache-first` strategy on first hit.
- Inline-styled images / icons referenced from the shell HTML.

Strategy:

- **Install handler** — pre-cache the static shell (HTML + js/* + vendor list).
- **Fetch handler** — for navigation requests within the test env scope: `cache-first, then network`. For Worker calls (`https://irlid-api-test.irlid-bunhead.workers.dev/*`): `network-only` (we never want to serve stale Worker responses). For all other GETs: `network-first, falling back to cache`.
- **Activate handler** — purge any old cache versions named `irlid-shell-*` that aren't the current version.

Comments at the top should explain Tier 1 positioning and reference `PROTOCOL.md §16.3 Tier 1`.

### `IRLid-TestEnvironment/manifest.json` (new)

PWA manifest. Required fields:

```json
{
  "name": "IRLid Organisation Check-in",
  "short_name": "IRLid Org",
  "description": "IRLid organisation check-in dashboard.",
  "start_url": "/IRLid-TestEnvironment/OrgCheckin.html?dev=0",
  "display": "standalone",
  "background_color": "#0d1117",
  "theme_color": "#0d1117",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Icons: if `icons/icon-192.png` and `icons/icon-512.png` don't exist, generate simple IRLid-branded placeholders. The IRLid logo from the live site is at `https://irlid.co.uk/logo.png` (reuse if it works at the right sizes; otherwise let me know and Number One will generate them).

### Modify `IRLid-TestEnvironment/OrgCheckin.html` (existing)

Add to the `<head>`:

```html
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#0d1117">
```

Add to a `DOMContentLoaded` block (anywhere appropriate near the existing init code, e.g. just after the existing `Listener` registrations around line ~4825):

```javascript
// v5.5.12 — Service Worker registration (Tier 1 of PROTOCOL.md §16).
// Silent install. No UX changes. The cached shell becomes available on
// next page visit; existing visit is unaffected.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('[sw] registered scope:', reg.scope))
      .catch(err => console.warn('[sw] registration failed:', err));
  });
}
```

---

## Acceptance checklist

- [ ] `sw.js` exists at the test env root, syntactically valid (`new Function(swCode)` doesn't throw).
- [ ] `manifest.json` exists at the test env root, valid JSON.
- [ ] Both icons referenced exist (or placeholders generated).
- [ ] `OrgCheckin.html` registers the Service Worker on load.
- [ ] In Chrome DevTools → Application → Service Workers, the SW shows `activated and is running` after first online visit.
- [ ] Toggling DevTools → Network → Offline and reloading shows `OrgCheckin.html` rendering, not the Chrome offline page.
- [ ] No new errors in console when online (other than expected Worker-mediated warnings that already exist).
- [ ] Worker POSTs / GETs still work as today when online — service worker passes them through unchanged.
- [ ] Bumping the cache version string in `sw.js` and reloading purges the old cache (verified once).
- [ ] DOES NOT add Tier 2 / Tier 3 / Tier 4 functionality; reserves them for follow-up PRs.

---

## Branch & PR shape

- **Branch:** `codex/v5.5.12-pwa-shell`
- **PR title:** `[codex] v5.5.12 — PWA shell (Tier 1 of §16 offline-capable operation)`
- **Expected PR scope:** Medium (~150-250 lines new, ~10 lines modified in `OrgCheckin.html`).
- **Single PR. Stop and raise if scope expands.**

---

## Note on Tier 2 follow-up

When Tier 1 lands, `v5.5.13` (Tier 2 — IndexedDB write queue + offline indicator) is queued as the immediate next step. That PR will need:

- The blinking-red-dot UI from `§16.5` (CSS already canonical in the spec).
- IndexedDB `pending_ops` store for queued writes.
- Background Sync registration (graceful no-op on browsers without support).
- A small change to `js/orgapi.js` to write-then-queue rather than write-then-fail-on-network-error.

Don't anticipate it in `v5.5.12`. Tier 1 is its own clean ship.

---

## Questions for Captain (raise these in PR description, don't block on them)

1. Should the "Add to Home Screen" prompt (PWA install) be auto-surfaced or opt-in? Spec §16.10 leaves this open.
2. Worker URL allow-list inside the SW — should we ever cache Worker responses (e.g. for read-only `GET /org/expected`)? Spec recommends not, but Tier 3 (cached snapshot) revisits this.

---

— Number One, drafted for Mr. Data's Tuesday morning watch, 6 May 2026.
