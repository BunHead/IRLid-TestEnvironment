# HANDOVER — `v6` Promotion (Master Brief — SKELETON)

**Drafted:** Sunday 10 May 2026 morning watch, by Number One. **Status: SKELETON ONLY.** Section headers + intent. Full drafting comes after `v5.9` Path A live port lands and the live shape is observable in production.
**Target agent:** TBD per chapter. Some pieces (schema unification, drone audit) are Mr. Data scope; some (typography pass, dyslexia work) may be Number One inline; some (worker consolidation) await Captain's call on operational appetite.
**Repo scope:** BOTH `BunHead/IRLid-TestEnvironment` (development) and `BunHead/IRLid` (live). Many chapters touch the Worker source on both sides.
**Priority:** Post-v5.9. Multi-week chapter. Each section below should become its own focused `HANDOVER-V6-<topic>.md` brief when its turn comes.

---

## Why this brief is a skeleton, not a full draft

The v6 chapter is large enough that drafting it before v5.9 ships would be premature on three counts:

1. **Schema unification** is the largest piece, and its design depends on the live D1 schema as the migration baseline. The baseline doesn't exist until v5.9 Phase 1 ships and Captain has run the production schema. Designing migrations against a still-evolving test env schema is wasted work.
2. **Drone audit window** and **zone-gated VIP** are primitives that should be designed against real venue-staff feedback once the dashboard is in actual use on irlid.co.uk. Two weeks of operating the live dashboard will surface friction the test env smoke can't.
3. **Recognition-mode UI** and **event-receipts integration** depend on §14.18 OAuth identity work (cross-org recognition, refined to user-held envelope on 9 May per Captain's GDPR call). The OAuth chapter may itself be v5.8 or may slip into v6 — that decision happens after v5.9.

So this skeleton lists the chapters, ordered roughly by dependency, with a 2–3 sentence intent per chapter. Each chapter graduates to a full brief when its predecessor lands.

---

## Chapter ordering (dependency graph)

```
v5.9 (live port) — already in flight
  ↓
v6.1 schema unification — pins production baseline, enables everything else
  ↓
v6.2 cross-org recognition (§14.18 OAuth identity) — if not shipped earlier as v5.8
  ↓
v6.3 recognition-mode settings — UI + Worker for prebind/postattribute/both
  ↓
v6.4 event-receipts integration — receipts page consumes event metadata
  ↓
v6.5 zone-gated VIP access — clean primitive on top of org_expected
  ↓
v6.6 drone audit window — protocol + Worker hooks (drone-to-recipient pattern)
  ↓
v6.7 GPS-nearest-staff — map widget on orange QR screen
  ↓
v6.8 §16 Tier 4 multi-device mesh — final tier of offline operation
  ↓
v6.9 typography + WCAG 2.1 AA full pass — surface-level polish across consumer + dashboard
  ↓
v6.10 Worker consolidation — fold irlid-api-org back into irlid-api (operational)
```

Order is suggested, not rigid. Several chapters are independent and can ship in parallel once their dependencies clear (e.g. typography pass can start any time after v5.9 lands).

---

## v6.1 — Schema unification

**Intent:** consolidate the consumer D1 (`irlid-db`) and Org D1 (`irlid-db-org`) into a single production D1, eliminating 5 identified duplicate concerns. The 5 consolidations from earlier successor-letter notes:

1. **User identity** — consumer `users` table + Org `staff` / `org_members` tables overlap on the same humans. Unified `users` with role join tables.
2. **Device fingerprints** — consumer `devices` + Org `device_keys` / `org_device_bindings` describe the same WebAuthn credentials. Unified `devices` with a per-org binding view.
3. **Receipts** — consumer `receipts` + Org `org_checkins` are two flavours of the same primitive (one is general purpose, one is venue-scoped). Unified `receipts` with optional `org_id` + `event_id` foreign keys.
4. **Sessions / tokens** — consumer Bearer tokens + Org `session_token` rows handle the same trust primitive. Unified `sessions` with `scope` field.
5. **Settings** — consumer `user_settings` + Org `org_settings` overlap on theming columns now that v5.5.8 website extraction lets users propose themes. Unified `theme_profiles` with `owner_kind = user|org` discriminator.

Migration strategy: 5 phased migrations, each shippable + reversible. Production-grade. Pinned to the v5.9-shipped live D1 as the baseline.

**Open question:** does unification merge the Workers too (folding `irlid-api-org` back into `irlid-api`)? Captain's call. Defer to v6.10.

---

## v6.2 — Cross-org recognition (§14.18 OAuth identity)

**Intent:** carry `PROTOCOL.md §14.18` OAuth identity work from the v5.8 design (refined Option 2 — user-held envelope, GDPR-clean) into implementation. Same human walking into a London venue Wednesday and a Christchurch venue Thursday is recognised across orgs without the Worker storing identifying info. Worker stores only `link_hash`; identifiers live in the user-held envelope.

**Key sub-pieces:** envelope shape (per spec §14.18), linking flow (provider OAuth → envelope sealed locally → `link_hash` POSTed to Worker), verification flow (each org's recognition checks `link_hash` against its allowlist or trust-network).

**May ship as v5.8 instead** if we get to it before v6 starts. Decision: at the close of v5.9 watch.

---

## v6.3 — Recognition-mode settings

**Intent:** surface the `recognition_mode` field added as v5.9 placeholder stub. Three modes:

- `prebind` — current behaviour. Attendee must be on the Expected list before they can scan in.
- `postattribute` — attendee scans first, gets attributed to an Expected row (or queued for staff to attribute) after.
- `both` — either path allowed. Attribution-after path used when prebind misses.

UI: dropdown in Settings → Operations. Worker: existing endpoints respect the mode for new check-ins.

---

## v6.4 — Event-receipts integration

**Intent:** when an Org check-in produces a receipt, attach event metadata (`event_id`, `slot`, `location-fingerprint`, `org_name`) so `receipt.html` on the consumer side can render the venue context. Closes the loop from "I scanned in somewhere" to "I have a receipt that says where, when, and at what event". Consumer-facing benefit: receipts become genuinely useful as proof-of-presence artifacts.

**Schema dependency:** v6.1 unification (receipts table merge). **Stub already in place:** `event_meta_json TEXT` column from v5.9 Phase 2 placeholder.

---

## v6.5 — Zone-gated VIP access

**Intent:** Captain's "raised eyebrow" idea — a clean primitive on top of existing `org_expected` rows for granular access control within a venue. An Expected row can have one or more `zone` tags (`vip-lounge`, `backstage`, `green-room`). The dashboard gateway gates check-ins by zone; recognition surface shows zone badges; orange QR can deny entry to non-zone-holders with a courteous message.

**Schema:** new `org_expected_zones` join table. **UI placeholder already in place** (`data-zone` attribute on attendance rows, v5.9 Phase 2 placeholder).

---

## v6.6 — Drone audit window

**Intent:** support the drone-delivery use case (ASE Tech / Wisdom and similar). When a drone delivers a parcel, the recipient must prove presence + identity at the drop. Pattern: drone broadcasts a short-lived QR; recipient scans; cryptographic handshake completes the audit window. Drone-to-recipient handover is offline-capable (the protocol's core flow has been offline-capable since v3 — no Worker round-trip needed for HELLO/ACCEPT/COMBINED).

**Includes Task #22** — ASE Tech / Wisdom drone delivery use case notes from earlier watches.

**Spec extension:** new `PROTOCOL.md §17 Drone Handover Pattern` section. Worker: minimal — the audit trail uploads asynchronously when either party regains connectivity. Banked from 9 May Captain question: *"can offline let in those it's recognised before?"* — yes, by the same primitive.

---

## v6.7 — GPS-nearest-staff map widget

**Intent:** when an attendee hits the orange "not recognised" state, the screen renders a small map widget showing the venue floor with the attendee's GPS position and the nearest available staff member (live position from staff devices polling /staff/locate or similar). Reduces the staff-find friction that drives current escalation flows.

**UI placeholder already in place** (`div#nearest-staff-map` mount point, v5.9 Phase 2 placeholder). Map vendor: TBD — Leaflet (open-source, OSM tiles) is the leading candidate; avoids Google Maps key + ToS.

---

## v6.8 — §16 Tier 4 multi-device mesh

**Intent:** the final tier of `PROTOCOL.md §16` Offline-Capable Operation. When multiple staff devices are at a venue and connectivity is patchy, devices can mesh-sync recent state (Expected list, recent check-ins, snapshot freshness) over local network or WebRTC, so a phone that just came online can pull from a tablet that's been online longer. Builds on existing Tier 1 (PWA shell), Tier 2 (write queue), Tier 3 (cached snapshot).

---

## v6.9 — Typography + WCAG 2.1 AA full pass

**Intent:** systematic accessibility pass across both consumer and dashboard surfaces. Includes:

- Dyslexia-friendly typography option (Captain's area of interest — opt-in font like OpenDyslexic, increased letter spacing, paragraph spacing toggles).
- WCAG 2.1 AA colour contrast audit + fixes.
- Screen reader labels on all interactive elements.
- Keyboard navigation (Tab order + focus rings audit).
- Reduced-motion respect for animations.

Probably 3–4 separate sub-PRs rather than one mega-PR.

---

## v6.10 — Worker consolidation (operational)

**Intent:** fold `irlid-api-org` back into `irlid-api` after the schema unification (v6.1) makes them logically one. Single Worker, single D1, single deployment cycle, single CORS origin. Operational simplification, not user-facing.

**Captain's call** on whether this is worth doing — separation has its own benefits (independent deployment, blast-radius control). Decision deferred.

---

## Banked notes (from earlier watches, not yet a chapter)

- **Optional shift-start role confirmation** — useful when someone holds multiple roles and wants to scope down for the shift. Off by default; orgs opt in. Could fold into v6.3 recognition-mode work or stand alone.
- **AssistQR (§15)** — v5.6 brief still in flight at time of skeleton drafting. Promote to v6 chapter if not shipped before v5.9 lands.
- **Schema-fingerprint stability across migrations** — the 5-phase unification needs a way for the Worker to know which schema version is live without round-tripping. Add `schema_version` row to a new `meta` table; Worker reads at boot.

---

## Pre-v6 work that should land before this brief promotes from skeleton

- v5.9 Path A (in flight). Lands by Wednesday 13 May target.
- `v5.5.8` end-to-end smoke on test env Worker (still pending — Mr. Data shipped, wrangler deployed, Captain hardware-smoke pending).
- `v5.7.1w` position grid (drafted, queued for forwarding).
- DEV org api_key drift in test env Worker (small Worker patch, pending).
- IRLid logo contrast bug (proper diagnostic deferred — needs scan.html pattern + actual logo asset inspection).

When the above are clear, this skeleton starts converting to chapter briefs in dependency order.

---

— Number One, drafted as skeleton for v6 chapter planning, Sunday 10 May 2026 morning.
