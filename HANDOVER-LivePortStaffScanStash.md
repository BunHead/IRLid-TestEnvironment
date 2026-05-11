# HANDOVER — Forward-port PR #104 staff_scan stash/recovery to live OrgCheckin

**Drafted:** 11 May 2026 morning, by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid` (live repo — NOT test env).
**Priority:** Medium-high. Closes the last known gap in the LIVE doorman flow: when staff scans an attendee's orange QR with no active session, the org-login round-trip currently consumes the hash without stashing it, losing the staff_scan. v5.9.0.7 fixed scan.html's handoff target but live's OrgCheckin staff_scan handler is still on the older (pre-PR-#104) shape and needs the stash/recovery additions.

---

## Context (read this first)

Last watch shipped `v5.9.0.4` → `v5.9.0.7` on live, proving the full check-in/check-out cycle end-to-end on production (Kerry scan_count=5, Spencer scan_count=4, 7 check-outs across the session). Captain's been the developer-credential staff phone throughout — already signed in to the live dashboard, so the org-login round-trip wasn't needed.

The remaining gap: when a fresh staff phone (no active session on `irlid.co.uk`) scans an orange attendee QR via camera app, the flow is:

1. Camera app opens the orange QR's URL: `https://irlid.co.uk/scan.html?type=device_key&payload=H:...`
2. Live `scan.html` (v5.7.1+v5.9.0.6) classifies as `device_key`, shows "Open in staff dashboard" gate, button href is `https://irlid.co.uk/OrgCheckin.html?dev=0#staff_scan=<encoded>`
3. Phone navigates to live OrgCheckin with the staff_scan in the hash
4. Live OrgCheckin's `captureStaffScanFromHash` IIFE reads the hash → assigns `__staffScanPending`
5. No active session → `tryStaffScanRedirectOrPoll` redirects to `org-login.html?return=<dashboardUrl>` for WebAuthn sign-in
6. **The bug:** in this redirect, the `__staffScanPending` is encoded into the `return` URL's hash, but the `return=` parameter goes through HTTP redirects which DO NOT preserve hash fragments. After the bounce-back, the staff_scan is gone.
7. After WebAuthn completes and dashboard reloads, the IIFE runs again — but the hash is empty (lost in the round-trip) → `__staffScanPending` stays null → no auto-process → user sees the dashboard but the scan is lost.

**Mr. Data's PR #104 on test env solved this** by introducing a localStorage stash that survives the org-login round-trip independently of the hash. The same fix needs to land on live.

Test env source: `IRLid-TestEnvironment/OrgCheckin.html` lines ~6856-7050. PR #104 commit `2b484f8` on `BunHead/IRLid-TestEnvironment` main.

Live destination: `IRLid-repo/OrgCheckin.html` lines ~6937-7084 (the existing staff_scan handler block).

---

## Goal

Port PR #104's stash/recovery additions from test env to live OrgCheckin.html, so a fresh staff phone with no active session can scan an attendee's orange QR, complete the org-login round-trip via WebAuthn, and have the staff_scan auto-process into the escalation modal after bounce-back. Acceptance: identical behaviour to test env's v5.7.1z.1 flow, on live.

---

## What to add (from test env → live)

### 1. Add `STAFF_SCAN_PENDING_PAYLOAD_KEY` constant

Test env has at line 6857:
```javascript
const STAFF_SCAN_PENDING_PAYLOAD_KEY = 'irlid_pending_staff_scan_payload';
```

Add this to live OrgCheckin.html alongside the existing `STAFF_SCAN_PENDING_NONCE_KEY` and `STAFF_SCAN_PENDING_WORKER_KEY` constants (live line 6966-6967).

### 2. Add four helper functions before the IIFE

Test env lines 6862-6892. Port verbatim to live, placing them BEFORE the `captureStaffScanFromHash` IIFE (live line 6938):

```javascript
function staffScanPayloadLooksValid(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^(H|HZ|D|DZ):/.test(text)) return true;
  try {
    const url = new URL(text);
    const path = (url.pathname || '').toLowerCase();
    return (path.endsWith('/scan.html') || path.endsWith('scan.html'))
      && (url.searchParams.has('payload') || url.searchParams.has('h') || url.searchParams.has('hz') || url.searchParams.has('d') || url.searchParams.has('dz'));
  } catch (_) {
    return false;
  }
}

function stashPendingStaffScan(value) {
  if (!staffScanPayloadLooksValid(value)) return;
  try { localStorage.setItem(STAFF_SCAN_PENDING_PAYLOAD_KEY, value); } catch (_) {}
}

function readPendingStaffScan() {
  try {
    const value = localStorage.getItem(STAFF_SCAN_PENDING_PAYLOAD_KEY);
    return staffScanPayloadLooksValid(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function clearPendingStaffScan() {
  try { localStorage.removeItem(STAFF_SCAN_PENDING_PAYLOAD_KEY); } catch (_) {}
}
```

### 3. Modify `captureStaffScanFromHash` IIFE — add recovery path + stash on capture

Live currently at line 6938-6958. The existing block does:

```javascript
(function captureStaffScanFromHash() {
  console.log('[staff_scan] IIFE entry, raw hash:', JSON.stringify(window.location.hash));
  try {
    const hash = window.location.hash || '';
    const m = hash.match(/[#&]staff_scan=([^&]+)/);
    console.log('[staff_scan] regex match result:', m ? ('captured ' + m[1].length + ' chars') : 'no match');
    if (!m) return;   // <-- TEST ENV ADDS RECOVERY HERE
    __staffScanPending = decodeURIComponent(m[1]);
    // <-- TEST ENV ADDS stashPendingStaffScan() HERE
    console.log('[staff_scan] captured pending QR from hash, length:', __staffScanPending.length, 'starts with:', __staffScanPending.slice(0, 50));
    const cleanedHash = hash.replace(/[#&]staff_scan=[^&]+/, '').replace(/^&/, '#');
    history.replaceState(null, '', window.location.pathname + window.location.search + (cleanedHash === '#' ? '' : cleanedHash));
    console.log('[staff_scan] hash cleaned from URL bar, __staffScanPending now set');
  } catch (err) {
    console.warn('[staff_scan] hash capture failed:', err);
  }
})();
```

Change to match test env (lines 6894-6922):

```javascript
(function captureStaffScanFromHash() {
  console.log('[staff_scan] IIFE entry, raw hash:', JSON.stringify(window.location.hash));
  try {
    const hash = window.location.hash || '';
    const m = hash.match(/[#&]staff_scan=([^&]+)/);
    console.log('[staff_scan] regex match result:', m ? ('captured ' + m[1].length + ' chars') : 'no match');
    if (!m) {
      // No hash this load — try recovery from localStorage stash (set by a
      // previous load before an org-login round-trip consumed the hash).
      const recovered = readPendingStaffScan();
      if (recovered) {
        __staffScanPending = recovered;
        console.log('[staff_scan] recovered pending QR from localStorage, length:', recovered.length, 'starts with:', recovered.slice(0, 50));
      }
      return;
    }
    __staffScanPending = decodeURIComponent(m[1]);
    stashPendingStaffScan(__staffScanPending);
    console.log('[staff_scan] captured pending QR from hash, length:', __staffScanPending.length, 'starts with:', __staffScanPending.slice(0, 50));
    const cleanedHash = hash.replace(/[#&]staff_scan=[^&]+/, '').replace(/^&/, '#');
    history.replaceState(null, '', window.location.pathname + window.location.search + (cleanedHash === '#' ? '' : cleanedHash));
    console.log('[staff_scan] hash cleaned from URL bar, __staffScanPending now set');
  } catch (err) {
    console.warn('[staff_scan] hash capture failed:', err);
  }
})();
```

### 4. Modify `tryStaffScanRedirectOrPoll` — recover from stash on bounce-back + stash before redirect

Two changes inside live's existing function (line 6973-7054):

**(a)** Inside the `if (pendingNonce)` block (live line 6994), BEFORE the `const ctx = ...` line, add the recovery:

```javascript
if (pendingNonce) {
  // Returning from org-login.html: try recovery if hash didn't survive.
  if (!__staffScanPending) __staffScanPending = readPendingStaffScan();
  const ctx = __staffScanPending ? '[staff_scan]' : '[staff_signin]';
  // ... rest unchanged
```

**(b)** Inside the fresh-redirect block (after the `loginInit` call, before constructing `dashboardUrl` — live around line 7040), add the explicit stash:

```javascript
try { localStorage.setItem(STAFF_SCAN_PENDING_NONCE_KEY, nonce); } catch (_) {}
try { localStorage.setItem(STAFF_SCAN_PENDING_WORKER_KEY, workerBase); } catch (_) {}
stashPendingStaffScan(__staffScanPending);   // <-- ADD THIS LINE
// Re-encode the staff_scan into the return URL...
```

### 5. Modify `tryProcessStaffScanIfPending` — clear stash on success, restash on retry

Live's existing function (line 7056-7084). Two small additions inside the catch + success paths:

**(a)** In the catch block (live line 7081), after restoring `__staffScanPending`, ALSO restash:

```javascript
try { await processDashboardScan(); } catch (err) {
  console.warn('[staff_scan] auto-process failed:', err);
  setDashboardScanStatus('Could not auto-process the staff scan: ' + (err?.message || err), 'error');
  __staffScanPending = captured;
  stashPendingStaffScan(captured);   // <-- ADD THIS LINE
  return true;
}
```

**(b)** Before the function's final `return true;` (line 7083), add the success clear:

```javascript
clearPendingStaffScan();   // <-- ADD THIS LINE
return true;
}
```

---

## What NOT to change

- **Don't touch the `workerBase` fallback URL on live (line 7038).** Live correctly defaults to `https://irlid-api-org.irlid-bunhead.workers.dev` (the live Org Worker). Test env's equivalent line uses `https://irlid-api-test.irlid-bunhead.workers.dev`. Preserve the live value when porting.
- **Don't bundle in other test env changes** beyond PR #104's scope. Other test env state may be ahead of live in ways we'll deliberately port chapter-by-chapter, not en masse.
- **Don't change the `[staff_scan]` console.log format.** They're load-bearing for diagnostics; existing v5.7.1d logs in live OrgCheckin should be preserved.

---

## Pill bump

Bump `Build v5.9.0.7` → `Build v5.9.0.8` in `OrgCheckin.html`'s sidebar footer (look for `Build v5.9.0.7`). Per BOOTSTRAP §4: version letter changes mean pill bumps in the same commit.

---

## Acceptance checklist

- [ ] Five new symbols present in live OrgCheckin.html: `STAFF_SCAN_PENDING_PAYLOAD_KEY` const + four helpers (`staffScanPayloadLooksValid`, `stashPendingStaffScan`, `readPendingStaffScan`, `clearPendingStaffScan`).
- [ ] `captureStaffScanFromHash` IIFE recovers from localStorage when hash is absent.
- [ ] `captureStaffScanFromHash` stashes to localStorage when hash IS present.
- [ ] `tryStaffScanRedirectOrPoll` recovers from localStorage on bounce-back from org-login (inside `if (pendingNonce)` block).
- [ ] `tryStaffScanRedirectOrPoll` stashes before redirecting to org-login (inside the fresh-redirect path).
- [ ] `tryProcessStaffScanIfPending` clears stash on success, restashes on retry.
- [ ] Live's `workerBase` fallback still says `irlid-api-org` (not `irlid-api-test`).
- [ ] Build pill in sidebar footer reads `Build v5.9.0.8`.
- [ ] No new test-env URLs introduced (run a grep for `bunhead.github.io` after the change — should only show comments and the existing pre-existing references).

---

## Two-phone hardware verification

After deploy, Captain to verify with one phone NOT signed in to live:

1. Attendee phone (Pixel 4a) — scan live's check-in QR with camera → land on orange "Get a member of staff" screen with device-key QR.
2. Staff phone (Pixel 8 Pro) — **sign out of live first** so there's no active session. Then scan the orange QR with camera app.
3. Phone opens `irlid.co.uk/scan.html?type=device_key&payload=H:...` → "Open in staff dashboard" gate → tap.
4. Phone navigates to `irlid.co.uk/OrgCheckin.html?dev=0#staff_scan=...`.
5. Live OrgCheckin captures hash, stashes to localStorage, redirects to `org-login.html?return=...`.
6. WebAuthn challenges, Captain confirms with biometric.
7. Phone bounces back to OrgCheckin (hash gone via HTTP redirect).
8. Live OrgCheckin recovers staff_scan from localStorage stash, processes it.
9. Escalation modal opens with Kerry's pub_fp pre-populated (or whichever attendee was scanned).
10. Captain either picks from list or adds at the door.
11. Post-resolution toast fires, phone redirects to live scan.html.

If steps 1-11 all green, PR is shippable.

---

## Out of scope

- Sign-out-twice UX bug (parked from last watch; no recurrence reported, not blocking).
- v6.1 schema unification (big chapter, Captain explicitly deferring).
- Visual freshening of the consumer-facing pages (separate Number One stream this morning).
- Adding new staff_scan handler shapes — strictly port-not-extend.

---

## PR title

`[codex] v5.9.0.8 — Forward-port PR #104 staff_scan localStorage stash/recovery to live OrgCheckin`

Branch: `codex/v5.9.0.8-staff-scan-stash-recovery-live`.

Expected PR scope: Medium (~100-120 lines including the stash helpers + IIFE changes + two function patches + pill bump).

Acceptance: see checklist above. Single PR. Stop and raise if scope expands.

---

— Number One, 11 May 2026 morning watch.
