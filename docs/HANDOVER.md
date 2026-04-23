IRLid Test Environment — Handover Log (Full)
Status

End-to-end QR → scan → entry flow operational in test environment.

System is frontend-driven with mocked decision logic.

Environment
Frontend: https://bunhead.github.io/IRLid-TestEnvironment/
Scanner: https://bunhead.github.io/IRLid-TestEnvironment/scan.html
Portal: https://bunhead.github.io/IRLid-TestEnvironment/org.html
Entry: https://bunhead.github.io/IRLid-TestEnvironment/org-entry.html
Worker (test): https://irlid-api-test.irlid-bunhead.workers.dev/
Architecture

QR codes encode URLs (not JSON payloads).

Flow:

QR → scan.html → redirect → org-entry.html → render state
scan.html = router
org-entry.html = renderer
org.html = QR generator + config
Parameter Contract (CRITICAL)

org-entry.html reads:

type → venue | doorman
mode → allow | review | deny (doorman only)
org → string
event → string
returnAllowed → true/false
redirect → optional URL
logo → optional URL
welcome → optional string
Key Outcomes

✔ Frontend ↔ worker connectivity confirmed
✔ CORS resolved
✔ /auth/me responding
✔ QR → scan → entry routing works
✔ Venue QR working
✔ Doorman QR (mode-based) working
✔ Allow / Review / Deny states render correctly

Critical Fixes (Session)
Fixed crash:
venueQrPayload = buildVenuePayload();
Added mode param to QR URLs
→ required for correct outcome rendering
Fixed boolean parsing:
returnAllowed
Added mode handling in entry page:
mode → allow / review / deny
Known Issue (Resolved)

Bug: All scans showed green (allow)

Cause:

Missing mode param
Fallback default = allow

Fix:

Portal now injects mode
Entry reads and applies it
Behaviour
allow → green screen + tick
review → amber + question
deny → red + cross
QR System
Venue Mode
type=venue

→ Always allow (check-in flow)

Doorman Mode
type=doorman
mode=allow|review|deny

→ Simulates backend decision

Limitations
No signature validation
No real identity verification
Mock attendee data
No persistence beyond localStorage
Animations not final
Known Quirks
Browser cache can retain old QR behaviour
GitHub Pages caching delay
file:// mode uses fallback redirect
Missing params default to allow
Source of Truth

Portal (org.html) builds all QR URLs.

Entry page is stateless renderer only.

Next Steps
UX polish (animations + clarity)
Decide: mock-first vs backend integration
Implement signed QR payloads
Replace mock attendee logic
Clean legacy / duplicate settings paths
Summary

System is stable.
QR routing is correct.
Architecture is now coherent.

Ready for external review.
