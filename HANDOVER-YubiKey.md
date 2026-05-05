# HANDOVER-YubiKey.md — Mr. La Forge Brief (Bake-off Piece A)

**Issued:** 5 May 2026 by Number One.
**Repo scope:** `BunHead/IRLid-TestEnvironment` only. Do not touch live `BunHead/IRLid`.
**Working rule:** one narrow task per PR. This handover is a single coherent change set; ship as one PR.
**Bake-off context:** This is one of two parallel pieces being built in a side-by-side evaluation. The other piece (`HANDOVER-AssistQR.md`) is being given to a different agent. Captain will compare quality of judgment, code discipline, spec adherence, and attention to no-regression edges.

## Goal

Allow IRLid v5 users to enrol an external FIDO2 hardware key (YubiKey, Google Titan, SoloKey, NitroKey) as their hardware-backed signing credential, instead of (or in addition to) a platform biometric authenticator.

This honours Captain's promise: biometric is convenient but never required. Users who don't want to provide biometric to their device can use a hardware key instead — same v5 protocol, same security properties, no biometric capture anywhere in the flow.

## Background

PROTOCOL.md §13 specifies v5 hardware-backed signing via WebAuthn. Today's `js/sign.js` calls `navigator.credentials.create()` with `userVerification: "required"`, which prompts for biometric or device PIN. The hardware signature itself doesn't require user verification — it's a separate, layered claim. Three relevant userVerification levels:

- `"required"` — biometric or PIN must succeed (current default)
- `"preferred"` — verify if available, else just user-presence (a tap)
- `"discouraged"` — just user-presence, no UV

For hardware FIDO keys, `userVerification: "discouraged"` plus `authenticatorAttachment: "cross-platform"` produces the desired flow: physical button tap signs, no biometric prompt.

The receipt's `bioVerified` flag in the signed envelope must honestly report `false` when a hardware key signed without UV. **Do not collapse the distinction** — the verification claim is layered, not collapsed into a single boolean.

## Files involved

- `D:\SkyDrive\Pen Drive\WEBSITES\IRLid-TestEnvironment\js\sign.js` — credential creation + assertion calls
- `D:\SkyDrive\Pen Drive\WEBSITES\IRLid-TestEnvironment\OrgCheckin.html` — Settings panel, v5 enrolment UI
- `D:\SkyDrive\Pen Drive\WEBSITES\IRLid-TestEnvironment\v5-test.html` — diagnostic page, may need a credential-type query-param
- Optional: `D:\SkyDrive\Pen Drive\WEBSITES\IRLid-repo\PROTOCOL.md` §13 — small clarifying note on UV semantics if you find any spec ambiguity. Do NOT make protocol changes; if unsure, raise a question rather than edit the spec.

Note paths: live spec is in the `IRLid-repo` directory but you are scoped to `IRLid-TestEnvironment` for code. PROTOCOL.md edits go via a separate PR if needed and are out of scope for this handover unless you find a contradiction.

## Behaviour

### Settings panel

Add a credential-type chooser to the v5 enrolment row in Settings. Two options:

- **Biometric (this device)** — current behaviour. Triggers Touch ID / Hello / fingerprint. Default selection.
- **Security key (USB / NFC)** — new path. Targets cross-platform authenticator with UV=discouraged. Physical button tap signs.

The chooser should be a clear radio/segmented control, not buried in an advanced expander. Users should see both options when they enrol.

The "Enrol credential" button text remains the same. The flow branches based on the chooser.

### Enrolment flow (security-key path)

When the user picks "Security key" and clicks Enrol:

```js
navigator.credentials.create({
  publicKey: {
    // existing fields (challenge, rp, user, pubKeyCredParams, etc.)
    authenticatorSelection: {
      authenticatorAttachment: "cross-platform",
      userVerification: "discouraged",
      requireResidentKey: false
    },
    attestation: "none"  // matches existing v5 enrolment
  }
});
```

Browser will prompt the user to insert / tap their security key. Once registered, the credential is stored in `localStorage` against the same v5 key shape used today. Add a `credentialType: "security_key"` field to the stored record so the assertion path knows which UV level to request.

### Assertion flow (signing)

When signing, read the stored `credentialType`. If `"security_key"`, call `navigator.credentials.get()` with `userVerification: "discouraged"`. Otherwise, current behaviour.

The signed v5 envelope must report `bioVerified: false` when a security-key credential signed. Do not lie about biometric verification.

### Multi-credential support

PROTOCOL.md §14's `portal_users` table supports multiple `pub_keys` per user. Today's enrolment registers one. **In scope for this handover:** allow a user to enrol an additional credential alongside an existing one, without overwriting the first.

UI: Settings → "Enrolled credentials" list shows all registered credentials with type and short fp. "Add another credential" button below the list opens the credential-type chooser. Users can have (e.g.) biometric on phone + security key as backup.

Server-side: the existing login endpoints accept any registered pub_fp; no Worker change needed for multi-credential support.

### v5-test.html

Add a credential-type radio at the top of the page so a tester can validate both paths against the same Worker. URL param shorthand also acceptable: `?cred=key` selects security-key path.

## Acceptance criteria

1. **Enrolment with YubiKey** produces a credential and registers `pub_fp` in `portal_users` (or local v5 store, depending on flow).
2. **Sign-in with YubiKey** produces a valid v5 envelope. Worker accepts. Receipt has `bioVerified: false`.
3. **A user with two credentials** (biometric + YubiKey) can sign in via either, and both map to the same `portal_users` row.
4. **Settings panel clearly labels the credential type** of each enrolled credential. User can see "biometric (Pixel 8 Pro)" vs "security key (YubiKey)" and tell them apart.
5. **No regression on the biometric path.** Existing users who only have biometric enrolled see no change. Default selection in the chooser is "Biometric" so the most common path is unchanged.
6. **`v5-test.html` allows side-by-side validation** of both paths.
7. **No biometric prompt appears** on the security-key path. If the browser still shows a biometric prompt during security-key enrolment, the `authenticatorAttachment` or `userVerification` setting is wrong.

## Test cases

| Case | Setup | Expected |
|------|-------|----------|
| YubiKey enrol fresh | Settings → Security key → Enrol | Browser prompts "Insert your security key", user taps disc, credential registered |
| YubiKey enrol with PIN | Same, key has PIN set via YubiKey Manager | Browser additionally prompts for PIN, user enters, taps disc |
| Sign-in with YubiKey only | Existing biometric removed, YubiKey only | Sign-in QR flow completes via YubiKey tap, no biometric prompt |
| Multi-cred user | Both biometric + YubiKey enrolled | Browser may offer credential picker; either choice signs correctly |
| Cross-device YubiKey | YubiKey moved from desktop to phone | Same credential ID assertable on phone (if NFC YubiKey) — no re-enrolment needed |
| `v5-test.html` security-key path | `?cred=key` | All six steps green, `bioVerified` reported as false |

## Out of scope (do not implement)

- PIN management on the YubiKey itself (user does this via YubiKey Manager)
- Backup-key listing UI beyond the multi-credential list (e.g., "designate as backup" tagging — that's a follow-up)
- Server-side revocation endpoint for lost credentials (separate piece of work)
- iOS Lightning YubiKey support (untested hardware path; document as known-untested)

## Notes on implementation discipline

- **Honest `bioVerified`.** This is the most important judgement call. The score model in PROTOCOL.md depends on accurate verification claims. A YubiKey-without-UV credential is hardware-signed but not biometric-verified. Report it as such.
- **Backward compat.** Existing v5 users (biometric only) must see zero change. The chooser defaults to biometric, the single-credential UI continues to work, no migration needed.
- **One PR.** Settings panel change + sign.js dispatcher + v5-test.html toggle in one focused PR. Don't open a second PR for the multi-credential list — it's load-bearing for the multi-credential test case.
- **Spec discipline.** If you find any case where the existing PROTOCOL.md §13 wording is ambiguous about UV semantics or `bioVerified` definition, **raise it as a question in the PR description**. Do not silently edit the spec.

## Bake-off evaluation criteria (Captain reads this; you don't have to)

- Code quality: idiomatic JS, clear variable names, no dead branches.
- Spec discipline: implementation matches PROTOCOL.md §13; any deviations called out explicitly.
- Test coverage: at minimum, the `v5-test.html` security-key path passes end-to-end on real hardware.
- Attention to no-regression edges: existing biometric users see zero change; existing receipts still verify; multi-credential users don't break either path.
- Honest reporting: `bioVerified` semantics respected; any limitations flagged.

Good hunting, Mr. La Forge.
