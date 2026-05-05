# HANDOVER-AssistQR.md — Mr. Data Brief (Bake-off Piece B, Batch C.6)

**Issued:** 5 May 2026 by Number One.
**Repo scope:** `BunHead/IRLid-TestEnvironment` only. Do not touch live `BunHead/IRLid`.
**Working rule:** narrow tasks per PR. This handover is one coherent feature spanning phone + Worker + dashboard; ship as a small stack of PRs (spec → Worker endpoints → phone QR → dashboard modal) so each piece is reviewable independently.
**Bake-off context:** This is one of two parallel pieces being built in a side-by-side evaluation. The other piece (`HANDOVER-YubiKey.md`) is being given to a different agent. Captain will compare quality of judgment, code discipline, spec adherence, and attention to no-regression edges.

## Goal

Implement the **assisted identity flow** — Captain's "When identity is unclear" design from the OrgCheckin dashboard. When an attendee scans the venue Check-in QR with an unrecognised device and isn't on the expected list, today's flow shows a "See an organiser" hold screen and stops. This batch makes that screen actionable: the phone displays a signed assist-request QR; staff scan it with the dashboard scanner; staff link the device to either an existing expected attendee or a newly-created one (or reject).

This closes the polish-4 gap where "I'm not on the list" was a dead-end. With C.6, every unrecognised attendee has a clean staff-mediated path to entry, with full audit trail.

## Background

Polish round 4 (yesterday, 4 May 2026 evening) changed `org-entry.html`'s "I'm not on the list" button to switch the picker into a "See an organiser" hold screen — same shape as the `allowSelfSelection === false` branch. This was correct: the previous behaviour POSTed an empty-name `/org/checkin` and produced ghost rows in the dashboard (the JfpA root cause). The Worker also gained a defence-in-depth reject for empty-name `attendee_scan`.

But the hold screen is currently a polite dead-end. Staff have no workflow other than the Add form on the Dashboard. Captain's design intent (per the "When identity is unclear" panel on the dashboard, lines 1493-1502 of `OrgCheckin.html`):

> Preferred path:
> 1. reuse normal IRLid scanner
> 2. detect HELLO vs venue QR vs **assist request**
> 3. if unmatched, go to assisted identity flow

This batch implements step 3.

## Spec — write first

Before any code, write **PROTOCOL.md §15 — Assisted Identity Flow** in the live repo at `D:\SkyDrive\Pen Drive\WEBSITES\IRLid-repo\PROTOCOL.md`. It lives between §14 (Identity-Bound Sessions) and the existing Version History. Section structure:

- §15.1 Phone-side QR generation: envelope format `{type: "assist_request", pub_fp, pub_jwk, ts, org_code, nonce}`, signed by device key (v3/v4 ECDSA or v5 hardware-backed via existing dispatcher), encoded as `H:` or `HZ:` prefix matching existing HELLO QR convention.
- §15.2 Staff-side scan and verification: dashboard scanner branches on `type` field; assist requests open the assist modal; signature verified server-side.
- §15.3 Bind / claim / reject paths with endpoint contracts.
- §15.4 Replay defence: `ts` window of 5 minutes; nonce optional but recommended for replay resistance.
- §15.5 Threat model rows for assist-QR shoulder-surf, replay, malicious staff scanner, false-name binding (staff types wrong name when creating expected → existing rebind flow with monthly cooldown is the recovery).
- §15.6 Backward compatibility: existing HELLO scans with no `type` field treated as `type: "checkin"` (current default behaviour).

Update the Version History table with a v5.6 row (or whatever version this lands as — confirm with Captain).

## Files involved

**Spec:**
- `D:\SkyDrive\Pen Drive\WEBSITES\IRLid-repo\PROTOCOL.md` — §15 Assisted Identity Flow

**Phone side (~60 lines):**
- `D:\SkyDrive\Pen Drive\WEBSITES\IRLid-TestEnvironment\org-entry.html` — "See an organiser" screen now displays signed QR; polling loop

**Worker side (~80 lines):**
- `D:\SkyDrive\Pen Drive\WEBSITES\IRLid-TestEnvironment\irlid-api\src\index.js` — assist-poll endpoint, create-and-claim endpoint, optional reject endpoint
- `D:\SkyDrive\Pen Drive\WEBSITES\IRLid-TestEnvironment\js\orgapi.js` — client wrappers for the new endpoints

**Dashboard side (~180 lines):**
- `D:\SkyDrive\Pen Drive\WEBSITES\IRLid-TestEnvironment\OrgCheckin.html` — scanner type-field branch, assist modal UI

## Behaviour

### Phone side

When the picker shows "See an organiser" (because the attendee tapped "I'm not on the list"), additionally display:

- A heading: "Show this to staff"
- A QR code below the message containing a signed assist-request envelope
- A status line: "Waiting for staff to scan..."
- A countdown / refresh: the `ts` window is 5 minutes; QR auto-refreshes if not claimed in time

QR payload: same `H:` / `HZ:` encoding as existing HELLO (use `irlidEncodeJsonToB64url` and `irlidCompressToB64url`). Envelope:

```js
{
  type: "assist_request",
  pub_fp: <device fp>,
  pub_jwk: <device pub jwk>,
  ts: <unix seconds>,
  org_code: <orgParam>,
  nonce: <random 16-byte b64url>
}
```

Signed with the device key via the existing v3/v4/v5 dispatcher — reuse the same signing path the venue HELLO uses, so v5 hardware-backed users benefit automatically.

Phone polls `GET /org/assist/poll/:fp?nonce=<n>` every 2 seconds (matching the §14 login poll interval). On `claimed` status, redirect to allow/review screen as the venue path does. On `rejected`, show a clear "Entry not approved — see organiser" screen. On timeout (5 min), regenerate the QR with a fresh `ts` and `nonce`.

### Worker side

**`GET /org/assist/poll/:fp?nonce=<n>`** — returns `{status: "pending" | "claimed" | "rejected", expected_id?, expected_name?, reason?}`. The poll record is keyed by `pub_fp + nonce` so different sessions don't collide.

**`POST /org/expected/create-and-claim`** — atomic create + claim. Body: `{first_name, surname, prototype_role, device_pub_fp, assist_nonce}`. Worker:
1. Validates the role per `isExpectedRoleAllowedFromDashboard` (no Developer)
2. Validates `assist_nonce` against an in-flight poll record (proof the staff is responding to a real assist request, not minting attendees from nowhere)
3. INSERTs `org_expected` row with `device_key_fp` pre-bound, `status='linked'`, `linked_at=now()`
4. Updates the assist-poll record to `status='claimed'`
5. Returns `{expected: <row>, link: {...}}`

**`POST /org/expected/:id/claim`** — already exists. Extend (if necessary) to update the assist-poll record so the polling phone gets the `claimed` signal.

**`POST /org/assist/reject`** — Body: `{assist_nonce, reason?}`. Worker:
1. Validates the nonce against an in-flight poll record
2. Writes an `event_attendance` row with `status='rejected'` (this is the forensic audit trail Captain specified — no DB write on the attendee side, deny path lives in `event_attendance`)
3. Updates the poll record to `status='rejected'`
4. Returns `{rejected: true}`

**Replay defence:** assist-poll records expire after 5 min. Stale `ts` rejected at submit time. Reused nonce rejected.

**Auth:** assist-poll endpoint is `pub_fp`-keyed and rate-limited per IP (similar to login claim — 3 fails per nonce → 5 min cooldown). Create-and-claim and reject require valid `staff_session` (existing pattern from `doorman_scan`).

### Dashboard side

The existing dashboard scanner (the doorman-mode QR scanner) gains a type-field branch. Today it parses HELLO envelopes and runs the check-in flow. After this batch:

```js
const env = decodeAndVerify(qrPayload);
if (env.type === "assist_request") openAssistModal(env);
else runDoormanCheckin(env);  // existing behaviour
```

`openAssistModal(env)` shows:

- **Header:** "Assist this attendee" with the device fp truncated (16 char short form) and time of request
- **Three action paths** as tabs or buttons:
  - **Pick from expected list** — search input + filtered list of unclaimed expected attendees → tap row → POST `/org/expected/:id/claim` with `device_pub_fp: env.pub_fp` and `assist_nonce: env.nonce`
  - **Add new attendee + bind to device** — first name + surname + role dropdown (filtered per existing `EXPECTED_ROLE_OPTIONS` for current viewing-as role) + create-and-claim button → POST `/org/expected/create-and-claim`
  - **Reject** — confirmation prompt + reason text + reject button → POST `/org/assist/reject`
- **Cancel** button at bottom: closes the modal without action; phone keeps polling until timeout

Modal styling matches the existing scan-panel + light-mode-aware (use existing `.scan-panel` + `.match-panel` classes, not new ones).

## Acceptance criteria

1. **Phone displays a signed assist QR** when on the "See an organiser" screen. QR is scannable with the dashboard scanner.
2. **Dashboard scanner detects `type: "assist_request"`** and opens the assist modal instead of running the check-in flow.
3. **Pick-from-expected path:** staff selects an unclaimed expected attendee → Worker claims → phone receives `claimed` status → phone redirects to allow screen.
4. **Create-new path:** staff types first/surname + role → Worker creates expected row with `device_key_fp` pre-bound + claims → phone redirects to allow screen.
5. **Reject path:** staff confirms reject → Worker writes `event_attendance` with `status='rejected'` → phone shows "Entry not approved" screen.
6. **Replay defence works:** an old assist QR (>5 min) is rejected by the Worker with a clear error message in the modal.
7. **No regression on the existing check-in flow.** Regular HELLO scans (no `type` field, or `type: "checkin"`) still produce normal check-ins.
8. **Developer role still rejected** on create-and-claim. Existing `isExpectedRoleAllowedFromDashboard` guard applies.
9. **Audit trail intact.** Every assist outcome (claim, create-and-claim, reject) leaves a corresponding row that survives `Clear test attendance` debug action correctly (rejects stay; claims reflect in attendance as normal).
10. **Polling stops cleanly.** Phone stops polling after a final state (claimed / rejected / timeout). No infinite polling loops.

## Test cases

| Case | Setup | Expected |
|------|-------|----------|
| Happy path: pick existing | Phone unrecognised, expected list has matching name | Staff scans assist QR, picks name, phone progresses to allow |
| Happy path: create new | Phone unrecognised, expected list empty | Staff scans, types name + role, phone progresses to allow |
| Reject path | Phone unrecognised, staff suspects fraud | Staff scans, picks reject, phone shows "Entry not approved", `event_attendance` row written with `status='rejected'` |
| Replay attempt | QR generated 6 min ago, scanned now | Worker rejects with "assist request expired"; modal shows error |
| Multiple phones, single staff | Two phones showing assist QRs, staff scans one | Only the scanned phone progresses; other phone keeps polling |
| Developer role attempt | Staff tries to create-and-claim with `prototype_role: "developer"` | Worker rejects 403 ("bootstrap or invite token only") |
| No regression: regular HELLO | Phone with valid expected match scans venue QR | Normal check-in flow runs, no assist modal opens |
| No regression: doorman manual add | Staff uses Add form on dashboard (unchanged path) | Existing flow still works, expected row created without device_key_fp |

## Out of scope (do not implement)

- Photo / additional proof capture (Settings has placeholders for this; deferred to v6)
- Mass assist mode (one phone at a time is fine for v5.6)
- Assist via legacy api_key flow (assist requires a logged-in staff session, no service-account path)
- Conflict resolution if `device_key_fp` is already bound to a different expected attendee — surface the conflict in the modal with the existing `rebind_history` mechanism (monthly cooldown), don't auto-rebind

## Notes on implementation discipline

- **Spec first.** PROTOCOL.md §15 lands as PR #1 of this batch. Worker code follows the spec, not the other way around. If you find a case where the natural implementation diverges from the spec, raise it as a question rather than silently editing one to match the other.
- **Stacked PRs.** Spec → Worker → phone → dashboard, four PRs. Each is reviewable independently. Do not combine all four into one giant PR.
- **Light mode aware.** Polish round 6 added comprehensive `[data-theme="light"]` overrides. Any new modal styling must work in both modes — test by toggling Settings → Theme → Light. Don't hardcode dark navy backgrounds.
- **Audit trail is the design intent.** Captain's deny-path-writes-`event_attendance` rule is non-negotiable. Reject must write a forensic row, not just hide the attempt. Do not redirect; do not silently drop.
- **No new auth surfaces.** Use the existing `staff_session` pattern for authenticated dashboard endpoints. Don't invent new auth tokens.

## Bake-off evaluation criteria (Captain reads this; you don't have to)

- Code quality: idiomatic JS, clear variable names, no dead branches, proper error handling.
- Spec discipline: PROTOCOL.md §15 written cleanly; implementation matches; any deviations called out.
- Test coverage: end-to-end happy paths + replay defence + at least one no-regression check.
- Attention to no-regression edges: existing HELLO check-in flow unchanged; existing dashboard Add form unchanged; existing expected-list claim endpoint behaves identically when called outside an assist session.
- Architectural taste: the modal UX, the audit-trail decisions, the way the polling and timeout interact — these are judgment calls. The spec gives the skeleton; the flesh is yours.

This is the load-bearing v5.6 piece. Ship it well.
