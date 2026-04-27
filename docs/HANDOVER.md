# IRLid Test Environment - Handover Log

## Current Status

TestEnvironment is the active sandbox for organisation portal, venue QR, attendee entry, expected-attendee binding, signed check-in/check-out, and QR presentation work.

Live frontend:

- Portal: `https://bunhead.github.io/IRLid-TestEnvironment/org.html`
- Entry: `https://bunhead.github.io/IRLid-TestEnvironment/org-entry.html`
- Scanner: `https://bunhead.github.io/IRLid-TestEnvironment/scan.html`

Test Worker:

- `https://irlid-api-test.irlid-bunhead.workers.dev/`

## Recent Landed Work

- Batch 8: cryptographic identity/check-out foundation.
- Batch 9: fullscreen QR and doorman flow polish.
- Batch 10: expected attendees in both modes and identity recovery foundation.
- Batch 11: first-scan expected-attendee claim flow and scan outcome flashes.
- Batch 12: fullscreen QR regression fix, attendee HELLO QR, shared QR fullscreen shell, Venue/Doorman height equalisation.

Batch 12 had a stacked-PR carry-forward issue: PR #37 reached `main` first, while PR #38/#39 initially landed only on stacked branches. PR #40 carried the full Batch 12 stack onto `main`.

## Known Live Hardening Items

The user still observed after PR #40:

- Checkout QR position sometimes appears as a white square.
- Bottom settings/check-in controls can sit too close to the viewport/taskbar edge.

A follow-up hardening branch should be merged before Batch 13 protocol work begins.

## Current Protocol Direction

Batch 13 is drafted in root `HANDOVER.md`.

Priority:

1. Staff auth session foundation.
2. Staff Auth UI smoke panel.
3. Enforce staff auth for manual check-in.
4. Checkout token API foundation.
5. Short checkout QR UI.

Optional debug maintenance:

- Add a guarded test-only dashboard action for clearing smoke/test attendance rows from the current debug org.

These are protocol tasks, not visual polish. Expect Worker + D1 + frontend changes.

Batch 13 was intentionally split smaller after live checkout QR debugging showed that apparently simple QR UI changes can hide browser-specific rendering failures.

## Guardrails

- TestEnvironment only.
- Do not touch live `BunHead/IRLid`.
- No retroactive database rewrites.
- D1 migrations must be idempotent.
- GitHub Pages deployment must be checked directly after merge.
