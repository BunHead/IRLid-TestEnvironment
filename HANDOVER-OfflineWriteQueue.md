# HANDOVER — `v5.5.12` Offline Write Queue + Indicator (Tier 2 of `PROTOCOL.md §16`)

**Drafted:** 8 May 2026, by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid-TestEnvironment` only. Live-repo deploy is a separate later step.
**Priority:** Primary chapter for the `v5.5.12` window. Ships *after* `v5.7.1i` (sign.js consolidation) so the offline-queue work builds on a clean helper surface.

---

## Context (read this first)

`PROTOCOL.md §16` (Offline-capable operation) is ratified. Tier 1 (the PWA shell — `sw.js` + `manifest.json` + Service Worker registration) is already shipped: see `v5.7.1a/e` in `STATE-OF-PLAY.md`. The dashboard now loads cold offline.

Tier 2 is the genuinely-new capability the offline proposal promised: when staff are offline, **writes still succeed locally**, get queued in IndexedDB, and replay to the Worker when connectivity returns. A small visual indicator (Captain's blinking-red-dot directive, captured verbatim in §16.5) tells staff which mode the dashboard is in.

**Read these sections of `PROTOCOL.md` first before touching code:**

- §16.1 — position statement (offline-first as a design principle).
- §16.3 Tier 2 — the implementation specification.
- §16.5 — the blinking-red-dot indicator. CSS is canonical and copy-paste-ready.
- §16.7 — progressive enhancement vs graceful degradation framing. Local writes are the *primary path*; server POSTs mirror an already-completed local op.
- §16.9 — threat model (queued envelopes are pre-signed; tampering with IndexedDB produces an invalid signature on sync).

**Architectural decision** (§16.3 Tier 2 conflict-resolution paragraph): the Worker accepts duplicate writes. The protocol's immutability rule (§14.9 / `crew-protocol §2.2`) means the audit trail is the truth, not a deduplicated final answer. Therefore **this PR has zero Worker-side changes**: the queue is purely client-side, and the only "idempotency" is the natural-key shape of the existing tables. This is intentional and load-bearing — it keeps the PR scoped and matches the spec.

---

## Goal

When `OrgCheckin.html` detects offline (`navigator.onLine === false` or a Worker `fetch()` raises a network error):

1. Mutating Worker calls succeed *locally* — the UI updates as if the call returned 200.
2. The op is appended to an IndexedDB store named `pending_ops` with full payload + headers + endpoint metadata.
3. A blinking red dot appears top-right; if `pending_ops` is non-empty, the dot shows the queue depth as a numeric badge.
4. When `online` event fires (or on next page load), the queue replays in order. Successful ops are removed from the store. The badge ticks down. When empty, a green check fades in for 1–2s and then the indicator hides.
5. If a replayed op returns a non-2xx, it stays in the queue and the indicator surfaces an error tooltip; staff can manually dismiss bad ops via a small "Pending ops" overlay (below).

GET-only calls (read paths) bypass the queue entirely and just fail clean when offline — Tier 3 (cached snapshot) is the spec-defined answer for offline reads, and is a **separate later PR**.

---

## Files to add

### `IRLid-TestEnvironment/js/offline-queue.js` (new)

Self-contained module that exposes a small global API on `window.IRLidOfflineQueue`:

```javascript
// IRLid offline write queue — Tier 2 of PROTOCOL.md §16.
// Stores pending Worker POSTs in IndexedDB while offline; replays them
// in order when connectivity returns. Pure client-side; zero Worker
// dependency. The Worker accepts duplicate writes per spec §16.3.
(function () {
  const DB_NAME = 'irlid-offline';
  const DB_VERSION = 1;
  const STORE = 'pending_ops';

  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(mode) {
    const db = await openDB();
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  async function enqueue(op) {
    const store = await tx('readwrite');
    return new Promise((resolve, reject) => {
      const req = store.add({
        ...op,
        queued_at: Date.now(),
        idempotency_key: op.idempotency_key || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(36).slice(2)),
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function listAll() {
    const store = await tx('readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function remove(id) {
    const store = await tx('readwrite');
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function count() {
    const store = await tx('readonly');
    return new Promise((resolve, reject) => {
      const req = store.count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  }

  // Replay drains the queue in insertion order. Each op is fired against
  // the Worker; on 2xx the op is removed; on non-2xx it stays queued and
  // replay halts (subsequent ops may depend on this one — e.g. checkin
  // before checkout).
  let replaying = false;
  async function replay() {
    if (replaying) return { halted: false, drained: 0 };
    replaying = true;
    let drained = 0;
    let halted = false;
    try {
      const ops = await listAll();
      for (const op of ops) {
        try {
          const response = await fetch(op.url, {
            method: op.method,
            headers: op.headers,
            body: op.body,
          });
          if (!response.ok) {
            console.warn('[offline-queue] replay HTTP', response.status, op.url);
            halted = true;
            break;
          }
          await remove(op.id);
          drained += 1;
          window.dispatchEvent(new CustomEvent('irlid:queue-changed'));
        } catch (err) {
          console.warn('[offline-queue] replay network error', err);
          halted = true;
          break;
        }
      }
    } finally {
      replaying = false;
    }
    return { halted, drained };
  }

  window.IRLidOfflineQueue = { enqueue, listAll, remove, count, replay };

  // Replay opportunistically when connectivity returns or page becomes
  // visible. Background Sync API would extend this to fire even after
  // the tab is closed; flagged as stretch work — see "Stretch goals" below.
  window.addEventListener('online', () => { replay(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) replay();
  });
  // Also try on first load — there may be queued ops from the previous session.
  if (navigator.onLine) {
    setTimeout(() => replay(), 1500);
  }
})();
```

---

## Files to modify

### `IRLid-TestEnvironment/js/orgapi.js`

Wrap the existing `request()` helper so that mutating calls (`POST` / `PATCH` / `DELETE`) on the **whitelisted endpoints** transparently fall through to the queue when offline.

The whitelist (paths only — exact match prefix-by-prefix):

```javascript
const QUEUE_ELIGIBLE_PATHS = [
  '/org/checkin',
  '/org/checkout',                // also covers ?checkout_method=legacy via prefix match
  '/org/checkout-token',
  '/org/expected/create-and-bind',
  '/org/expected',                // POST/PATCH/DELETE on /org/expected and /org/expected/:id and /org/expected/:id/full and /org/expected/:id/rebind and /org/expected/:id/bind-additional-key and /org/expected/:id/claim
  '/org/conflicts',               // /org/conflicts/:id/resolve
  '/org/settings',                // POST only
];
```

Modify `request()` so that, for an *eligible* mutating call, the path is:

1. Try the network. If `fetch()` resolves with a 2xx, return the response as today.
2. If `fetch()` throws (network error) **OR** `navigator.onLine` is false at call time, enqueue the op and return a synthetic success: `{ queued: true, idempotency_key, queued_at }`.
3. UI consumers must treat `queued: true` as "operation accepted" — see callers section below.

Sketch (drop-in, near the existing `request()` definition):

```javascript
function isQueueEligible(path, method) {
  if (method === 'GET') return false;
  return QUEUE_ELIGIBLE_PATHS.some(p => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'));
}

async function request(path, options) {
  const opts = options || {};
  const method = opts.method || 'GET';
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (opts.orgKey) headers['X-Org-Key'] = opts.orgKey;
  if (opts.sessionToken) headers['Authorization'] = 'Bearer ' + opts.sessionToken;
  const url = getBaseUrl() + path;
  const body = opts.body ? JSON.stringify(opts.body) : undefined;

  // v5.5.12 — offline queue interception. If we know we're offline,
  // skip the network attempt entirely; otherwise let fetch fail and
  // fall back to enqueue.
  const eligible = isQueueEligible(path, method);
  if (eligible && navigator.onLine === false && window.IRLidOfflineQueue) {
    const id = await window.IRLidOfflineQueue.enqueue({ url, method, headers, body });
    window.dispatchEvent(new CustomEvent('irlid:queue-changed'));
    return { queued: true, queued_id: id };
  }

  let response;
  try {
    response = await fetch(url, { method, headers, body });
  } catch (err) {
    if (eligible && window.IRLidOfflineQueue) {
      const id = await window.IRLidOfflineQueue.enqueue({ url, method, headers, body });
      window.dispatchEvent(new CustomEvent('irlid:queue-changed'));
      return { queued: true, queued_id: id };
    }
    throw err;
  }

  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const message = data && data.error ? data.error : `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}
```

**Existing callers must tolerate `{ queued: true }`.** Most existing callers in `OrgCheckin.html` consume the response data (e.g. the new attendance row). For the queued case:

- `IRLidOrgApi.createCheckin` and `checkout`: caller should optimistically update local UI from the request body's payload (the data they sent in is what they get back when online; offline they construct an equivalent local row tagged `pending_sync: true`).
- `IRLidOrgApi.updateOrgSettings`: caller already maintains an in-memory copy of the active settings; a `queued: true` response means the local copy is the truth until sync.
- `IRLidOrgApi.bindAdditionalKey` / `claimExpected` / `createAndBindExpected`: caller refreshes the Expected list afterwards — when queued, the refresh fails (offline) but the local `expectedAttendees` array can be updated optimistically.

The acceptance criteria below specify which UI surfaces must add a `pending_sync` badge.

### `IRLid-TestEnvironment/OrgCheckin.html`

**Add the offline indicator chrome** near the existing topbar markup. The CSS at `PROTOCOL.md §16.5` is canonical; copy it verbatim into a `<style>` block:

```html
<div class="offline-indicator" id="offlineIndicator" hidden role="status" aria-live="polite">
  <span class="dot" aria-hidden="true"></span>
  <span class="label">OFFLINE</span>
  <span class="badge" id="offlineQueueBadge" hidden>0</span>
</div>
```

```css
.offline-indicator {
  position: fixed; top: 16px; right: 16px;
  display: flex; align-items: center; gap: 8px;
  z-index: 100; pointer-events: auto;
}
.offline-indicator .dot {
  width: 12px; height: 12px; border-radius: 50%;
  background: #C62828;
  animation: offline-pulse 1.4s ease-in-out infinite;
}
@keyframes offline-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: .55; }
}
.offline-indicator .label {
  font: 600 12px/1 system-ui, sans-serif;
  color: #C62828; letter-spacing: .04em;
}
.offline-indicator .badge {
  background: #C62828; color: #fff;
  border-radius: 10px; padding: 2px 7px;
  font: 700 11px/1 system-ui, sans-serif;
}
.offline-indicator.synced .dot {
  background: #2E7D32;
  animation: none;
}
.offline-indicator.synced .label {
  color: #2E7D32;
}
```

**Add the indicator state machine** (a small block of JS — place near the existing `DOMContentLoaded` init block):

```javascript
// v5.5.12 — Offline indicator state machine.
// §16.5 directive: blinking red dot when offline; numeric badge if
// pending_ops is non-empty; brief green check on full drain; hide
// otherwise.
function updateOfflineIndicator() {
  const indicator = document.getElementById('offlineIndicator');
  const badge = document.getElementById('offlineQueueBadge');
  if (!indicator || !badge) return;
  const offline = !navigator.onLine;
  Promise.resolve(window.IRLidOfflineQueue ? window.IRLidOfflineQueue.count() : 0).then(n => {
    if (offline || n > 0) {
      indicator.hidden = false;
      indicator.classList.remove('synced');
      indicator.querySelector('.label').textContent = offline ? 'OFFLINE' : 'SYNCING';
      if (n > 0) { badge.hidden = false; badge.textContent = String(n); }
      else       { badge.hidden = true; }
    } else {
      // Was offline + had a queue, now empty → flash green check briefly.
      if (!indicator.hidden) {
        indicator.classList.add('synced');
        indicator.querySelector('.label').textContent = 'SYNCED';
        badge.hidden = true;
        setTimeout(() => { indicator.hidden = true; indicator.classList.remove('synced'); }, 1500);
      }
    }
  });
}
window.addEventListener('online', updateOfflineIndicator);
window.addEventListener('offline', updateOfflineIndicator);
window.addEventListener('irlid:queue-changed', updateOfflineIndicator);
document.addEventListener('DOMContentLoaded', updateOfflineIndicator);
```

**Load the queue script in the `<head>`** (after `js/sign.js`):

```html
<script src="js/offline-queue.js"></script>
```

**Optimistic local rendering for queued check-ins.** In whichever function handles `IRLidOrgApi.createCheckin`'s response (search for `createCheckin(` in `OrgCheckin.html`), branch on `result?.queued`:

```javascript
const result = await window.IRLidOrgApi.createCheckin(orgKey, body, sessionToken);
if (result && result.queued) {
  // Optimistic local row — tagged so renderTable can show a "pending sync" pill.
  attendanceRows.unshift({
    id: 'pending-' + result.queued_id,
    pending_sync: true,
    ...body,                         // fields the user sent in
    server_received_at: null,
  });
  renderTable();
  setStatus('Queued offline — will sync when reconnected.');
  return;
}
// existing online-path handling unchanged below
```

A small `.pending-sync` CSS pill on attendance rows, rendered when `row.pending_sync === true`:

```css
.pending-sync-pill {
  display: inline-block; margin-left: 6px;
  background: rgba(198, 40, 40, 0.18);
  color: #C62828; border: 1px solid rgba(198, 40, 40, 0.35);
  border-radius: 999px; padding: 1px 7px;
  font: 600 10px/1.2 system-ui, sans-serif; letter-spacing: .04em;
}
```

In `renderTable()`, append the pill markup to the row when `row.pending_sync === true`.

---

## Acceptance checklist

- [ ] `js/offline-queue.js` exists with the API above. Page loads with no console errors.
- [ ] `<script src="js/offline-queue.js">` added to `OrgCheckin.html` head, after `js/sign.js`.
- [ ] `js/orgapi.js` `request()` helper is queue-aware. `QUEUE_ELIGIBLE_PATHS` whitelist matches the spec above.
- [ ] DevTools → Network → Offline. Open the dashboard, perform an operation in the whitelist (e.g. check someone in via Process scan, or save a settings change). The UI updates locally; no error appears; an `OFFLINE` red dot is visible top-right with badge `1`.
- [ ] Repeat several times — badge ticks up to `2`, `3`, etc.
- [ ] DevTools → Network → No throttling. Within ~2s the indicator switches to `SYNCING`, badge ticks down, and on full drain shows green `SYNCED` for ~1.5s before hiding.
- [ ] After resync, refresh the dashboard. The previously-pending rows now show *without* the pending-sync pill — they are real server rows.
- [ ] DevTools → Application → IndexedDB → `irlid-offline` → `pending_ops`. Verify entries appear during the offline phase and disappear during the resync phase.
- [ ] Reload the page while offline. Indicator returns immediately as `OFFLINE` with the correct badge count, *before* any user action — confirming `pending_ops` survives reload.
- [ ] **Read paths still fail clean when offline.** GET `/org/expected` etc. raise a network error — no queue interception. Tier 3 will fix this with cached snapshots.
- [ ] No regression online: with full network, every existing flow behaves as today (verify the v5.7.1h doorman flow end-to-end: device-key scan → escalation modal → bind / Add → 3s post-resolution toast → audit mode).

---

## Branch & PR shape

- **Branch:** `codex/v5.5.12-offline-queue`
- **PR title:** `[codex] v5.5.12 — IndexedDB write queue + offline indicator (Tier 2 of §16)`
- **Expected PR scope:** Large (~250–400 lines new in `js/offline-queue.js`; ~80 lines modified in `js/orgapi.js`; ~80 lines new in `OrgCheckin.html` chrome + state-machine + per-caller optimistic branches; ~20 lines CSS). Read description + acceptance match before merge.
- **Single PR. Stop and raise if scope expands.**

---

## Out of scope (deferred)

- **Tier 3 — Cached org snapshot.** Read paths offline. Separate brief, `v5.5.13` window. Spec at §16.3 Tier 3.
- **Tier 4 — Multi-device offline mesh.** WebRTC peer reconciliation. `v6` flagship work.
- **Worker-side dedupe / idempotency_keys table.** Per spec §16.3, the Worker accepts duplicate writes. The audit trail is the truth. Do NOT add a Worker patch.
- **Background Sync API integration.** A stretch goal — the queue replays via `online` event + `visibilitychange` already, which covers the same-tab case. Background Sync would extend replay to fire even when the tab is closed; nice-to-have, not required for Tier 2 acceptance. See "Stretch goals" below.
- **Offline-issued Bearer sessions** (§16.10 open question 5). Out of scope.
- **PWA install prompt** (§16.10 open question 3). Out of scope.

---

## Stretch goals (raise as separate PRs after Tier 2 lands)

1. **Background Sync API.** In `sw.js`, add a `'sync'` event listener that calls into `IRLidOfflineQueue.replay()` (the SW will need its own minimal IndexedDB read code since it can't share the page's `IRLidOfflineQueue` global directly). Register from the page: `navigator.serviceWorker.ready.then(reg => reg.sync.register('replay-pending'))`. Graceful no-op on browsers without support (Safari).
2. **"Pending ops" inspector overlay.** A small expander on the dashboard that lists queued ops with their endpoint, body, and queued-at time, and lets staff manually delete a stuck op (one that keeps failing on replay).

---

## Questions for Captain (raise in PR description, don't block)

1. Position of the indicator: §16.5 says top-right at 16px. The existing `OrgCheckin.html` topbar has its own controls there. Is overlapping acceptable, or should it tuck into the topbar as a flex item?
2. Wording for the queued-checkin status: I've drafted *"Queued offline — will sync when reconnected."* Is the tone right?
3. Pending-sync pill colour: I've used the same red as the indicator. Could be amber instead if Captain prefers — colour signals "in-flight" rather than "error".

---

— Number One, drafted for Mr. Data, 8 May 2026.
