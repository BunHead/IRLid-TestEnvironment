# HANDOVER.md — Mr. Data Brief (Batch 8 — Cryptographic Identity Loop)

**Issued:** 27 April 2026 (afternoon) by Number One
**Recipient:** Mr. Data (Codex)
**Repo scope:** `BunHead/IRLid-TestEnvironment` only — do NOT touch `BunHead/IRLid`
**Working rule:** 3 atomic tasks. These are protocol-touching tasks; lower ceiling.

**Context:** Batch 7 polished the visible UX; this batch closes the **cryptographic identity loop** so the test environment is genuinely IRLid-grade — not just an attendance app with branding. Three gaps to close:

1. Check-out is currently a doorman button click — anyone could click it for anyone. It needs to be a real two-party signed event, like check-in.
2. Returning attendees on the same device still have to type their name — the device key should be recognised and the name auto-filled.
3. A second phone typing the same name as an existing bound attendee silently re-binds that name to the new device — that's a security hole. Conflicts should be flagged.

**Pre-requisite:** Batch 7 PRs (#18-#22) on main, GitHub Pages live. If GitHub Pages still shows old code, stop and ask.

**Hard constraint:** This batch may add Worker endpoints and schema columns. **All schema changes additive only — no rewrites of existing rows.** Check-in receipts already in D1 stay valid forever. Check-out adds new columns; conflict detection adds a new table.

---

## Task 1 — Cryptographic Check-out (signed by attendee, not just doorman click)

**Goal:** Replace the current "Check out" button (which silently fires `POST /org/checkout`) with a real two-party scan flow. The leaving attendee proves they're the same person who checked in by signing the check-out with the same device key.

**Files in scope:**
- `irlid-api/schema.sql` (additive: add `checkout_signature`, `checkout_payload_hash`, `checkout_ts` columns to the existing check-in table)
- `irlid-api/src/index.js` (extend `/org/checkout` to verify a signed payload; reject if signature doesn't match the original `pub` field)
- `org.html` (Doorman flow: "Check out" button now generates a check-out QR / triggers a scan instead of immediate fire)
- `accept.html` or wherever the attendee post-scan flow lives (handle a check-out HELLO; sign the check-out payload; submit)
- `js/orgapi.js`

**Server schema (additive):**
- New columns on the existing check-in row: `checkout_payload_hash TEXT NULLABLE`, `checkout_signature TEXT NULLABLE`, `checkout_ts INTEGER NULLABLE`
- Existing rows untouched; old check-outs (button-only) stay as they are with a flag `checkout_method = 'legacy_button'` (default `'signed'` for new ones)

**Server behaviour — `POST /org/checkout`:**
- Accepts `{checkin_id, checkout_payload, signature}`
- Looks up the original check-in row, retrieves its `pub` field
- Verifies `signature` over `SHA-256(canonical(checkout_payload))` using `pub`
- If signature valid: stores hash/sig/ts on the row, returns `{ok: true, checkout_method: 'signed'}`
- If signature invalid: returns 401 `{error: "invalid_checkout_signature"}`
- Existing legacy button-click path remains available behind a `checkout_method=legacy` query param for backwards-compat with old test rows; doorman UI no longer uses it for new flows

**Client behaviour — Doorman:**
- Doorman dashboard: "Check out" button now reads "Initiate check-out"
- Click → modal/inline panel shows a check-out QR specific to that attendee row (encodes `checkin_id` and a `nonce`)
- Doorman tells attendee: "Scan this on your IRLid page"
- When the Worker receives the signed check-out, dashboard updates the row to "OUT" + 🔒 hardware-style badge to indicate signed check-out

**Client behaviour — Attendee:**
- Their IRLid page (the one they used to check in) sees the check-out QR
- Reuses the same private key from check-in (still in localStorage)
- Signs `{checkin_id, nonce, ts}` and POSTs to `/org/checkout`
- Confirmation page: "✓ Check-out signed and recorded"

**Acceptance criteria:**
- Live smoke: complete check-in → initiate check-out → scan with same device → row marked OUT with `signed` method
- Live smoke: try to check out a different device's check-in row → 401 invalid_checkout_signature
- Old legacy-button check-outs still readable in dashboard (display as "OUT (legacy)" or similar)
- Migration applied to test D1; Worker version documented in PR

**PR title:** `[codex] Cryptographic check-out — signed by attendee, not just doorman click`

---

## Task 2 — Device-key recognition on return

**Goal:** When a device that has previously checked in for an org returns, the system recognises its device key and auto-fills the bound attendee's name. No typing required.

**Files in scope:**
- `irlid-api/src/index.js` (new endpoint `GET /org/recognize?device_pub=<base64url>`)
- `js/orgapi.js`
- `org.html` (or wherever the post-scan flow lives) — on page load, fetch recognition before showing the name input

**Server behaviour:**
- New endpoint `GET /org/recognize` with query param `device_pub` (the hash/fingerprint of the device's public key)
- Looks up most recent expected attendee row where `device_key_fp = ?` for this org
- Returns `{recognized: true, name: "Spencer Austin", expected_id: <id>}` or `{recognized: false}`
- Auth: bound to org by the org's host context (no X-Org-Key needed for read; rate-limited)

**Client behaviour:**
- On the attendee post-scan page: compute `device_key_fp = SHA-256(canonical(pub))` truncated to 16 chars (matches existing fingerprint convention)
- Call `GET /org/recognize?device_pub=<fp>`
- If recognised: pre-fill name field, show "Welcome back, [name]!" message; user can edit if wrong
- If not recognised: standard name-prompt flow as today
- Local cache: phone stores `(org_code, name)` pair in localStorage so recognition is instant on next visit even before server round-trip

**Acceptance criteria:**
- Live smoke: scan in as "Spencer Austin" → log out → return scan within same session → name auto-fills
- Live smoke: open in fresh incognito (different device key fp) → no recognition, normal flow
- Recognition gracefully degrades if endpoint fails (fallback to name prompt; do not block check-in)

**PR title:** `[codex] Device-key recognition on return — auto-fill bound name`

---

## Task 3 — Name-conflict detection (different device claims bound name)

**Goal:** When a check-in arrives with a typed name that matches an existing Expected Attendee already bound to a *different* device key, do NOT silently re-bind. Flag it as a conflict requiring doorman confirmation.

**Files in scope:**
- `irlid-api/src/index.js` (extend `POST /org/checkin` and `POST /org/expected` flows)
- `org.html` (Doorman dashboard: render `?` badge on conflict rows, inline Confirm/Reject actions)

**Server behaviour:**
- On `POST /org/checkin` with a `name` field:
  - Look up Expected Attendee row matching that name (case-insensitive)
  - If row exists AND has `device_key_fp` set AND incoming `device_pub`'s fp differs:
    - Insert the check-in row but mark `status = 'conflict'`, store both old and new device fps in a new `attendee_conflicts` table
    - Return `{ok: true, conflict: true, expected_id, conflict_id}`
  - If row exists and device_key_fp matches OR is unset: normal auto-link flow
  - If no row matches: walk-in flow (unchanged)

**Schema (additive):**
- New table `attendee_conflicts`: `id`, `org_code`, `expected_id`, `bound_device_fp`, `claiming_device_fp`, `claimed_name`, `created_at`, `resolution` (default null; can be `'confirmed_new_device'`, `'rejected'`, `'expired'`)

**Client behaviour — Doorman dashboard:**
- Conflict rows show a `?` badge (orange/amber) instead of `linked` or `assist`
- Inline action: "Confirm new device" (e.g., user got a new phone) / "Reject" (someone else trying to claim)
- Confirm → `POST /org/conflicts/:id/resolve` with `{resolution: 'confirmed_new_device'}`; binds new device fp to the expected row, marks conflict resolved
- Reject → resolution `'rejected'`; the conflicting check-in row is marked invalid; expected attendee stays bound to original device
- Worker endpoint `POST /org/conflicts/:id/resolve` does the appropriate update

**Acceptance criteria:**
- Live smoke: phone A checks in as "Spencer Austin" → bound. Phone B (different device) types "Spencer Austin" → check-in succeeds but row marked `conflict`; dashboard shows `?` badge
- Doorman clicks "Confirm new device" → conflict resolves, expected row now bound to phone B
- Doorman clicks "Reject" on a different conflict → that row marked invalid, expected row stays with original phone
- No regression on auto-link or walk-in paths

**PR title:** `[codex] Name-conflict detection on bound expected attendees`

---

## When all three are done

- One short summary message: which PRs landed, schema decisions, Worker version deployed, anything noticed
- Stop. Wait for the next `HANDOVER.md`.

## If you get stuck

- **Pre-requisite missing (Batch 7 not on main / Pages not live):** stop and ask
- **Cryptographic verification fails for legitimate signed payloads:** likely a canonicalisation mismatch — check that `canonical()` is applied identically client- and server-side, that base64url encoding matches, that the signed payload matches what's hashed
- **Schema migration fails on test D1:** stop, comment in PR, wait
- **Anything that touches `BunHead/IRLid` (the live repo):** stop immediately. Hard wall.

## Captain's note (relayed by Number One)

The Worker-signed QR payload work you proposed at Batch 6 close is queued for v6 protocol work — not in this batch. Stay focused on the three cryptographic-identity tasks above.

— Number One
