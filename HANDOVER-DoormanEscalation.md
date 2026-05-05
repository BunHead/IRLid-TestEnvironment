# HANDOVER-DoormanEscalation.md — Mr. Data Brief (`v5.7.0`, §14.17 Doorman Flow)

**Issued:** 5 May 2026 evening by Number One.
**Repo scope:** `BunHead/IRLid-TestEnvironment` only. Do not touch live `BunHead/IRLid`.
**Working rule:** narrow tasks per PR. Three PRs in this brief, in order; each is independently revertable.
**Spec authority:** `PROTOCOL.md §14.17` (live repo) — read it directly before starting. The spec is stable; implementation deviations are bug reports against either the spec or the impl, not silent edits.

---

## Goal

Implement the doorman flow's three-outcome state machine in code. The spec defines it as the canonical state machine that runs every time a scan envelope arrives at the dashboard's check-in surface during a live event — green (recognised + allowed), red (recognised + not allowed), orange (unrecognised, escalate to staff). The state machine has been *implicit* in `OrgCheckin.html` since Batch 8 (§14.17 backward-compat note); this work formalises it so the orange-state staff-mediated escalation is a deliberate path, not a polish-4 dead-end.

Once landed, the v5.6 AssistQR work (`HANDOVER-AssistQR.md`, §15) reuses the same escalation mechanic for attendee-initiated escalation. So this is the foundation; AssistQR layers on top.

---

## Discover before you implement

Some of this surface already exists in test env. Spend 15 min greping before any new code:

- **`requireFreshStaffProof`** (`OrgCheckin.html`) — already implemented for the Add path in earlier polish rounds. Reuse it.
- **Scanner type-discriminator branching** — the doorman scanner already parses `H:` / `HZ:` HELLO envelopes. Check whether type-branching exists on `type` field, or whether all envelopes go through one parser.
- **Multi-key binding plumbing** — the `rebind_history` table (Batch 10 / `v5.5.x`) is already present from the identity-recovery foundation. New work extends key set rather than replacing it.
- **`event_attendance` rejection rows** — already used by deny paths per Captain's audit-trail rule. Confirm the `status: "rejected"` write path exists; reuse it.
- **Polish 11 Task 2 (`v5.5.4`, just shipped)** — `requireDevOrStaffSession` helper. Useful for the bind-only / Choose-from-List path where Bearer suffices.

Extend rather than recreate. If you find an existing path that does 80% of what's needed, add the 20%. Raise a question on anything ambiguous before duplicating.

---

## Three PRs

### PR 1 — Worker: multi-key binding + role-gated Add endpoints with freshness gate

**Goal:** Server-side primitives for the staff-mediated escalation. No frontend changes in this PR.

**Files:**
- `irlid-api/src/index.js` — new helper, new/extended endpoints
- `js/orgapi.js` — client wrappers

**New helper:** `requireFreshStaffProof(request, env, org)`. Pattern: try Bearer session; if user is Developer (matches `BOOTSTRAP_DEVELOPER_FP`), allow without fresh Staff HELLO (per §14.17 last paragraph). Otherwise require both a valid `staff_session` AND that the underlying HELLO timestamp is within the configured freshness window (suggest 5 min; exposed as `STAFF_HELLO_FRESHNESS_S` env var, default 300). On stale, return `401 {error: "stale_staff_proof", fresh_required_within_s: 300}`.

**New endpoint — bind additional key (Choose from List):**

`POST /org/expected/:id/bind-additional-key`

Body: `{ pub_jwk, pub_fp }`. Auth: `requireDevOrStaffSession` (standing Bearer suffices; no freshness gate per §14.17 — visual confirmation is the auth ceremony).

Worker:
1. Validates `pub_jwk` shape and recomputes `pub_fp` from it; rejects on mismatch.
2. Fetches expected entry by `:id` for the active org. 404 if missing.
3. Inserts the new key into the entry's key set (additive — old keys remain valid until explicitly revoked through `rebind_history` recovery path).
4. Returns `{ ok: true, expected: <row with key set> }`.

Idempotent: binding an already-bound key returns `{ ok: true, already_bound: true }`.

**Extended endpoint — role-gated Add at the door:**

`POST /org/expected/create-and-bind` (extension of existing Add Attendee path)

Body: `{ first_name, surname, prototype_role, device_pub_fp, device_pub_jwk }`. Auth: `requireFreshStaffProof`.

Role gate (matches §14.17 table):

| Acting role | May add `prototype_role` |
|-------------|--------------------------|
| `staff` | `attendee` only |
| `manager` | + `staff` |
| `lead_admin` | + `manager`, `lead_admin` (subject to §14.9 count invariant — but that's an invariant on *deletion*, no upper bound on additions) |
| `developer` | all |

Worker:
1. Validates the role tier against the acting role; returns `403 {error: "role_not_permitted_at_door"}` on violation.
2. Atomically creates the `org_expected` row (or `org_memberships` row for staff/manager/lead_admin) with `device_key_fp` pre-bound and `linked_at = now()`.
3. Returns `{ ok: true, expected: <row> }` (or `{ ok: true, member: <row> }`).

**Acceptance:**

1. `bind-additional-key` adds a key to an existing expected entry; second call with same key returns `already_bound: true`.
2. `create-and-bind` with `prototype_role: "developer"` from a `lead_admin` returns 403 (developer is platform-level, not org-grantable per §14.9).
3. `create-and-bind` from `staff` with `prototype_role: "lead_admin"` returns 403.
4. `create-and-bind` without a fresh Staff HELLO returns 401 `stale_staff_proof`. Same call with Developer Bearer succeeds (no freshness gate per §14.17).
5. Existing `staff_session` flow continues to work for non-Add operations.
6. No regression on Polish 11 Task 2's Bearer-replaces-Staff-HELLO sweep — the `requireDevOrStaffSession` helper is unchanged.

**PR title:** `[codex] v5.7.0a — Worker: multi-key binding + role-gated Add at the door`

---

### PR 2 — Phone: orange-state QR rendering on `org-entry.html`

**Goal:** When the venue check-in flow detects "scanned, fingerprint not recognised, not on Expected List," the phone surfaces the orange state per §14.17 and polls for resolution.

**Files:**
- `org-entry.html` — orange-state UI + polling loop

**Behaviour:**

When the existing Worker check-in attempt returns "unrecognised" (no Expected List match for this `pub_fp`), instead of dropping into the legacy "See an organiser" hold screen (which polish 4 introduced as a dead-end stop), display the orange state:

- Background: orange (`#FF9500` — match existing scan-panel orange tokens if present, otherwise add)
- Header: a large "?" mark
- Sub-header: **"Get a member of staff"** in clear sans-serif
- QR: encodes the device's `pub_jwk` envelope. Format: `H:` or `HZ:` prefix matching existing HELLO QR convention. Envelope: `{ type: "device_key", pub_fp, pub_jwk, ts, org_code }` signed with the device key via the existing v3/v4/v5 dispatcher (reuse the same signing path the venue HELLO uses).
- Status line: "Waiting for staff to scan..."

**Polling:**

Phone polls `GET /org/expected/lookup-by-fp/:fp` (existing endpoint or extend if needed) every 2 seconds — same cadence as §14 login poll. On the response:

- If `status: "linked"` (Choose from List or Add completed) — phone progresses into the recognised+allowed branch (existing flow), shows the green confirmation, and check-in completes.
- If `status: "rejected"` (red branch, e.g. staff explicitly denied or attendee was added then deleted) — phone shows the existing red rejection screen.
- If `status: "pending"` — keep polling. After 5 minutes total, regenerate the QR with a fresh `ts` and re-poll (matches the assist-request 5-min replay window per §14.17 / future §15).

**Light/dark mode:** must work both. Use existing theme tokens; do not hardcode colours other than the orange accent.

**Acceptance:**

1. An attendee with an unrecognised device scans the venue QR; instead of "See an organiser" dead-end, sees the orange-state QR.
2. The QR is decodable by the dashboard scanner (same convention as HELLO QRs).
3. Polling loop runs every 2s; stops cleanly on terminal state (linked / rejected / 5-min timeout-and-regenerate).
4. After 5 min with no resolution, QR regenerates with fresh `ts` and polling restarts.
5. No regression: a recognised attendee (fingerprint matches Expected) still progresses through the existing green flow, no orange state shown.
6. No regression: an attendee on the Expected List but in a "denied" or "already-checked-in" state still gets the existing red rejection screen.

**PR title:** `[codex] v5.7.0b — Phone: orange-state QR on org-entry.html`

---

### PR 3 — Dashboard: scanner type-branch + escalation modal with role-tiered Add buttons

**Goal:** When dashboard scanner reads an orange-state device-key QR, branch into the escalation modal. Modal exposes Choose from List or role-tiered Add. Successful action triggers Worker endpoints from PR 1 and resolves the polling phone from PR 2.

**Files:**
- `OrgCheckin.html` — scanner type-branch, escalation modal UI, role-tiered Add buttons
- `js/orgapi.js` — wrappers for the new endpoints (`bindAdditionalKey`, extended `createAndBind`)

**Scanner type-branch:**

```js
const env = decodeAndVerify(qrPayload);
if (env.type === "device_key") openEscalationModal(env);   // new: orange QR
else runDoormanCheckin(env);                                // existing: HELLO QR
```

(The same dispatch shape AssistQR will use for `type: "assist_request"` later. Don't fight that — design the dispatch so it's a switch on `env.type`.)

**Escalation modal:**

- **Header:** "Escalation: unrecognised attendee"
  - Show truncated `pub_fp` (16-char short form)
  - Show "scanned at" timestamp (a few seconds ago, formatted for human reading)
- **Two primary action sections** (mutually exclusive — radio-group vibe, but allow either to be tried):

  **Section A — Choose from List** (always visible):
  - Search input filtering the org's Expected List entries that have NO `device_key_fp` bound yet (i.e. unclaimed).
  - Tap an entry row → confirm dialog ("Bind this device to <name>?") → POST `/org/expected/:id/bind-additional-key` → on success, close modal, show toast "Bound to <name> — check-in proceeding". The polling phone (PR 2) sees `linked` and progresses.

  **Section B — Add at the door** (role-gated visibility):
  - Visible role tabs: Attendee (always); Staff (manager+); Manager + Lead Admin (lead_admin+); All (developer).
  - For each visible tab: first name + surname inputs + Add button.
  - On Add: call `requireFreshStaffProof`-gated endpoint `/org/expected/create-and-bind`. If freshness gate fires (`401 stale_staff_proof`), surface the existing Staff HELLO prompt to capture a fresh proof, then retry.
  - On success, close modal, show toast "Added <name> as <role> — check-in proceeding". The polling phone progresses.

- **Cancel** button at bottom: closes the modal without action; phone keeps polling until 5-min timeout.

**Reuse:**

- `requireFreshStaffProof` helper from PR 1 (Worker side); the existing client-side Staff HELLO modal opens automatically on `401 stale_staff_proof`.
- Existing role-tier helpers (`effectiveRoleRank()` from the Tuesday afternoon fix `c58b23c`; `prototypeRoleRank()` for prototype-role testing dropdown).
- Existing search-and-filter pattern from the Add Attendee form.

**Acceptance:**

1. Captain (Developer) scans an orange QR → escalation modal opens, all four role tabs visible, no Staff HELLO prompt (Developer Bearer suffices).
2. A `lead_admin` (non-Developer) scans an orange QR → modal opens, three role tabs visible (Attendee, Staff, Manager + Lead Admin), Add submits trigger Staff HELLO prompt the first time freshness has expired.
3. A `staff` member scans an orange QR → modal opens, only Attendee tab visible, Choose from List visible.
4. Choose from List: tap an unclaimed expected entry → bind succeeds → modal closes → polling phone progresses to green within 2s.
5. Add Attendee: type name → bind succeeds → modal closes → polling phone progresses to green within 2s.
6. Cancel: closes modal cleanly; phone keeps polling.
7. Light + dark mode parity (use existing `[data-theme="light"]` tokens).
8. No regression on existing HELLO scan flow (dispatch only branches when `env.type === "device_key"`).

**PR title:** `[codex] v5.7.0c — Dashboard: doorman escalation modal with role-tiered Add`

---

## Test cases (across the three PRs)

| Case | Setup | Expected |
|------|-------|----------|
| Happy: unrecognised → Choose from List | Attendee A scans, fingerprint not recognised; Expected list has matching name unclaimed; staff scans orange QR, picks A | Phone progresses to green; `org_expected.device_key_fp` populated for A's row |
| Happy: unrecognised → Add Attendee | Attendee B scans, fingerprint not recognised; Expected list empty; staff scans orange QR, types name, taps Add as Attendee | Phone progresses to green; new `org_expected` row created with `device_key_fp` pre-bound |
| Role gate: staff cannot add Lead Admin | Staff member with active session scans orange QR | Lead Admin tab not visible; Worker rejects 403 if forced |
| Role gate: lead_admin cannot add developer | Lead Admin scans orange QR | Developer tab not visible (developer is platform-level only) |
| Freshness gate: stale Staff HELLO | Lead Admin's Staff HELLO is 10 min old; tries Add | Worker returns 401 stale_staff_proof; client surfaces fresh-HELLO prompt; on success, retries Add |
| Bearer bypass: Developer | Captain (Developer) Bearer session, no fresh Staff HELLO | Add succeeds without freshness prompt |
| Multi-key binding: idempotent | Same `pub_jwk` bound twice via Choose from List | Second call returns `already_bound: true`; row state unchanged |
| Polling timeout: 5 min | Orange QR generated; no staff scans for 5 min | Phone regenerates QR with fresh `ts`; polling restarts |
| No regression: recognised flow | Attendee with bound key scans venue QR | Green flow runs, no orange, no escalation modal |

---

## Out of scope

- **AssistQR §15** — separate v5.6.0 brief in `HANDOVER-AssistQR.md`. Different trigger (attendee-initiated via "I'm not on the list" button), shares the staff-mediated escalation mechanic. Don't implement §15 here.
- **Reject path on the orange flow** — §14.17 doesn't define an explicit reject path for the orange state (rejection at the door is a §14.17 red-branch outcome via `event_attendance status='rejected'`, not a separate UI action). AssistQR §15 introduces an explicit Reject UI; that lands in v5.6.0, not here.
- **Multi-device-per-user (v5.6 forward)** — `user_devices` join table referenced in §14.12. Out of scope for v5.7.0 — multi-key binding here is per-`org_expected`-entry, not per-user-account.
- **`prototype_role` dropdown changes** — leave the prototype-role test dropdown alone. Real role gates use `qrLoginSession.is_developer` and the `effectiveRoleRank()` helper.

---

## Notes on implementation discipline

- **Spec is stable** (PROTOCOL.md §14.17 just merged via PR #2). If the natural implementation diverges, raise it as a question rather than silently editing one to match the other.
- **No new auth surfaces.** Reuse `requireDevOrStaffSession` (Polish 11 Task 2) and the freshness-gate helper from PR 1. Don't invent new auth tokens.
- **Light mode aware.** Polish round 6 added comprehensive `[data-theme="light"]` overrides; orange-state UI on phone and escalation modal on dashboard must work in both modes.
- **Audit trail intact.** Every escalation outcome (Choose, Add, Cancel-then-timeout) leaves an appropriate `event_attendance` or `org_expected` row that survives `Clear test attendance` debug action correctly.
- **Stop point.** Stop after each PR; report PR link, deployment state, and any D1 migration applied. Do not chain PR 2's frontend work onto PR 1's Worker work without a review between.

---

## What this unblocks

- **AssistQR (v5.6.0)** — once §14.17 is implemented, the v5.6.0 work in `HANDOVER-AssistQR.md` becomes a thin layer on top: the assist-request QR is a different envelope `type` flowing through the same escalation modal, with the addition of an explicit Reject UI surface.
- **§14.18 OAuth identity link / recovery quorum (v5.8.0)** — depends on multi-key binding being live to support key rotation through the recovery path.
- **Multi-device-per-user (v5.6 forward)** — extends the multi-key binding pattern from per-Expected-entry to per-`portal_users` row.

Good hunting, Mr. Data. Three PRs, in order.
