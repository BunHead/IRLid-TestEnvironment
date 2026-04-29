# Unified Check-in + Role-Gated Dashboard

Date: 29 April 2026
Status: prototype note for Number 1 review

## Direction

Collapse the current Venue / Doorman split into one public Check-in flow and one permissioned Dashboard.

The public QR should represent the event check-in entry point. The system then decides the correct behaviour from attendee state, existing attendance, recognition, and policy.

## Check-in Flow

1. Attendee scans the event Check-in QR.
2. If the attendee is already checked in, offer Check-out and record it against Event Attendance after the existing signed checkout path.
3. If the attendee is not checked in, attempt recognition.
4. If recognised and allowed, show the allow screen and record attendance.
5. If recognised but not allowed, show the deny screen and do not record a successful attendance row.
6. If not recognised, show the review path and require staff assistance.
7. Staff assistance requires a verified Staff HELLO QR before privileged dashboard actions are available.

In this model, "Doorman" becomes a staff role/capability, not a separate QR mode. "Venue" becomes the public Check-in QR, not a separate product concept.

## Dashboard Direction

Move expected attendee add, edit, and delete actions into the Dashboard. Dashboard controls should appear according to the signed-in staff role.

Expected attendee management should not live in the public check-in path. Public check-in can request review or staff assistance, but the actual add/edit/delete operations belong in the permissioned dashboard.

## Navigation Direction

Recommended left navigation order:

1. Organisation
2. Check-in
3. Dashboard
4. Settings, still separated at the bottom of the nav

Check-in should become the public-safe event QR screen. It should show the branded Check-in QR and event identity, but no attendance table, expected attendee list, names, debug controls, or private operational data. This keeps the screen safe to display at a venue entrance or in view of attendees.

Dashboard should become the private staff/admin surface for attendance, expected attendees, staff actions, and settings-adjacent operations.

## Roles

Use explicit roles for authorization, not a fuzzy staff rating.

Recommended role ladder:

- `recognised`: can view their own relevant receipts or proof surfaces only.
- `supporter`: can access event receipt/supporter views where appropriate, but cannot manage attendees.
- `staff`: can verify Staff HELLO, view attendance, add attendees, and assist review cases. Staff cannot delete attendees, clear data, configure settings, or manage staff roles.
- `manager`: can add, edit, and delete attendees, resolve routine review cases, and perform routine event attendance operations.
- `lead_admin`: can do everything in the event dashboard, including attendee management, clear test/event data, configure event settings, and manage staff membership.
- `developer`: a prototype/dev-only working role with Lead Admin powers plus diagnostics, so the real Lead Admin role can stay clean during implementation.

Founder remains an honorary/organisation concept for now, not a separate dashboard view. The exact role names can be refined, but authorization should remain role-based. If a trust score or reputation score is added later, it should sit beside role rather than replacing it.

Staff, Manager, Lead Admin, and Developer members should be auto-added to the expected attendee surface when they are known to the organisation, unless a future setting disables staff auto-add or they are explicitly on a deny list.

## Staff HELLO Confirmation

Prefer step-up Staff HELLO confirmation for privileged writes instead of relying only on a long-lived timeout.

Suggested model:

1. Staff can view the dashboard according to their signed-in state.
2. When they attempt to add, edit, delete, clear, configure, or save a privileged change, the UI asks them to rescan their Staff HELLO QR.
3. The Worker verifies the fresh Staff HELLO proof.
4. The Worker checks that staff member's role against the attempted action.
5. If allowed, the write is saved.
6. If denied, the UI shows a clear role/permission message.

This gives the demo a simple story: view with a staff session, change things with a fresh Staff HELLO confirmation.

## Compatibility Notes

Keep existing QR URL parameters working as aliases during migration:

- `type=venue` can alias to canonical `type=checkin`.
- `type=doorman` can alias to staff/review presentation paths.
- `type=checkout&t=<token>` remains valid for short checkout QR flows.

The likely canonical future route is `org-entry.html?type=checkin`.

## Suggested Batch Shape

1. Documentation and naming pass: define Check-in as the public front door and Dashboard as the permissioned operations area.
2. Add `type=checkin` while preserving `venue` and `doorman` aliases.
3. Reorder navigation to Organisation, Check-in, Dashboard, with Settings retained at the bottom.
4. Make Check-in a public-safe branded event QR screen.
5. Move expected attendee add/edit/delete into Dashboard-only sections.
6. Add role-gated visibility and Worker enforcement for dashboard actions.
7. Add Staff HELLO step-up confirmation before privileged writes.
8. After behaviour is stable, redesign the screens around the simplified model.

## Prototype Night Shift Notes

Current `OrgCheckin.html` is a prototype sidecar, not the stable `org.html`.

- Public Check-in now prioritises the branded event QR and hides the explanatory text when the viewport gets tight.
- Fullscreen QR should show a deliberately subtle `Last Refreshed: mm:ss` marker and refresh just after each minute to prove the displayed QR is live.
- Tablet/small-height layouts should constrain QR size by visible viewport height so the code never disappears below the frame; fullscreen should request browser fullscreen and gracefully fall back to an in-page overlay.
- Public Check-in should first ask whether the scanning device has an active check-in, offer signed Check-out when it does, and otherwise continue through recognition, assisted identity, and allow/deny check-in.
- Dashboard role switcher should expose Staff, Manager, Lead Admin, and Developer.
- Staff can add attendees but cannot delete.
- Manager can add and delete attendees.
- Lead Admin can do everything.
- Developer can do everything Lead Admin can, plus prototype/dev diagnostics.
- The dashboard add control should be Add plus an add-as selector: Staff can add Attendee only; Manager and Lead Admin can add Attendee/Staff/Manager; Developer can add everything.
- Expected attendees are folded into the Attendance Today table so the separate expected list does not duplicate names.
- Add/delete is still prototype UI. The next real wiring pass should enforce roles in the Worker and request a fresh Staff HELLO proof for privileged saves.

## Tomorrow Wiring List

- Verify the Batch A layout fix on the old tablet and desktop: Dashboard content now scrolls inside the app frame, Attendance Today has a fixed-height scroll window, and role-gated actions sit inside a stable action cell.
- Re-smoke mobile/tablet Check-in QR containment: the QR is now sized against the usable content frame as well as viewport height so it should not disappear off the right side.
- Later tablet QR containment batch: the 29 April tablet photo shows an Outcome QR fullscreen/in-page overlay still clipping off the bottom edge. Treat this separately from the Check-in card fix; audit `scan.html` / shared fullscreen QR sizing so outcome QR shells reserve vertical room for the close button, title, and bottom safe area.
- Batch B public flow update: after an unrecognised attendee claims/selects themselves from the expected list, `org-entry.html` should now continue directly into check-in instead of asking for a second scan. Public entry URLs can include `score=<0-100>` for allow/deny-path smoke testing.
- Batch C role persistence update: the Dashboard add-as selector is backed by `org_expected.prototype_role` for the prototype, so Attendee/Staff/Manager/Lead Admin/Developer choices can survive refresh. This remains a prototype member-role field until the real Staff HELLO/member table is designed.
- Use debug-only role indicators if needed in the attendance table (`A/S/M/L/D`), but avoid public role leakage where attendee queues can shoulder-surf staff/admin status.
- Batch D locale update: `org.html` and `OrgCheckin.html` now prefer `en-GB` when the device time zone is a UK/Crown Dependency zone, otherwise they use the browser's first language. GPS/IP-derived locale remains future work; a VPN may test IP fallback later, but it does not prove GPS-derived region behaviour.
- Add a Staff HELLO scan/import step when adding attendee/staff/manager records, storing the derived hash/key placeholder that can later move into the enclave design.
- Add the staff auto-add rule with a setting to disable it and a deny-list override.
- Improve webcam QR scanning, especially with Windows Hello/camera devices that struggle to read dense QR codes.
- Minor dashboard polish: resize the Attendance Today table/action columns so expected-row actions stay readable.
- Minor dashboard polish: restore/clarify the disappearing "Awaiting check-out" style text where checkout state needs a passive label.
- Model "THE Dev" as global identity plus org-local/federated authorization: the same key can be recognised across orgs, but powers should remain explicit grants.
- Keep stable `org.html` intact until the prototype direction is approved.

## Demo Guidance

Do not start the fundamental visual redesign before Number 1 returns. The current test environment is showable, and the next redesign should begin from this role-gated architecture rather than from isolated screen polish.
