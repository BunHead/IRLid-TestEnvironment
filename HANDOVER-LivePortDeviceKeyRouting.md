# HANDOVER — Forward-port v5.7.1z.1 device_key routing fix to live

**Drafted:** 11 May 2026 mid-morning, by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid` (live repo — NOT test env).
**Priority:** Medium. Closes a real production bug in live's `runRecognisedDeviceKeyCheckin` — it currently sends `mode: 'device_key_scan'` to the Worker, which rejects with `"mode must be attendee_scan or doorman_scan"` 422. The bug doesn't bite the typical attendee-arrives-at-venue flow (that goes through `org-entry.html` with `attendee_scan` mode), but DOES bite the doorman re-scan-of-recognised-device path on the dashboard. Test env was fixed yesterday as `v5.7.1z.1`; this is the corresponding live port.

---

## Context (read this first)

The doorman flow on the dashboard has two branches after a device_key QR is processed:

1. **Unrecognised device** → `openEscalationModal(env)` → staff binds to an Expected entry via "Choose from list" or "Add at the door" → calls `/org/expected/:id/claim` or `/org/expected/create-and-bind`. Works fine.
2. **Recognised device** → `runRecognisedDeviceKeyCheckin(env, recognition)` → calls `/org/checkin` with `mode: 'device_key_scan'`. **Broken** — Worker only accepts `attendee_scan` or `doorman_scan`.

Captain's typical Kerry/Spencer testing yesterday went through the attendee-side flow (phone scans venue QR → `org-entry.html` → `/org/checkin` mode=`attendee_scan`), so he didn't surface this. Production scenario where it bites: staff scans an already-bound attendee's orange QR via the dashboard's Process Scan widget (or camera), recognition fires, the call to `/org/checkin` errors out.

Yesterday Number One patched test env to fix this — `v5.7.1z.1` shipped on `BunHead/IRLid-TestEnvironment` in PR linked to test env commit history. The fix: change `mode: 'device_key_scan'` → `mode: 'doorman_scan'` AND synthesize a `helloPayload` from the device-key envelope's `pub_jwk` so the Worker's `pubKeyId(helloPayload.pub)` + `deviceKeyFp(helloPayload.pub)` computations line up correctly.

---

## Goal

Port the same fix to live `OrgCheckin.html`. ~15 lines. After this, the recognised-device-key-scan path on live works end-to-end through the same `/org/checkin` endpoint the attendee_scan path uses.

---

## What to change

### Source (test env) — `IRLid-TestEnvironment/OrgCheckin.html` line ~6073

The function `runRecognisedDeviceKeyCheckin` was edited yesterday to:

```javascript
async function runRecognisedDeviceKeyCheckin(env, recognition) {
  const row = recognition?.row || {};
  const developerBypass = developerBearerSessionIsActive();
  // v5.7.1z.1 — Worker /org/checkin only accepts mode=attendee_scan|doorman_scan;
  // mode='device_key_scan' was never implemented server-side and was returning
  // 422 "mode must be attendee_scan or doorman_scan". Recognised device-key scan
  // is semantically staff scanning a known attendee's device QR -> doorman_scan.
  // Worker reads helloPayload.pub for pubKeyId / deviceKeyFp, so we synthesize
  // helloPayload from the device-key envelope: env.pub_jwk -> helloPayload.pub.
  // env.hash carries the hash of the original device-key envelope (including
  // pub_fp + nonce + sig); we store it as helloHash so the audit trail keeps
  // the actually-signed bytes, not a re-hash of the synthetic payload.
  const syntheticHelloPayload = {
    v: env.v || 3,
    type: 'hello',
    pub: env.pub_jwk,
    ts: env.ts,
    org_code: env.org_code,
    nonce: env.nonce
  };
  const body = {
    mode: 'doorman_scan',
    helloPayload: syntheticHelloPayload,
    helloHash: env.hash || await hashPayloadToB64url(syntheticHelloPayload),
    attendeeLabel: expectedDisplayName(row),
    name: expectedDisplayName(row),
    score: settings.minScore || 50,
    bioVerified: !!settings.bioRequired
  };
  // ... rest of function unchanged (token retrieval, createCheckin call, success handling)
}
```

### Target (live) — `IRLid-repo/OrgCheckin.html` line ~6393

Replace the existing body construction in `runRecognisedDeviceKeyCheckin`:

```javascript
const body = {
  mode: 'device_key_scan',
  devicePayload: env,
  deviceHash: env.hash || await hashPayloadToB64url(env),
  device_pub_fp: env.pub_fp,
  expected_id: row.id || row.expected_id || null,
  attendeeLabel: expectedDisplayName(row),
  name: expectedDisplayName(row),
  score: settings.minScore || 50,
  bioVerified: !!settings.bioRequired
};
```

with the corrected version (matching the test env diff above):

```javascript
// v5.9.0.11 — Worker /org/checkin only accepts mode=attendee_scan|doorman_scan;
// mode='device_key_scan' was never implemented server-side and was returning
// 422 "mode must be attendee_scan or doorman_scan". Recognised device-key scan
// is semantically staff scanning a known attendee's device QR -> doorman_scan.
// Worker reads helloPayload.pub for pubKeyId / deviceKeyFp, so we synthesize
// helloPayload from the device-key envelope: env.pub_jwk -> helloPayload.pub.
// env.hash carries the hash of the original device-key envelope (including
// pub_fp + nonce + sig); we store it as helloHash so the audit trail keeps
// the actually-signed bytes, not a re-hash of the synthetic payload.
// Port from test env v5.7.1z.1 (10 May 2026 evening watch 2).
const syntheticHelloPayload = {
  v: env.v || 3,
  type: 'hello',
  pub: env.pub_jwk,
  ts: env.ts,
  org_code: env.org_code,
  nonce: env.nonce
};
const body = {
  mode: 'doorman_scan',
  helloPayload: syntheticHelloPayload,
  helloHash: env.hash || await hashPayloadToB64url(syntheticHelloPayload),
  attendeeLabel: expectedDisplayName(row),
  name: expectedDisplayName(row),
  score: settings.minScore || 50,
  bioVerified: !!settings.bioRequired
};
```

The rest of the function (developerBypass token retrieval, `createCheckin` call, queued/completed handling, `triggerAcceptCycleAnimation()` calls wired in v5.9.0.9, snapshot recognition path) stays unchanged.

### Pill bump

Bump `Build v5.9.0.10` → `Build v5.9.0.11` in `OrgCheckin.html` sidebar footer (search for `Build v5.9.0.10`).

Note: pre-bump pill state when you start may already be `v5.9.0.11` if Captain merged the celebration overhaul PR (which also claimed v5.9.0.10 — Number One's Org Terms work and Mr. Data's celebration overhaul both shipped as v5.9.0.10 in a clean 3-way auto-merge). If the pill shows `v5.9.0.10`, bump to `v5.9.0.11`. If something else, bump to next letter from that.

---

## Acceptance checklist

- [ ] `runRecognisedDeviceKeyCheckin` sends `mode: 'doorman_scan'` (NOT `device_key_scan`).
- [ ] Body includes `helloPayload` (synthesized from env.pub_jwk + other envelope fields), not `devicePayload`.
- [ ] Body's `helloHash` is `env.hash` (the original envelope hash, preserved for audit), with a fallback to `hashPayloadToB64url(syntheticHelloPayload)` if `env.hash` is missing.
- [ ] `device_pub_fp` and `expected_id` fields removed from body (Worker doesn't read them).
- [ ] Build pill bumped to next version letter.
- [ ] Verify nothing else in the function changed (developerBypass logic, token retrieval, createCheckin call, queued handling, success path, `triggerAcceptCycleAnimation()` hook, snapshot recognition logging).

---

## Out of scope

- Don't touch other check-in paths (`manualCheckin`, `runDoormanCheckin`) — those are already correct.
- Don't touch the Worker — the Worker's existing contract is correct; the bug is purely client-side.
- Don't touch the escalation modal flow — that's a different path.
- Don't bundle in any other test env work — strictly port-not-extend.

---

## Verification

Two-phone hardware test after deploy:

1. On live dashboard, navigate to Check-in panel (or any panel with venue QR visible).
2. Have one phone scan the venue QR → goes through org-entry → recognised as Kerry (or Spencer) → `attendee_scan` flow → already-working path → confirms Kerry is bound.
3. Now take a SECOND phone, generate Kerry's orange QR by visiting org-entry as Kerry's phone again, scan that orange QR with a staff phone via Process Scan on the dashboard (paste the URL or use Decode image).
4. `processDashboardScan` runs → recognition fires (Kerry is on Expected list with device_key_fp matching) → `runRecognisedDeviceKeyCheckin` fires with NEW body shape → Worker accepts (no more 422).
5. Kerry's row in attendance updates: `scan_count` increments, `last_seen` updates.

If the same flow worked BEFORE this PR (no 422 error), it means Captain wasn't hitting this path — either way, the PR closes the latent bug.

---

## PR title

`[codex] v5.9.0.11 — Forward-port v5.7.1z.1 device_key routing fix to live OrgCheckin`

Branch: `codex/v5.9.0.11-device-key-routing-live`.

Expected PR scope: Small (~15 lines body shape change + pill bump).

Single PR. Stop and raise if scope expands.

---

— Number One, 11 May 2026 mid-morning watch.
