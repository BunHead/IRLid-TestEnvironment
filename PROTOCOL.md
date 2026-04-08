# IRLid Protocol Specification

**Status:** Draft  
**Version:** 3  
**Author:** Spencer Austin

---

## 1. Overview

IRLid is a browser-only proof-of-personhood protocol that enables two parties to mutually attest co-presence without any server infrastructure. All messages are exchanged directly (via QR codes); all cryptography and verification run client-side using the Web Crypto API.

The protocol produces three objects:
- `HELLO` — Party A's signed offer
- `RESPONSE` — Each party's signed acknowledgement
- `COMBINED RECEIPT` — The merged proof, verifiable by either party or a third party

---

## 2. Cryptographic Primitives

| Primitive | Usage |
|-----------|-------|
| ECDSA P-256 | Signing payloads and verifying signatures |
| SHA-256 | Hashing payloads and computing binding hashes |
| `canonical()` | Deterministic recursive JSON serialisation — sorts object keys at every level before hashing, making all hashes independent of property insertion order |
| deflate-raw | Compressing objects for QR encoding |
| base64url | Encoding binary data in URL-safe strings |
| Web Crypto API | Browser-native implementation (no external library) |

All keypairs are ephemeral — generated fresh each session, never reused.

---

## 3. Object Schemas

### 3.1 HELLO

```json
{
  "type": "hello",
  "v": 2,
  "pub": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." },
  "ts": 1710000000000,
  "nonce": "base64url-16bytes",
  "offer": {
    "payload": { "ts": 1710000000000, "nonce": "...", "gps": { "lat": 51.9, "lon": -1.4 } },
    "sig": "base64url-ECDSA-sig",
    "hash": "base64url-SHA256"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Fixed: `"hello"` |
| `v` | number | Protocol version (2) |
| `pub` | object | Ephemeral ECDSA P-256 public key (JWK, fields: kty, crv, x, y) |
| `ts` | number | Unix timestamp in milliseconds |
| `nonce` | string | 16-byte random value, base64url encoded |
| `offer.payload` | object | `{ts, nonce, gps?}` — signed offer data |
| `offer.sig` | string | ECDSA signature over `SHA-256(canonical(offer.payload))` |
~~`offer.hash`~~ | ~~removed in v3~~ | Previously stored the offer hash; verifier now recomputes from `offer.payload` |

### 3.2 RESPONSE

```json
{
  "type": "response",
  "v": 2,
  "payload": {
    "ts": 1710000000100,
    "nonce": "...",
    "helloHash": "base64url-SHA256-of-HELLO",
    "offerHash": "base64url-SHA256-of-offer-payload"
  },
  "sig": "base64url-ECDSA-sig",
  "pub": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." },
  "hash": "base64url-SHA256-of-payload"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Fixed: `"response"` |
| `v` | number | Protocol version (2) |
| `payload.ts` | number | Timestamp (ms epoch) |
| `payload.nonce` | string | Random nonce |
| `payload.helloHash` | string | `SHA-256(canonical(helloObj))` — binds to the HELLO |
| `payload.offerHash` | string | `SHA-256(canonical(offer.payload))` — binds to the offer |
| `sig` | string | ECDSA signature over `SHA-256(canonical(payload))` |
| `pub` | object | Ephemeral public key (JWK) |
| `hash` | string | `SHA-256(canonical(payload))` as base64url |

### 3.3 COMBINED RECEIPT

```json
{
  "hello": { "...": "HELLO object" },
  "a":     { "...": "Response from Party A (initiator)" },
  "b":     { "...": "Response from Party B (acceptor)" }
}
```

---

## 4. Protocol Flow

### Step 1 — HELLO Generation (Party A)
1. Generate ephemeral ECDSA P-256 keypair
2. Construct `offer.payload = { ts, nonce, gps? }`
3. Compute `offerHash = SHA-256(canonical(offer.payload))` (used for signing only; **not transmitted** in v3)
4. Sign: `offer.sig = ECDSA.sign(privateKey, offerHash)`
5. Assemble HELLO object with `type`, `v`, `pub`, `ts`, `nonce`, `offer`
6. Compress + encode: `accept.html#HZ=<deflate-raw(base64url(JSON.stringify(hello)))>`
7. Display as QR code

### Step 2 — ACCEPT (Party B)
1. Scan HELLO QR → decompress → parse HELLO object
2. Recompute: `offerHash = SHA-256(canonical(offer.payload))` (v3: not stored in HELLO)
3. Verify: `ECDSA.verify(hello.pub, offerHash, offer.sig)` ✓
4. Verify: `hello.ts` is not more than 5 seconds in the future ✓
5. Generate own ephemeral keypair
6. Compute `helloHash = SHA-256(canonical(helloObj))`
7. Construct `response.payload = { ts, nonce, helloHash, offerHash }`
8. Sign and hash payload; assemble RESPONSE object
9. Display as QR code

### Step 3 — COMBINED RECEIPT (Party A)
1. Scan Party B's response QR
2. Verify B's response: structure, hash, signature, helloHash, offerHash
3. Construct own RESPONSE (same structure, own keypair)
4. Assemble: `{ hello, a: ownResponse, b: scannedResponse }`
5. Apply compact encoding (strip redundant fields)
6. Compress and encode as `receipt.html#COMB_Z=<value>`
7. Navigate to receipt — both parties can now share or verify this URL

---

## 5. Verification Checks

The receipt page runs up to 13 checks. Score = `round(passed / total × 100)` shown as **% Confirmed**.

### Core Checks (always run)

| # | Check | Passes when | Fails when |
|---|-------|-------------|------------|
| 1 | Self structure | `a` has `type`, `payload`, `sig`, `pub` | Any field missing |
| 2 | Self hash | `SHA-256(canonical(a.payload)) == a.hash` | Mismatch (recomputed if stripped) |
| 3 | Self signature | `ECDSA.verify(a.pub ∥ hello.pub, a.hash, a.sig)` | Invalid signature |
| 4 | Guest structure | `b` has required fields | Any field missing |
| 5 | Guest hash | `SHA-256(canonical(b.payload)) == b.hash` | Mismatch (recomputed if stripped) |
| 6 | Guest signature | `ECDSA.verify(b.pub, b.hash, b.sig)` | Invalid signature |
| 7 | HELLO offer | Recompute `offerHash = SHA-256(canonical(offer.payload))`; `ECDSA.verify(hello.pub, offerHash, offer.sig)` | Invalid |
| 8 | Self binds HELLO | `a.payload.helloHash == SHA-256(JSON.stringify(hello*))` | Mismatch |
| 9 | Guest binds HELLO | `b.payload.helloHash == same helloHash` | Mismatch |

*hello\* = HELLO with `offer.hash` reconstructed from `offer.payload` if it was stripped*

### Bonus Checks (conditional)

| Check | Passes when | Notes |
|-------|-------------|-------|
| Self binds offer | `a.payload.offerHash == recomputed offer hash` | If offer present |
| Guest binds offer | `b.payload.offerHash == recomputed offer hash` | If offer present |
| Time ≤ tolerance | `|a.payload.ts − b.payload.ts| ≤ 90,000 ms` | Fails with "Missing timestamps" if absent |
| Distance ≤ tolerance | Haversine distance ≤ 12 m | Fails with "Missing locations" if GPS absent |

---

## 6. Compact Encoding

Receipts are stripped of recomputable fields before QR encoding to reduce size (~1.75× compression):

**Fields stripped:**
- `hello.offer.hash` — recomputable from `hello.offer.payload`
- `a.hash` — recomputable from `a.payload`
- `a.pub` — recoverable from `hello.pub` (Party A reuses HELLO keypair)
- `b.hash` — recomputable from `b.payload`

**Primary format (compressed):**
```
receipt.html#COMB_Z=<base64url(deflate-raw(JSON.stringify(stripped)))>
```

**Fallback format (uncompressed):**
```
receipt.html#COMB=<base64url(JSON.stringify(stripped))>
```

**HELLO QR format:**
```
accept.html#HZ=<base64url(deflate-raw(JSON.stringify(hello)))>
```

Typical URL lengths: HELLO ~505 chars, Receipt ~764 chars (COMB_Z) vs ~1,285 chars (COMB).

---

## 7. Security Notes

- **Ephemeral keys:** New ECDSA P-256 keypair generated each session. No long-term identity is asserted.
- **No server:** Fully peer-to-peer. No central authority can forge or revoke receipts.
- **Replay resistance:** Nonces and short QR expiry (seconds) prevent replaying captured QR codes.
- **GPS is optional and self-reported:** Location data is not independently verified. The distance check is a good-faith claim, not a proof of physical proximity.
- **Stripped fields are recomputable:** Compact encoding does not weaken verification — all stripped values can be recalculated from remaining fields.
- **Hash binding:** Each response commits to both the HELLO hash and the offer hash, preventing cross-session substitution attacks.
