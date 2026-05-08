# HANDOVER — `v5.5.13` Cached Org Snapshot (Tier 3 of `PROTOCOL.md §16`)

**Drafted:** 9 May 2026 morning, by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid-TestEnvironment` only.
**Priority:** Primary chapter for the next `v5.5.x` window. Ships *after* `v5.5.12` (Tier 2 write queue) and `v5.5.12.2` (indicator clearance fix), both already on main.

---

## Context (read this first)

Tier 1 (PWA shell, `v5.7.1a/e`) gets the dashboard to load offline cold. Tier 2 (`v5.5.12`) lets writes succeed locally and replay on reconnect. **Neither addresses recognition.** When staff scan a returning regular at the door while offline today, the dashboard has nothing to match the device fingerprint against — the GET to `/org/expected` failed (offline), so `expectedAttendees[]` is empty.

This is the gap Tier 3 closes. On every successful online sync, the dashboard pulls a snapshot of the active org's full state (Expected list with all `device_key_fps[]`, settings, recent attendance, theme) into IndexedDB. When offline, all reads serve from the snapshot. **Net effect:** the doorman flow recognises returning regulars without WiFi. *"I built event check-in that survives the venue WiFi dying mid-shift"* becomes a true claim end-to-end, not just write-side.

**Captain's framing 8 May, captured verbatim:** *"someone could come each week and never need to re-identify their device... it'd need to be online to verify someone new"*. That's the design intent.

**Architectural constraint** (confirmed by Captain 9 May): **single-organisation scope.** Cross-org recognition without re-binding is v5.8 §14.18 OAuth identity territory. Tier 3 caches one org's snapshot at a time. Different `org_code` = different snapshot = no implicit recognition across orgs. That's protocol sovereignty by design — orgs don't share member data without explicit federation.

**Read these sections of `PROTOCOL.md §16` before touching code:**

- §16.1 — position statement.
- §16.3 Tier 3 — the implementation specification (the "Goal" / "Implementation" / "Outcome" subsections).
- §16.5 — the offline indicator. You'll extend it to show snapshot freshness.
- §16.7 — progressive enhancement framing. Local reads are the *primary path*; server fetches refresh the snapshot rather than block the UI.

---

## Goal

When `OrgCheckin.html` is online:

- After every successful sign-in OR successful drain of the Tier 2 queue, fetch the org's full state and write it to IndexedDB as a single snapshot keyed by `org_code` with a `synced_at` timestamp.
- Refresh the snapshot opportunistically: on `visibilitychange` when becoming visible AND online, on a successful `refreshAttendance()` call, on Worker writes that return 200 with updated state.

When `OrgCheckin.html` is offline:

- All read paths (`loadDashboardForOrg()`, `refreshExpectedAttendees()`, `refreshAttendance()`, `getOrgSettings()`, etc) serve from the snapshot instead of attempting Worker GETs that will fail.
- The doorman flow's `findExpectedByDeviceFp` lookup runs against the cached snapshot — returning regulars are recognised offline.
- The offline indicator includes a snapshot-freshness label: *"Showing snapshot from 14:32 — reconnecting…"* per §16.3 Tier 3.

When connectivity returns:

- Snapshot refreshes automatically on next visibilitychange or queue drain.
- Stale-snapshot label disappears once the snapshot is fresh.

---

## Files to add

### `IRLid-TestEnvironment/js/offline-snapshot.js` (new)

Self-contained module that exposes a small global API on `window.IRLidOfflineSnapshot`. Mirror the structure of `js/offline-queue.js` (already in test env) — same IndexedDB-with-Promise-wrapper pattern, same lazy-open, same single-interception philosophy.

```javascript
// IRLid offline org snapshot — Tier 3 of PROTOCOL.md section 16.
// Caches the active org's full read-side state (Expected list with all
// device_key_fps[], settings, recent attendance, theme) in IndexedDB
// so offline reads serve from snapshot instead of failing.
//
// Snapshot is keyed by org_code so multiple orgs can be cached
// simultaneously (e.g. dev account that switches between Imbue Ventures
// and a test org). Cross-org recognition is intentionally NOT supported
// (v5.8 section 14.18 OAuth identity is the future answer).
(function () {
  const DB_NAME = "irlid-offline-snapshot";
  const DB_VERSION = 1;
  const STORE = "org_snapshots";

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "org_code" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function store(mode) {
    const db = await openDB();
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  // Save a snapshot for an org. Overwrites any previous snapshot for
  // the same org_code. The shape MUST match what the dashboard expects
  // to read — Expected list rows, settings object, attendance rows,
  // theme. Pass null/undefined fields if the data isn't available;
  // readers handle partial snapshots gracefully.
  async function save(orgCode, data) {
    if (!orgCode) throw new Error("save: org_code required");
    const target = await store("readwrite");
    const record = {
      org_code: orgCode,
      synced_at: Date.now(),
      expected: data.expected || [],
      attendance: data.attendance || [],
      settings: data.settings || null,
      theme: data.theme || null,
    };
    return new Promise((resolve, reject) => {
      const req = target.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  async function load(orgCode) {
    if (!orgCode) return null;
    const target = await store("readonly");
    return new Promise((resolve, reject) => {
      const req = target.get(orgCode);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function listOrgs() {
    const target = await store("readonly");
    return new Promise((resolve, reject) => {
      const req = target.getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function clear(orgCode) {
    const target = await store("readwrite");
    return new Promise((resolve, reject) => {
      const req = target.delete(orgCode);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // Convenience: find an Expected row by device fingerprint within the
  // cached snapshot. Used by the doorman flow when offline. Returns
  // null if no match or no snapshot.
  async function findExpectedByDeviceFp(orgCode, fp) {
    const snap = await load(orgCode);
    if (!snap || !Array.isArray(snap.expected)) return null;
    return snap.expected.find(row => {
      const fps = Array.isArray(row.device_key_fps) ? row.device_key_fps : [];
      return row.device_key_fp === fp || fps.includes(fp);
    }) || null;
  }

  window.IRLidOfflineSnapshot = { save, load, listOrgs, clear, findExpectedByDeviceFp };
})();
```

---

## Files to modify

### `IRLid-TestEnvironment/OrgCheckin.html`

**Load the snapshot script in `<head>`** (after `js/offline-queue.js`):

```html
<script src="js/offline-snapshot.js"></script>
```

**Modify `loadDashboardForOrg()`** (or whichever function is the entry point for "user just signed in or switched org — populate the dashboard"). After successful Worker fetches, save the snapshot. On Worker fetch failure (offline), fall back to the snapshot:

```javascript
async function loadDashboardForOrg(org) {
  currentOrg = org;
  // ... existing setup ...
  try {
    const [settings, expected, attendance] = await Promise.all([
      window.IRLidOrgApi.getOrgSettings(org.api_key),
      window.IRLidOrgApi.listExpected(org.api_key),
      window.IRLidOrgApi.listAttendance(org.api_key),
    ]);
    // Existing: render with fresh data
    expectedAttendees = expected.expected || [];
    attendanceData = attendance.rows || [];
    settings = settings.settings || {};
    renderExpectedAttendees();
    renderTable(attendanceData);
    applySettings(settings);
    // v5.5.13 — snapshot the fresh state for offline use.
    if (window.IRLidOfflineSnapshot) {
      await window.IRLidOfflineSnapshot.save(org.id, {
        expected: expectedAttendees,
        attendance: attendanceData,
        settings,
        theme: settings.theme,
      });
    }
  } catch (err) {
    // Worker fetch failed — likely offline. Fall back to snapshot.
    console.warn('[snapshot] Worker fetch failed, attempting snapshot fallback:', err);
    if (window.IRLidOfflineSnapshot) {
      const snap = await window.IRLidOfflineSnapshot.load(org.id);
      if (snap) {
        expectedAttendees = snap.expected || [];
        attendanceData = snap.attendance || [];
        settings = snap.settings || {};
        renderExpectedAttendees();
        renderTable(attendanceData);
        applySettings(settings);
        updateSnapshotFreshnessLabel(snap.synced_at);
        return;
      }
    }
    // No snapshot either. Surface the error.
    showToast('Could not load dashboard (offline and no cached data).', true);
  }
}
```

**Modify the doorman flow's recognition logic.** Today the orange-QR flow looks up `findExpectedByDeviceFp` against the in-memory `expectedAttendees[]`. That works fine when online (the array was just refreshed). When offline, the array might be stale or empty. Add the snapshot fallback:

```javascript
async function recogniseDeviceFp(fp) {
  // First try in-memory (fastest, fresh after recent online refresh).
  const inMemory = expectedAttendees.find(row => {
    const fps = Array.isArray(row.device_key_fps) ? row.device_key_fps : [];
    return row.device_key_fp === fp || fps.includes(fp);
  });
  if (inMemory) return { row: inMemory, source: 'live' };

  // Fall back to snapshot (catches cases where the array hasn't been
  // refreshed yet after coming online, or where we're offline).
  if (window.IRLidOfflineSnapshot && currentOrg) {
    const snapMatch = await window.IRLidOfflineSnapshot.findExpectedByDeviceFp(currentOrg.id, fp);
    if (snapMatch) return { row: snapMatch, source: 'snapshot' };
  }
  return null;
}
```

Wire `recogniseDeviceFp()` into the existing orange-QR processing path (search for `findExpectedByDeviceFp` calls in `OrgCheckin.html` and replace with the new helper).

**Extend the offline indicator** with a snapshot-freshness label. Add to the `updateOfflineIndicator()` state machine in `OrgCheckin.html`:

```javascript
function updateSnapshotFreshnessLabel(syncedAt) {
  const indicator = document.getElementById('offlineIndicator');
  if (!indicator) return;
  let freshness = indicator.querySelector('.snapshot-freshness');
  if (!freshness) {
    freshness = document.createElement('span');
    freshness.className = 'snapshot-freshness';
    indicator.appendChild(freshness);
  }
  if (!syncedAt) { freshness.textContent = ''; return; }
  const time = new Date(syncedAt).toLocaleTimeString(displayLocale(), { hour: '2-digit', minute: '2-digit' });
  freshness.textContent = `Snapshot ${time}`;
}
```

CSS:

```css
.offline-indicator .snapshot-freshness {
  font: 500 11px/1 system-ui, sans-serif;
  color: #C62828;
  opacity: 0.85;
  margin-left: 6px;
}
```

---

## Acceptance checklist

- [ ] `js/offline-snapshot.js` exists, page loads with no console errors.
- [ ] `<script src="js/offline-snapshot.js">` added to `OrgCheckin.html` head, after `js/offline-queue.js`.
- [ ] On successful sign-in: DevTools → Application → IndexedDB → `irlid-offline-snapshot` → `org_snapshots` shows a record keyed by the active org's `org_code`, containing `expected`, `attendance`, `settings`, `theme`, `synced_at`.
- [ ] On org switch (if multiple orgs exist): a second record appears for the new org, keyed independently. Switching back loads the original.
- [ ] **Offline read test:** with the dashboard fully loaded online, DevTools → Network → Offline. Hard-refresh the page. The dashboard should re-render the Expected list, Attendance table, and theme from the snapshot — not show "Could not load" errors.
- [ ] Indicator shows "Snapshot HH:MM" label below/beside the OFFLINE label, indicating data freshness.
- [ ] **Offline doorman recognition test:** with cache populated and offline, scan a known-bound device's orange QR. Recognition should succeed via `recogniseDeviceFp()` returning `source: 'snapshot'`. The escalation modal should NOT open (recognised path).
- [ ] **Offline unknown-device test:** scan a never-bound device's orange QR. Recognition returns null. Escalation modal opens (the existing offline-queue handles the Add at the door write).
- [ ] On reconnect: snapshot refreshes after the next visibilitychange-when-online OR after the queue drain completes. Indicator updates the snapshot timestamp.
- [ ] No regression on `v5.5.12` queue behaviour (writes still queue offline, drain online).
- [ ] No regression on `v5.7.1h` audit mode (entering audit reads from the same `attendanceData` array — should work whether populated from Worker or snapshot).
- [ ] No regression on online behaviour: a fresh online sign-in shows fresh data (from Worker), not snapshot — snapshot only kicks in when Worker fetch fails.

---

## Branch & PR shape

- **Branch:** `codex/v5.5.13-cached-org-snapshot`
- **PR title:** `[codex] v5.5.13 — Cached org snapshot (Tier 3 of §16)`
- **Expected PR scope:** Medium-to-Large (~150-250 lines new in `js/offline-snapshot.js`; ~50-80 lines modified in `OrgCheckin.html` for the load/refresh + recognition + freshness label).
- **Single PR. Stop and raise if scope expands.**

---

## Out of scope (deferred)

- **Tier 4 — Multi-device offline mesh.** WebRTC peer reconciliation. `v6` flagship.
- **Cross-org recognition.** Different `org_code` = different snapshot. v5.8 §14.18 OAuth identity is the future answer for "I'm the same person at multiple orgs".
- **Worker-side changes.** Tier 3 is purely client-side, same as Tier 2.
- **Snapshot encryption at rest.** IndexedDB is per-origin already; the dashboard origin holds device-key bindings server-side already. Encrypted-at-rest snapshots are a v6 hardening pass, not a Tier 3 requirement.
- **Snapshot versioning / migration.** v1 schema only. Future schema changes can bump `DB_VERSION` and add `onupgradeneeded` handlers.
- **Auto-purge of stale snapshots.** Snapshots persist until the user clears them or the org is removed. A retention policy is a separate polish.

---

## Questions for Captain (raise in PR description, don't block)

1. **Snapshot freshness indicator placement** — currently planned as inline with the OFFLINE label in the bottom-left indicator. If the label gets cluttered, would you prefer a hover tooltip instead?
2. **Snapshot refresh cadence** — currently planned as "on sign-in + on visibilitychange-when-online + after queue drain". Should there be a periodic refresh too (e.g. every 60s when online), or is opportunistic enough?
3. **Recognition source visible to staff?** When offline-recognition succeeds via snapshot rather than live, should the escalation toast or audit row mention *"recognised from local cache"*, or is that noise?

---

— Number One, drafted for Mr. Data, 9 May 2026.
