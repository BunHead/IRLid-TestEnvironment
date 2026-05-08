# HANDOVER — `v5.7.0d` Multi-Key Bind UI in Escalation Modal

**Drafted:** 8 May 2026, by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid-TestEnvironment` only.
**Priority:** Independent of `v5.7.1i` and `v5.5.12`. Can ship in parallel with either.

---

## Context (read this first)

The Worker endpoint `POST /org/expected/:id/bind-additional-key` already exists from `v5.7.0a` (PR #81). What's missing is the dashboard UI for staff to actually use it.

Today, when a recognised attendee (e.g. Spencer Austin, already bound to his Pixel 8 Pro) scans on a *second* device (e.g. his Pixel 4a):

1. The 4a posts a `device_key` orange QR.
2. Staff opens the escalation modal.
3. The "Choose from List" picker shows ONLY *unclaimed* Expected rows — Spencer is filtered out because his row already has a `device_key_fp` from the 8 Pro.
4. The only available action is "Add at the door", which creates a duplicate Spencer Austin Expected row.

This brief surfaces the existing Worker endpoint in the UI: claimed Expected rows appear in the picker with a distinct treatment, and selecting one binds the new device key to the existing row instead of creating a duplicate.

---

## Goal

When a staff member opens the escalation modal for a device-key QR:

- The picker shows **all** Expected rows that match the search query, not just unclaimed ones.
- Claimed rows render with a different style: muted background, sub-text reading *"already bound to `fp-short`"* (where `fp-short` is the first 8 chars of the existing `device_key_fp`).
- Clicking a claimed row triggers `bindAdditionalKey()` against the existing row, appending the new `device_pub_fp` to the row's `device_key_fps[]` array, instead of `claim` or `Add at the door`.
- Acceptance flow: Spencer Austin's 4a scans → escalation modal opens → search "Spencer" → existing Spencer row appears with "already bound to NhI4LeOK" → tap → "Bind additional device to Spencer Austin?" confirm → success → standard 3s post-resolution toast → either Stay-on-dashboard or auto-redirect to `scan.html`.

---

## Files to modify

### `IRLid-TestEnvironment/OrgCheckin.html`

**Replace `unclaimedExpectedRows()` (line ~4722) with a richer helper.** The function's name should change too — it no longer just returns *unclaimed* rows.

```javascript
// v5.7.0d — return all Expected rows tagged with claim status so the
// escalation picker can render claimed rows distinctly and route their
// click to bindAdditionalKey instead of claim / Add-at-the-door.
function escalationCandidateRows() {
  return expectedAttendees.map(row => {
    const fps = Array.isArray(row.device_key_fps) ? row.device_key_fps : [];
    const primaryFp = row.device_key_fp || (fps.length ? fps[0] : null);
    return {
      row,
      claimed: !!primaryFp,
      primaryFp,
      allFps: row.device_key_fp ? [row.device_key_fp, ...fps] : fps,
    };
  });
}
```

**Update `renderEscalationExpectedList()` (line ~4728)** to use the new helper and render claimed rows distinctly:

```javascript
function renderEscalationExpectedList() {
  const root = document.getElementById('escalationExpectedList');
  if (!root) return;
  const q = (document.getElementById('escalationSearchInput')?.value || '').trim().toLowerCase();
  const candidates = escalationCandidateRows().filter(c => expectedDisplayName(c.row).toLowerCase().includes(q));
  if (!candidates.length) {
    root.innerHTML = '<div class="escalation-empty">No Expected entries match.</div>';
    return;
  }
  root.innerHTML = candidates.map(c => {
    const name = expectedDisplayName(c.row);
    const role = roleLabelFor(c.row.prototype_role || 'attendee');
    const status = c.row.status || 'assist';
    if (c.claimed) {
      const fpShort = shortFingerprint(c.primaryFp);
      const meta = [role, 'already bound to ' + fpShort].join(' · ');
      return `<button class="escalation-row escalation-row-claimed" type="button" data-bind-additional-id="${escapeHtml(c.row.id)}"><div><strong>${escapeHtml(name)}</strong><span>${escapeHtml(meta)}</span></div><span>Add device</span></button>`;
    }
    const meta = [role, status].join(' · ');
    return `<button class="escalation-row" type="button" data-bind-expected-id="${escapeHtml(c.row.id)}"><div><strong>${escapeHtml(name)}</strong><span>${escapeHtml(meta)}</span></div><span>Bind</span></button>`;
  }).join('');
}
```

**Add a new handler `bindAdditionalEscalationExpected(id)`.** Mirror the structure of `bindEscalationExpected` but call `IRLidOrgApi.bindAdditionalKey()`:

```javascript
async function bindAdditionalEscalationExpected(id) {
  const row = expectedAttendees.find(item => String(item.id) === String(id));
  if (!row) return setEscalationStatus('Expected entry not found.', 'error');
  if (!confirm('Bind this device as an additional key for ' + expectedDisplayName(row) + '?')) return;
  try {
    setEscalationStatus('Binding additional device...');
    const body = escalationBodyBase();
    if (!developerBearerSessionIsActive()) {
      let token = currentStaffSessionToken();
      if (!token) {
        const session = await requestStaffHelloSession('bind additional device key');
        if (!session) return setEscalationStatus('Staff HELLO proof cancelled.', 'error');
        token = session.staff_session;
      }
      body.staff_session = token;
    }
    const result = await window.IRLidOrgApi.bindAdditionalKey(
      currentOrg.api_key,
      id,
      body,
      developerBearerSessionIsActive() ? developerBearerSession.session_token : undefined,
    );
    setEscalationStatus('');
    closeEscalationModal();
    await refreshExpectedAttendees();
    await refreshAttendance();
    showPostResolutionToast(expectedDisplayName(row));
  } catch (err) {
    console.warn('[escalation] bindAdditionalKey failed', err);
    setEscalationStatus(err.message || 'Bind failed.', 'error');
  }
}
```

**Wire up the click routing.** Find the existing event delegation for `data-bind-expected-id` (search the file for that attribute name in the click-handler block — likely a single switch on `event.target.closest('[data-bind-expected-id]')` somewhere). Add a parallel branch for `data-bind-additional-id`:

```javascript
const additionalBtn = event.target.closest('[data-bind-additional-id]');
if (additionalBtn) {
  bindAdditionalEscalationExpected(additionalBtn.getAttribute('data-bind-additional-id'));
  return;
}
```

**Add CSS** for the muted-claimed style. Place near the existing `.escalation-row` rules around line ~315:

```css
.escalation-row.escalation-row-claimed {
  background: rgba(13, 17, 23, 0.32);
  border-style: dashed;
}
.escalation-row.escalation-row-claimed:hover {
  border-color: rgba(120, 200, 120, 0.55);
  background: rgba(13, 17, 23, 0.55);
}
.escalation-row.escalation-row-claimed strong { opacity: 0.9; }
.escalation-row.escalation-row-claimed span { color: var(--muted); font-style: italic; }
```

---

## Acceptance checklist

- [ ] Escalation modal picker shows both claimed and unclaimed Expected rows.
- [ ] Claimed rows render with dashed border + "already bound to `fp-short`" subtext + "Add device" right-side label.
- [ ] Unclaimed rows still render as today: solid border + status text + "Bind" right-side label.
- [ ] Search filter applies across both classes of row.
- [ ] Clicking an unclaimed row still calls the existing `bindEscalationExpected()` flow (claim).
- [ ] Clicking a claimed row calls the new `bindAdditionalEscalationExpected()` flow (bind-additional-key).
- [ ] Confirm dialog wording differs: claim says *"Bind this device to {name}?"*, additional says *"Bind this device as an additional key for {name}?"*.
- [ ] After success, standard 3s post-resolution toast appears with "Linked: {name}", Stay button enters audit mode, default redirects to `scan.html`.
- [ ] After success, the Expected row's `device_key_fps[]` length grows by one (verify by re-opening the modal — the same row now shows the second `fp-short`, or just inspect via the dashboard's Expected list).
- [ ] No regression on the Add-at-the-door tab.

---

## Test scenario (smoke)

1. Sign in to Imbue Ventures dashboard on a desktop.
2. Confirm Spencer Austin's row exists with one bound device (e.g. the Pixel 8 Pro).
3. On a second device (a Pixel 4a or any other phone) visit `https://bunhead.github.io/IRLid-TestEnvironment/OrgCheckin.html?dev=0`, generate a `device_key` orange QR.
4. Screenshot the QR, upload to the dashboard, `Decode image` + `Process scan`.
5. Escalation modal opens. Search "Spencer".
6. Existing Spencer row appears with "already bound to NhI4LeOK" (or whatever the 8 Pro's `fp-short` is) and an "Add device" label.
7. Click. Confirm.
8. Toast: "Linked: Spencer Austin", redirect to `scan.html` after 3s (or Stay → audit mode).
9. Re-open dashboard's Expected list. Spencer's row now lists two `device_key_fps`.

---

## Branch & PR shape

- **Branch:** `codex/v5.7.0d-multikey-bind-ui`
- **PR title:** `[codex] v5.7.0d — multi-key bind UI in escalation modal`
- **Expected PR scope:** Medium (~80–120 lines new, ~20 lines modified). 60s eyeball pass.
- **Single PR. Stop and raise if scope expands.**

---

## Out of scope

- Worker-side change. The endpoint already exists.
- Any change to the orange QR generation flow on the phone side.
- Removing the existing "Add at the door" tab — staff still need it for genuinely-new attendees.
- Polish on `escalation-row-claimed` beyond the muted dashed treatment described.

---

— Number One, drafted for Mr. Data, 8 May 2026.
