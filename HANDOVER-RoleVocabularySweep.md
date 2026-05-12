# HANDOVER — Role Vocabulary Phase 2: CSV + Dashboard Sweep

**From:** Number One
**Date:** 12 May 2026
**Status:** Drafted — ready for Mr. Data
**Precondition:** v5.9.0.13.14 merged on live (`OrgCheckin.html` + `irlid-api-org/src/index.js` — Role vocabulary panel + Worker validator already shipped). Confirm with `git log origin/main -1 -- OrgCheckin.html | grep v5.9.0.13.14`.

---

## Captain's scope (verbatim, 12 May)

> "Will the role vocabulary, feed into the CSV's, can you get Data doing something quickly..."

The Role vocabulary panel (v5.9.0.13.14) ships with the UI + persistence + a `roleLabel(roleKey)` helper. **Phase 2 is wiring the helper into every dashboard render site so the custom labels actually appear in the UI and CSV.**

---

## Task 1 — Add Role column to CSV export

`OrgCheckin.html` line ~7736 — `exportCSV()` currently outputs only Name / First seen / Last seen / Scan count. Add a fifth column **"Role"** that uses the custom label.

```js
const headers = ['Name or ID', 'First seen', 'Last seen', 'Scan count', 'Role'];
const rows = attendanceData.map(r => [
  r.name || r.id || '',
  r.first_seen ? new Date(r.first_seen * 1000).toISOString() : '',
  r.last_seen ? new Date(r.last_seen * 1000).toISOString() : '',
  r.scan_count || 0,
  roleLabel(r.prototype_role || r.role || 'attendee')
].map(csvEscape).join(','));
```

Add a `csvEscape(v)` helper that wraps strings containing commas/quotes/newlines in double quotes per RFC 4180 — current CSV builder doesn't escape and would break on a custom role label containing a comma (e.g. "Team lead, IT").

There may also be a separate CSV upload/import path (`triggerCsvUpload` at line ~7749, `parseDelimitedLine`) — if that imports a Role column, accept it but treat as informational; the live role of an attendee is set by Expected list metadata, not by CSV.

## Task 2 — Sweep dashboard render sites to use `roleLabel(roleKey)`

`window.roleLabel(roleKey)` is defined in `OrgCheckin.html`. Replace hardcoded role labels at every render site:

Grep targets to investigate:
- Attendance table Role column rendering (where the `S` / `L` / `D` role pills are built)
- Escalation modal role-tiered Add buttons ("Add as Attendee" / "Add as Staff" / etc.)
- Expected attendee management role badges
- Any toast strings that name roles (e.g. "Recognised attendee checked in" stays — that's the noun "attendee" generically — but anything keyed off `role` should map)
- Audit board Role column

Pattern:
```js
// before
const label = role === 'staff' ? 'Staff' : role === 'manager' ? 'Manager' : 'Attendee';
// after
const label = roleLabel(role);
```

Keep the underlying role keys (`attendee`, `staff`, etc.) as the storage form everywhere — only DISPLAY rendering goes through `roleLabel()`. Tests / Worker / DB stay unaffected.

## Task 3 — org-entry.html "Welcome [Role]" copy

If org-entry.html ever names the role (e.g. "Welcome, staff member" or "Please show this to a staff member"), pull the customised label via a small fetch of `settings.roleLabels` on page load, or pass via query param. **Lower priority** — most org-entry copy is role-neutral; only fix where the term is actually role-specific.

---

## Phase 2 verification checklist

- [ ] CSV export includes Role column with custom labels (e.g. Education preset → "Student" / "Lecturer")
- [ ] CSV escape covers comma/quote/newline in custom labels
- [ ] Attendance table Role column renders the custom labels
- [ ] Escalation modal "Add as ..." buttons render custom labels
- [ ] Switching presets in Settings → Save → reload shows the new labels everywhere on dashboard immediately
- [ ] Pill bumped (suggest `v5.9.0.13.15` if this lands solo, or align with whatever's also in flight)
- [ ] STATE-OF-PLAY.md + pending-work.md updated

Number One forward-ports to live (test env → live `OrgCheckin.html`) after merge + Captain verifies. Worker doesn't need a redeploy — only frontend changes.

---

## Out of scope (deferred)

- Server-side audit log of role-label changes (the existing settings_json history captures it implicitly via the org's updated_at)
- Multi-language vocabulary (would need a different architecture)
- Per-event-context override (one org-level vocabulary for now; multi-event-per-org is later)
