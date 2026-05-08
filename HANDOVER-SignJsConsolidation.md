# HANDOVER — `v5.7.1i` `sign.js` Consolidation in `OrgCheckin.html`

**Drafted:** 8 May 2026, by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid-TestEnvironment` only.
**Priority:** First task — ship before `v5.5.12` so the offline-queue work builds on a clean base.

---

## Context (read this first)

`OrgCheckin.html` carries six private helpers prefixed `doorman*` (lines ~4391–4495) that are stale duplicates of canonical helpers in `js/sign.js`. The divergence already bit us once during `v5.7.0c-fix` on 6 May 2026 night: the `OrgCheckin.html` copy of the deflate decompressor used Chrome's `new Response(stream).arrayBuffer()` shortcut, which silently hangs on streams that error before emitting chunks; the canonical `js/sign.js` version uses an explicit reader loop. The fix landed in `OrgCheckin.html` only — the duplicate is now in sync, but the underlying drift risk remains.

This brief eliminates the drift risk by making `js/sign.js` the single source of truth.

---

## Goal

`OrgCheckin.html` imports `js/sign.js` once at the top and calls the canonical helpers directly. The six `doorman*` helpers are deleted. Behaviour is byte-for-byte unchanged — the doorman flow still works end-to-end (green / red / orange escalation, device-key QR scan, `HZ:`-compressed envelope decode).

---

## Files to modify

### `IRLid-TestEnvironment/OrgCheckin.html`

**Add to the `<head>`** (alongside any existing script imports near the top of the file):

```html
<script src="js/sign.js"></script>
```

`js/sign.js` exposes its helpers as global declarations (no IIFE wrapping the public surface), so once it's loaded, the canonical names below are available directly.

**Delete these six helper definitions** (lines ~4391 through ~4460, exact range to be confirmed when you open the file):

- `doormanB64urlDecode` (line ~4391)
- `function decoding b64url to JSON` — currently inlined as a one-liner around line ~4398 (the `JSON.parse(new TextDecoder().decode(doormanB64urlDecode(b64)))` shape — replace its callers, see below)
- `doormanDecompressB64urlJson` (line ~4400)
- `doormanCanonical` (line ~4424)
- `doormanB64urlEncode` (line ~4429)
- `doormanHashPayload` (line ~4434)

**Keep** `doormanVerifyDeviceEnvelope` (line ~4440) — this is a small composite that calls hash + verify together. Rename to `verifyDeviceEnvelope` (drop the `doorman` prefix) and rewrite its internals to use canonical names:

```javascript
async function verifyDeviceEnvelope(env) {
  if (!env || env.type !== 'device_key' || !env.pub || !env.payload || !env.sig || !env.hash) {
    throw new Error('Invalid device-key envelope.');
  }
  const payload = env.payload;
  const computed = await hashPayloadToB64url(payload);   // was: doormanHashPayload(payload)
  if (computed !== env.hash) throw new Error('Hash mismatch.');
  const pub = await crypto.subtle.importKey(
    'jwk',
    env.pub,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
  const sigOk = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    pub,
    b64urlDecode(env.sig),                                // was: doormanB64urlDecode(env.sig)
    b64urlDecode(env.hash)                                // was: doormanB64urlDecode(env.hash)
  );
  if (!sigOk) throw new Error('Signature invalid.');
  return { ok: true, payload };
}
```

(If your reading of the existing function shows different argument shapes, preserve the existing contract — the rewrite must be byte-equivalent to the current behaviour, just with different helper calls underneath.)

**Rename all call sites** elsewhere in `OrgCheckin.html` from the `doorman*` prefix to the canonical name:

| Old call | New call |
|---|---|
| `doormanB64urlEncode(bytes)` | `b64urlEncode(bytes)` |
| `doormanB64urlDecode(str)` | `b64urlDecode(str)` |
| `doormanCanonical(val)` | `canonical(val)` |
| `doormanHashPayload(payload)` | `hashPayloadToB64url(payload)` |
| `doormanDecompressB64urlJson(b64)` | `irlidDecompressFromB64url(b64)` |
| `doormanVerifyDeviceEnvelope(env)` | `verifyDeviceEnvelope(env)` |
| (the inline `JSON.parse(new TextDecoder().decode(doormanB64urlDecode(b64)))` pattern) | `irlidDecodeB64urlJson(b64)` |

Use a global find-and-replace; double-check the post-replace diff for each name.

---

## Acceptance checklist

- [ ] `<script src="js/sign.js"></script>` added to `OrgCheckin.html` head.
- [ ] Six `doorman*` helper definitions deleted from `OrgCheckin.html`.
- [ ] `verifyDeviceEnvelope` retained (renamed from `doormanVerifyDeviceEnvelope`); internals call canonical names.
- [ ] All call sites in `OrgCheckin.html` updated to canonical names.
- [ ] `grep -n "doorman" OrgCheckin.html` returns only references in comments / variable names that aren't helpers (`doormanEscalationState`, `doormanEscalationRole`, etc. — UI state, leave alone).
- [ ] No JS errors on page load (open DevTools console, hard-refresh).
- [ ] **Smoke test the doorman flow on test env** — Pixel 4a (or any unrecognised device) shows orange QR → screenshot uploaded to dashboard → `Decode image` + `Process scan` → escalation modal opens → either Choose-from-List or Add-at-the-door succeeds. Console should still show `[scan] decoded payload {type: 'device_key', pub_fp: '...'}`. No "Processing scan..." infinite hang.
- [ ] HZ-compressed orange QR also decodes (test the second device's already-registered case if convenient — or just a known compressed `device_key` envelope).

---

## Branch & PR shape

- **Branch:** `codex/v5.7.1i-signjs-consolidation`
- **PR title:** `[codex] v5.7.1i — sign.js consolidation in OrgCheckin.html`
- **Expected PR scope:** Small (~80 lines deleted, ~12 call-site renames, ~1 line added in `<head>`). Captain auto-merge OK after Number One eyeball.
- **Single PR. Stop and raise if scope expands.**

---

## Out of scope (do not touch)

- Any other duplicate-helper sweep across other HTML files (scan.html, org-entry.html, accept.html etc.) — those are separate PRs if they exist.
- Any change to `js/sign.js` itself.
- Any Worker-side change.
- Any new functionality.

---

## Why this matters

The drift between `OrgCheckin.html`'s `doormanDecompressB64urlJson` and `js/sign.js`'s `irlidDecompressFromB64url` cost three deploys to spot on 6 May 2026 night, with the symptom being a silent hang on `Process scan` for compressed envelopes — exactly the case staff phones produce in the doorman flow. After this PR lands, that class of bug cannot recur because the helper code lives in one place.

---

— Number One, drafted for Mr. Data, 8 May 2026.
