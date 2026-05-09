# HANDOVER — `v5.5.13.1` Recognition Toast Tweak

**Drafted:** 9 May 2026, by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid-TestEnvironment` only.
**Priority:** Tiny polish on `v5.5.13` Tier 3 cached snapshot. No dependencies. Ship whenever.

---

## Context (read this first)

`v5.5.13` (your PR #97, merged 9 May) shipped Tier 3 cached snapshots. When the doorman flow recognises a returning regular by matching their `device_key_fp` against the cached snapshot — instead of the live in-memory list — the current implementation surfaces a toast notification (something like *"Recognised from local cache"* or similar wording).

You flagged this in the PR description: *"Offline recognition currently toasts when it used cached snapshot; can be made quieter if that is staff-facing noise."* Captain confirms it's noise — at a busy door, this would fire 50+ times an evening for routine recognitions.

This brief makes that quieter.

---

## Goal

Replace the toast with a `console.log` at the same call site. Recognition behaviour, audit trail, and user-visible UI are otherwise unchanged. Snapshot-source recognitions still happen, still record, still update the dashboard — just without the toast popup pestering staff.

---

## Files to modify

### `IRLid-TestEnvironment/OrgCheckin.html`

Locate the call site where the recognition toast fires. Likely inside `recogniseDeviceFp()` or whichever helper you wired the snapshot fallback into during `v5.5.13`. Look for the conditional that handles `source: 'snapshot'` (or however you tagged the snapshot match).

Replace the toast call:

```javascript
// Before (likely shape):
showToast(`Recognised ${name} from cached snapshot.`);

// After:
console.log('[snapshot] recognised by offline cache:', name, 'fp:', fp.slice(0, 8));
```

Format suggestions for the console line:

- Use the `[snapshot]` prefix to match the existing convention (`[scan]`, `[sw]`, `[staff_scan]` etc.) used elsewhere in the file.
- Include the matched name and the first 8 chars of the fingerprint for debug visibility.
- No `console.warn` or `console.error` — this is a normal-path event, not a problem.

Live-source recognitions (in-memory match, not snapshot fallback) probably already don't toast — if they do, leave them alone unless they're equally noisy. Scope this PR to the snapshot-fallback toast only.

---

## Acceptance checklist

- [ ] Recognition via cached snapshot no longer shows a toast.
- [ ] Recognition still works (the dashboard still updates the row, the check-in still records).
- [ ] Console shows `[snapshot] recognised by offline cache: ...` when the snapshot fallback fires.
- [ ] No regression on online recognition (live in-memory match).
- [ ] No regression on the offline-write-queue indicator (the OFFLINE red dot still appears when offline, etc).

---

## Branch & PR shape

- **Branch:** `codex/v5.5.13.1-recognition-toast-tweak`
- **PR title:** `[codex] [S] v5.5.13.1 — recognition toast → console.log`
- **Expected PR scope:** Small (~1–3 lines changed, single file, Captain auto-merge OK).
- **Single PR. Stop and raise if scope expands.**

---

## Out of scope

- Any other toast tweaks elsewhere in the dashboard.
- Changing the recognition flow itself.
- Adding new console output beyond the one snapshot-recognition line.
- Worker changes.

---

— Number One, drafted for Mr. Data, 9 May 2026.
