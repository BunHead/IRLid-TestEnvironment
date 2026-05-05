# HANDOVER-Polish11.md — Mr. Data Brief (Three Tightening Items)

**Issued:** 5 May 2026 by Number One.
**Repo scope:** `BunHead/IRLid-TestEnvironment` only. Do not touch live `BunHead/IRLid`.
**Working rule:** narrow tasks per PR. Three tasks here; ship each as its own PR (small stack).
**Sequencing:** Task 1 first (it's blocking morale on test-env feel-good). Tasks 2 and 3 can run in either order after.

---

## Context for this handover

5 May 2026 morning watch hit the wall on a settings-persistence bug that Number One could not pin down from code-reading alone after 10+ polish rounds. The core protocol is sound — theme colours persist correctly through the same `/org/settings` Worker endpoint — but `logoUrl`, `redirectUrl`, and `welcomeMessage` round-trips are not behaving. Polish 10 added a self-verifying save with toast outcomes (`✓ Settings saved and verified` / `⚠ Saved but didn't round-trip` / `Save failed`) but the morning watch closed before capturing the actual toast text on a save cycle, so we still don't know which layer is the broken one.

Other than that one stubborn bug, the test environment is in a good state:
- v5.5 identity-bound sessions live (PROTOCOL.md §14)
- QR-scan login works end-to-end on Captain's Pixel 8 Pro
- Bootstrap Developer recognised by env var `BOOTSTRAP_DEVELOPER_FP`
- Polish 5 closed the Developer-can-add-Developer recursive-trust hole
- Polish 9 extended `clearTestAttendance` to Developer (any org) + Lead Admin (own org) via Bearer session
- Polish 10 made `saveSettings` DOM-first with mandatory readback verification

Three remaining tightening items, packaged here. Captain's instruction was "sort out the bake-off and lets see how data handles it" — this handover sits alongside `HANDOVER-AssistQR.md` (Batch C.6, your primary bake-off piece) and `HANDOVER-YubiKey.md` (Mr. La Forge's piece, currently un-assigned).

---

## Task 1 — Settings persistence round-trip bug

**Goal:** Pin down why `logoUrl`, `redirectUrl`, and `welcomeMessage` aren't surviving an org switch + refresh, and ship the fix. The bug has been frustrating; it's the morale-blocker for tomorrow's test-env demo.

**Files in play:**
- `OrgCheckin.html` — `saveSettings()` (polish 10, DOM-first with readback) and `loadDashboardForOrg()` (resets state then fetches from Worker)
- `irlid-api/src/index.js` — `orgUpdateSettings()` and `orgGetSettings()` (Worker endpoints)
- `js/orgapi.js` — `updateOrgSettings()` and `getOrgSettings()` wrappers

**Diagnostic flow — do this first, do not skip:**

The morning watch already added comprehensive console logging to `saveSettings()`. Open the test env Settings page in a browser with F12 dev tools open. Type distinguishable values in all three Branding fields (e.g. `Logo URL: https://example.com/test1`, `Redirect: https://example.com/test2`, `Welcome: Test message 3`). Click "Save All Settings". Capture three artifacts:

1. **The toast text.** It will say one of:
   - `✓ Settings saved and verified` → Worker stored AND readback matched. Bug is in load path.
   - `⚠ Saved but didn't round-trip: <fields>` → Worker accepted but next GET returned different. Bug is in Worker merge.
   - `Save failed: <reason>` → POST itself errored. Reason text is in the toast.
   - `Saved locally — no signed-in org` → currentOrg.api_key wasn't set at click time.

2. **The console output.** Three `[settings save]` log lines should fire — `POST payload`, `Worker response`, and `Readback`. Screenshot or copy-paste them.

3. **The Worker's stored state.** In Cloudflare D1 console for `irlid-db-test`, run:
   ```sql
   SELECT api_key, settings_json FROM organisations WHERE name = 'Imbue Ventures';
   ```
   Compare what's in `settings_json` against what was POSTed.

**Three diagnoses, three fixes:**

- **If toast says `✓ verified` but values don't survive refresh:** the bug is in `loadDashboardForOrg()` line ~2576. `if (typeof s.logoUrl === 'string') portalState.logoUrl = s.logoUrl;` — check whether `s.logoUrl` is actually populating, whether `setPortalFieldValues()` is firing in the right order, and whether anything later (theme load, renderPortalAll, etc.) is clobbering the input values after they've been set. Likely a one-to-five-line fix.

- **If toast says `⚠ didn't round-trip`:** the bug is in the Worker merge loop at `irlid-api/src/index.js:1432`: `for (const k of allowed) { if (body[k] !== undefined) current[k] = body[k]; }`. Check whether the keys are arriving as `undefined` vs empty string, whether the validators above the merge loop are mutating `body`, or whether there's a race condition with concurrent theme saves. Likely a Worker-side fix.

- **If toast says `Save failed: <reason>`:** message tells you the failure mode directly. Could be CORS (allowlist needs an extra origin), a 422 (validator rejecting something), or a 500 (Worker exception logged in `wrangler tail`).

**Acceptance:**

1. Identify the layer (load / Worker / save) where the round-trip breaks, with evidence.
2. Ship the fix in a small PR with a clear root-cause description in the PR body.
3. Captain's repro: type values → Save → see `✓ Settings saved and verified` → hard refresh → values still populated. Switch to a different org, switch back → still populated.
4. No regression on theme persistence (which works today).
5. The polish-10 diagnostic logging in `saveSettings()` can be deleted in this same PR once the round-trip is verified working.

**If the bug turns out to be deeper than expected — STOP and raise.** This is a single-task PR, not an architectural rewrite. If you find that the fix requires schema changes, breaking endpoint contracts, or major frontend refactoring, write up your findings as the PR body and tag it `[needs-captain-review]` instead of pushing the rewrite. Captain will decide direction.

---

## Task 2 — Developer Bearer session bypasses Staff HELLO requirement

**Goal:** When a user is signed in as Developer (Bearer session token, recognised by `BOOTSTRAP_DEVELOPER_FP`), the dashboard should not prompt them for a separate Staff HELLO QR for privileged operations. The Developer Bearer session is already higher-privilege than a `staff_session`; requiring both is leftover logic from before v5.5 existed.

**Files in play:**
- `OrgCheckin.html` — `addExpectedAttendee()`, the prototype-role-toolbar gating, any other paths that prompt for Staff HELLO before allowing privileged actions
- `irlid-api/src/index.js` — endpoints that currently require `staff_session` (search `requireOrgStaffSession`)
- `js/orgapi.js` — wrappers that pass `staff_session` in the request body

**Behaviour:**

**Frontend changes:**

- `addExpectedAttendee()` and any handler that currently shows the "Staff HELLO required to add Lead Admin" prompt should first check `qrLoginSession?.is_developer === true`. If true, skip the Staff HELLO prompt entirely and submit with the Bearer session token (existing pattern from polish 9's `clearTestAttendanceDataset`).
- Same logic for any other gated dashboard action (manual check-ins, attendance row deletions, etc.) — if signed in as Developer, the Bearer session is sufficient auth.
- For Lead Admins (not Developer), the existing Staff HELLO requirement remains until v5.6's invite-token model lands. Don't touch that path yet.

**Worker changes:**

- Any endpoint currently calling `requireOrgStaffSession(env, org, staff_session)` should be extended to ALSO accept a Developer Bearer session as equivalent. Pattern: try `requireSession(request, env)`, check if user matches `BOOTSTRAP_DEVELOPER_FP`, if so allow without `staff_session`. If neither, return the existing 401.
- Keep `staff_session` working unchanged for backward compat. This is purely additive auth.

**Reuse the polish-9 pattern:**

Polish 9 already implemented this exact pattern for `orgDebugClearAttendance`:

```js
// existing isDebugOrg check
let allowed = isDebugOrg(org);
if (!allowed) {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+([A-Za-z0-9_-]{16,})$/.exec(auth.trim());
  if (m) {
    const ctx = await requireSession(request, env);
    if (!ctx.error) {
      const user = ctx.user;
      const bootstrapFp = (env.BOOTSTRAP_DEVELOPER_FP || "").trim();
      if (bootstrapFp && user.pub_fp === bootstrapFp) allowed = true;
      else {
        const membership = await env.DB.prepare(
          "SELECT role FROM org_memberships WHERE user_id = ? AND org_id = ?"
        ).bind(user.id, org.id).first();
        if (membership && (membership.role === "lead_admin" || membership.role === "developer")) allowed = true;
      }
    }
  }
}
```

Lift this into a helper `requireDevOrStaffSession(request, env, org)` and call it from each affected endpoint.

**Acceptance:**

1. Captain signed in as Developer can add a Lead Admin via the dashboard Add form without being prompted for a Staff HELLO QR.
2. Captain signed in as Developer can use any previously-staff-gated action (manual attendance ops etc.) without the prompt.
3. A Lead Admin who is NOT Developer still sees the Staff HELLO prompt for promotions (gated rollout — relax that in v5.6 with invite tokens).
4. Existing `staff_session` flows continue to work unchanged.
5. Worker endpoints accept either auth path.

**Out of scope:**

- Replacing the Staff HELLO concept entirely (that's v5.6 work)
- Bearer-session auth for Lead Admins on every gated action (defer to v5.6 invite-token batch)
- Changing the org-membership role permission matrix (that's bigger structural work)

---

## Task 3 — QR image upload in Staff HELLO dialog

**Goal:** Replace the "paste the QR payload as text" Staff HELLO dialog with a small upload-and-decode flow. User picks an image of a QR code (phone screenshot, photo of a screen, etc.) and the dialog decodes it client-side to extract the payload. Removes a friction point and is independently useful.

**Files in play:**
- `OrgCheckin.html` — the Staff HELLO dialog markup and `authenticateStaffHello()` function
- Decode library — see options below

**Behaviour:**

The existing dialog is a `prompt()`-style text input asking the user to paste the QR payload. Replace it with a small modal that has:

- A heading: "Authenticate Staff HELLO"
- Two input paths (use whichever the user prefers):
  - **File upload** (`<input type="file" accept="image/*">`) — user picks a screenshot of the QR
  - **Paste text** — original textarea for the payload string (keep as fallback)
- A "Decode and authenticate" button

When the user picks an image:
1. Read it as a data URL (`FileReader.readAsDataURL`)
2. Render it onto a hidden `<canvas>` element to extract pixel data via `getImageData`
3. Pass pixel data into a QR decoder
4. Extract the payload text, fill it into the textarea so the user can confirm before submitting
5. Submit the same way as today's text-paste flow

**Decoder choice:**

`jsQR` is the standard lightweight option (~46KB minified, Apache-licensed, no dependencies). Vendor it into `js/vendor/jsqr.min.js` rather than loading from a CDN — IRLid's bias is offline-safe and self-hosted.

If the QR contains an `H:` or `HZ:` prefix, the existing payload parsers in `js/sign.js` already handle both forms. The decoded text from the QR should be passed straight to `authenticateStaffHello()` without further interpretation.

**Acceptance:**

1. User picks a phone-screenshot of a HELLO QR → file upload field shows filename → click Decode → payload appears in textarea → click Authenticate → success.
2. Decode failures (image is not a QR, image is unclear, etc.) show a clear inline error: "Could not decode QR — try the text paste option or a clearer image."
3. The text-paste fallback remains for cases where a user has the payload string but no image.
4. No external network requests during decode (jsQR runs entirely client-side).
5. Works in light mode and dark mode (use existing `.alert` and form styles).

**Out of scope:**

- Live camera scanning (the dashboard already has a doorman scanner; a separate "use camera" path is a follow-up)
- Multi-QR batch decode
- Progressive image enhancement (just decode what you're given; if it fails, ask for a clearer image)

---

## Sequencing recommendation

1. **Task 1 first.** It's the morale-blocker and the diagnostic flow narrows it to a small fix. Once shipped, Captain can demo without the persistence frustration.
2. **Task 2 second.** Mechanical, copy-the-polish-9-pattern. Unlocks Captain's Lead Admin promotion workflow.
3. **Task 3 third.** Small UX win, can ship anytime after Task 1.

Three small PRs ideally, each independently revertable.

---

## Bake-off evaluation criteria (Captain reads this)

- Code quality: idiomatic, clear, no dead branches.
- Spec discipline: PROTOCOL.md untouched unless raising a question first; no silent rewrites.
- Diagnostic discipline on Task 1: artifact-driven (toast text, console logs, SQL row), not guesswork.
- Test coverage: end-to-end repro for each task; no-regression check on theme save (which currently works) for Task 1.
- Honest reporting: if Task 1 turns out to be deeper than expected, raise rather than rewrite.

This is alongside `HANDOVER-AssistQR.md` (your primary bake-off piece). Captain will compare quality on AssistQR; this handover is the "tightening pile" that comes after, in your preferred order.

Good hunting, Mr. Data.
