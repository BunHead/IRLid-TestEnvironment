# HANDOVER — `v5.7.1z`-band Orange-QR Payload Strip Diagnostic + Fix

**Drafted:** 10 May 2026 evening, by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid-TestEnvironment` only.
**Priority:** Medium. Blocks the doorman-flow demo on test env (escalation modal never opens via the orange-QR-from-phone path). Live remains unaffected — `irlid.co.uk` v5.9.0.4 is stable and this bug surfaces only when staff scan an attendee's orange QR with their phone.

---

## Context (read this first)

The doorman flow has two halves:

1. **Attendee side (`org-entry.html`).** When an unrecognised device hits the venue's check-in QR, the page lands on the orange "Get a member of staff" screen and renders a signed device-key envelope as a QR. The QR encodes the URL `https://irlid.co.uk/scan.html?type=device_key&payload=H:<base64>` (or `HZ:` for compressed) — built by `buildOrangeScanUrl(envelope)` at `org-entry.html` line ~1123, using `scanUrlBase()` line 702.

2. **Staff side (`OrgCheckin.html` dashboard).** Staff scans the orange QR with their phone. The expected chain:
   - Native scanner / camera app opens the URL.
   - `irlid.co.uk/scan.html` (live universal-ingress, shipped `v5.7.1` 6 May) classifies it as `DEVICE_KEY`, shows the "Open in staff dashboard" gate.
   - Staff taps "Open in staff dashboard" → href is `https://bunhead.github.io/IRLid-TestEnvironment/OrgCheckin.html?dev=0#staff_scan=` + `encodeURIComponent(window.location.href)`. The full original URL (with `?type=device_key&payload=...`) is encoded into the hash fragment.
   - Dashboard loads, sees `#staff_scan=...`, decodes it, processes via `processDashboardScan` — escalation modal opens with the device's pub_fp + first/last seen.
   - For an unrecognised device, the modal shows "Choose from list" + "Add at the door" tabs. Mobile gets the `v5.7.1g` 44px-tap-target single-column layout.

Captain reported 10 May late afternoon that this end-to-end flow is broken on test env. Symptoms:

- Did v5 sign-in successfully (toast: *"Signed in to Test Venue as developer"*).
- Landed on plain dashboard, **NOT** on the escalation modal.
- The dashboard's "Process attendee scan" textarea ended up showing the bare URL `https://irlid.co.uk/scan.html` — **no `?type=device_key&payload=...` query params**.
- Dashboard shows the error: *"That URL has no recognised QR payload. The orange device-key QR has the form: scan.html?type=device_key&payload=H:..."*

Captain mid-flow flagged that even if the escalation modal HAD opened, the mobile-friendly variant from `v5.7.1g` wasn't visible to him on a previous attempt — that's a secondary check after the primary fix lands.

Two primary failure-mode hypotheses, both worth testing:

- **(A) Hash fragment lost during the org-login round-trip.** `v5.7.1c` flow: when dashboard receives `#staff_scan=...` with no active session → auto-redirects to `org-login.html?nonce=...&worker=...&return=...` → WebAuthn → bounces back. If the bounce-back URL doesn't preserve the original hash fragment, the staff_scan is lost and the dashboard treats it as a normal sign-in.
- **(B) URL params stripped at the QR-content level.** Native scanners (Chrome, Photos, third-party scanner apps) sometimes truncate URLs at unexpected points. If the orange QR's encoded URL is too long (compressed payload can be 100s of chars) or contains an unfriendly char, the scanner may pass only the URL prefix to the OS handler. Less likely than (A) but worth ruling out.

The bare URL Captain saw in the textarea is probably from him manually pasting the URL bar — not what scan.html actually received. So the truth-source for the diagnostic is the dashboard's own state during the round-trip, not the textarea content.

---

## Goal

Make the phone-only doorman flow work end-to-end on test env: staff phone scans an attendee's orange QR → escalation modal opens on the dashboard with the right device fingerprint pre-populated, ready for "Choose from list" or "Add at the door". The mobile-friendly modal layout (`v5.7.1g`, 44px tap targets, single-column) renders correctly when the modal opens on a phone-width viewport.

---

## Investigation steps (diagnostic first — use temporary `console.log` markers)

This is a multi-step interaction that's hard to inspect by reading code alone. Add temporary instrumentation, deploy, repro, then revert the instrumentation in the same PR as the fix.

### Add `[doorman_e2e]` tracer at every step of the chain

Mark each log with the `[doorman_e2e]` prefix so all evidence is greppable in DevTools console.

In **`org-entry.html`** around `buildOrangeScanUrl`:

```javascript
async function buildOrangeScanUrl(envelope) {
  const url = new URL(scanUrlBase());
  url.searchParams.set("type", "device_key");
  url.searchParams.set("payload", await encodeEnvelopeQr(envelope));
  console.log('[doorman_e2e] orange QR URL built:', url.href, 'length=', url.href.length); // [doorman_e2e] revert post-diagnosis
  return url.href;
}
```

In **`OrgCheckin.html`** at the staff_scan hash-handler (search for `staff_scan`, also see the `[staff_scan]` logs from `v5.7.1d`):

```javascript
// At hash-read entry — log raw hash + decoded result
console.log('[doorman_e2e] dashboard hash on load:', window.location.hash); // [doorman_e2e] revert
console.log('[doorman_e2e] decoded staff_scan URL:', decodedScanUrl); // [doorman_e2e] revert

// Before the org-login redirect (v5.7.1c flow)
console.log('[doorman_e2e] redirecting to org-login; return=', returnUrl, 'pending nonce stash:', stashedNonce); // [doorman_e2e] revert

// At post-bounce-back staff_scan recovery
console.log('[doorman_e2e] post-bounce-back hash:', window.location.hash, 'localStorage.pending_staff_scan=', localStorage.getItem('pending_staff_scan')); // [doorman_e2e] revert
```

In **`org-login.html`** (search for the `return=` URL param handling):

```javascript
console.log('[doorman_e2e] org-login received return URL:', returnParam); // [doorman_e2e] revert
console.log('[doorman_e2e] org-login bounce-back URL:', finalReturnUrl); // [doorman_e2e] revert
```

### Repro on hardware

You'll need two phones (or one phone + one desktop browser simulating the attendee). Captain has a Pixel 8 Pro (developer phone, holds the v5 credential bound to `irlid.co.uk` RP-ID with fp `TvklFsivZk68R67j`) and a Pixel 4a he's used as the unrecognised-attendee device in past doorman tests.

1. **Attendee phone (4a):** open `https://bunhead.github.io/IRLid-TestEnvironment/org-entry.html?org=test-event` (or whatever the test env's Test Venue param is — confirm with Captain). Page should reach the orange screen with a device-key QR. Console should log `[doorman_e2e] orange QR URL built: https://irlid.co.uk/scan.html?type=device_key&payload=... length=N`.

2. **Staff phone (Pixel 8 Pro):** scan the orange QR with the **native camera app** (this is the most common path real users will take; Chrome's QR-on-long-press is also worth testing in a second pass).

3. Camera app should open the URL → `irlid.co.uk/scan.html` shows the "Staff-scan QR detected" gate → tap "Open in staff dashboard".

4. Dashboard loads. Watch the console:
   - `[doorman_e2e] dashboard hash on load:` — does it contain the full `#staff_scan=...` with the encoded URL?
   - If yes, the hash survived the navigation. Investigation moves to the org-login round-trip.
   - If no, the URL/hash got stripped earlier — investigate scan.html's `staffScanUrl` construction (line ~1000 in live `scan.html`).

5. If the hash was present on load and the dashboard auto-redirects to org-login (no active session), watch:
   - `[doorman_e2e] redirecting to org-login` — confirm the staff_scan content is being preserved (either in `return=` URL param, in localStorage, or both).
   - After WebAuthn, `[doorman_e2e] post-bounce-back hash:` — is the original hash still there? Or is `localStorage.pending_staff_scan` populated?

6. The smoking-gun line will tell you exactly where the chain breaks.

### Common likely root causes

- **`return=` URL param doesn't include the hash fragment.** URL fragments don't survive HTTP request/response cycles by default — they're client-side-only. If the dashboard does `window.location.href = '/org-login.html?return=' + encodeURIComponent(window.location.href)` and the original `window.location.href` includes a hash, the `return` param would carry it; but if the hash was stripped before this point, it's gone.
- **localStorage stash for the staff_scan exists but is keyed wrong.** A stash key like `pending_staff_scan` must be readable on bounce-back; if the org-login.html lifecycle clears it (e.g. on its own load) before the dashboard reads it, it's lost.
- **`v5.7.1e` cache-version trap.** Service Worker may be serving cached HTML that predates the staff_scan handler. Confirm `Build vX.Y.Z` pill on dashboard matches latest deploy.

---

## Fix (after diagnosis)

The fix shape depends on what the diagnostic reveals. Likely options:

- If `return=` URL param drops the hash: change the dashboard's pre-redirect logic to either (a) explicitly append the hash to the `return=` URL as a separate `staff_scan_payload=` param, or (b) stash the staff_scan in localStorage before redirect and clear it after successful bounce-back processing.
- If localStorage stash is being cleared too eagerly: tighten the lifecycle so `pending_staff_scan` survives until the dashboard's post-sign-in handler reads it.
- If scan.html's staffScanUrl is malformed: fix the `staffScanUrl` construction at live `scan.html` line 1000 to ensure `window.location.href` carries the full original URL.

Whichever applies: keep the patch minimal, surgical, and revert the `[doorman_e2e]` markers in the same PR as the fix.

---

## Mobile-friendly escalation modal verification (secondary, post-fix)

Once the fix lands and the escalation modal opens reliably on phone, verify the `v5.7.1g` mobile-friendly layout fires:

- DevTools → toggle device toolbar → set viewport to ≤640px wide.
- Open the escalation modal via the now-working orange-QR scan path.
- Confirm: single-column layout (not the desktop two-column grid), tap targets ≥44px, "Choose from list" + "Add at the door" tabs visible and finger-friendly, no horizontal overflow.
- If the modal renders desktop-style on a phone-width viewport, the `v5.7.1g` `@media (max-width:640px)` rules aren't applying. Check selector specificity / CSS load order.

This is a quick visual smoke pass — likely just a screenshot in the PR description. Captain has flagged the previous mobile UX felt "to hard to see"; verifying the fix is what closes the loop.

---

## Acceptance checklist

- [ ] Two-phone repro: attendee phone shows orange QR → staff phone scans with native camera → dashboard auto-opens escalation modal with the right device pub_fp pre-populated, NOT a plain dashboard view.
- [ ] Console output during the working flow shows the staff_scan hash being preserved across the org-login round-trip (`[doorman_e2e]` markers can stay during dev, MUST be reverted before merging).
- [ ] On mobile-width viewport (≤640px), escalation modal renders single-column with 44px tap targets per `v5.7.1g`.
- [ ] No regression on the desktop-only flow: dashboard's "Process attendee scan" textarea + Decode image path still works (this is the non-phone path Captain used during the v5.7.0c-fix work on 6 May night).
- [ ] All `[doorman_e2e]` console.log markers reverted in the final commit. Grep for `\[doorman_e2e\]` should return zero results in the merged PR diff.

---

## Out of scope

- Don't touch the orange-QR generation path itself (`org-entry.html` `buildOrangeScanUrl`) unless the diagnostic shows a generation-side bug. Generation has been working since `v5.7.0b.1` and the URL shape is correct in the code.
- Don't refactor the org-login round-trip flow architecturally. Surgical fix only.
- Don't bundle in the `irlid_mock_org` localStorage trap on live (separate Number One audit task — different repo, different fix).
- Don't bundle in the v5.5.9 dashboard table state bleed (parked since 6 May, separate fix).

---

## PR title

`[codex] v5.7.1z-followup — Orange-QR payload survives staff_scan round-trip; mobile escalation modal verified`

Branch: `codex/v5.7.1z-orange-qr-payload-strip-fix`.

---

## Notes for the next watch

- **`v5.9.0.4` shipped on live tonight** — bootstrap developer recognition working end-to-end on `irlid.co.uk`. Captain can now sign into the live dashboard via QR-login. This is mostly orthogonal to the test-env doorman flow, but: if your fix touches `org-login.html`, do NOT introduce a regression that breaks the live `irlid.co.uk` org-login (different RP-ID, same code path). Smoke both environments if the patch lands in shared code.
- The v5.7.1d `[staff_scan]` logs are already in the codebase (verbose console output for staff-scan-hand-off debugging). Your `[doorman_e2e]` markers are complementary, not duplicative.
- BOOTSTRAP §6 documents the `irlid_mock_*` localStorage test-env-leftover trap and the wrangler-secret Ctrl+V trap — both bit us today on live during v5.9.0.4. Worth a read before your next live-deploy work, but doesn't affect this brief.

---

— Number One, 10 May 2026 evening watch 2.
