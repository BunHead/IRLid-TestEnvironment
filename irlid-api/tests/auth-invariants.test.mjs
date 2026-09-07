// Security invariants — 7 Sep 2026.
//
// THE RULE THESE TESTS EXIST TO ENFORCE, PERMANENTLY:
//   A PUBLIC value must never authenticate anyone.
//
// pubKeyId() is derived only from public JWK fields, and the full public JWK is
// readable by anyone from a public receipt (GET /receipts/<hash>). If any endpoint
// hands out a session in exchange for a public key, the chain becomes:
//   public receipt -> public JWK -> pub_key_id -> session -> ACCOUNT TAKEOVER.
// These tests must never be deleted or weakened.

import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const KNOWN_KEY_ID_USER = "user-existing-1";
const KNOWN_KEY_ID_DEVICE = "device-existing-1";

class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, " ").trim(); this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() { return this.db.execute(this.sql, this.args); }
  async all() { return { results: (await this.db.execute(this.sql, this.args)) || [] }; }
  async run() { return this.db.execute(this.sql, this.args) || { meta: { changes: 1 } }; }
}

class FakeDB {
  // knownKeyIds: pub_key_ids already present in `devices`
  constructor(knownKeyIds = []) { this.known = new Set(knownKeyIds); this.inserted = []; }
  prepare(sql) { return new FakeStatement(this, sql); }
  async batch(stmts) { for (const s of stmts) await s.run(); return []; }
  async execute(sql, args) {
    if (sql.startsWith("SELECT d.id as device_id, d.user_id FROM devices d WHERE d.pub_key_id = ?")) {
      return this.known.has(args[0])
        ? { device_id: KNOWN_KEY_ID_DEVICE, user_id: KNOWN_KEY_ID_USER }
        : null;
    }
    if (sql.startsWith("INSERT INTO")) { this.inserted.push(sql); return { meta: { changes: 1 } }; }
    return null;
  }
}

const ENV = { DB: null, CORS_ORIGIN: "https://bunhead.github.io" };

async function freshPublicJwk() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

// Mirrors the Worker's own pubKeyId() so tests can pre-seed a "known" key.
async function pubKeyIdOf(pubJwk) {
  const s = `${pubJwk.kty}.${pubJwk.crv}.${pubJwk.x}.${pubJwk.y}`;
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const b = Buffer.from(new Uint8Array(h)).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return b.slice(0, 18);
}

function post(path, body) {
  return new Request("https://irlid-api-test.example/" + path.replace(/^\//, ""), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
}
function get(path) {
  return new Request("https://irlid-api-test.example/" + path.replace(/^\//, ""), { method: "GET" });
}

test("INVARIANT: a public key belonging to an EXISTING device must NOT yield a session", async () => {
  const pub = await freshPublicJwk();
  const env = { ...ENV, DB: new FakeDB([await pubKeyIdOf(pub)]) };
  const res = await worker.fetch(post("/auth/register", { pub_jwk: pub }), env);
  const data = await res.json();

  assert.equal(res.status, 409, "an already-registered key must be rejected, not logged in");
  assert.equal(data.session_token, undefined, "NO session token may ever be issued here");
  assert.equal(data.code, "already_registered");
});

test("a public key lifted from a public receipt cannot be exchanged for a session", async () => {
  // Simulates an attacker reading combined.a.pub from GET /receipts/<hash>
  const stolen = await freshPublicJwk();
  const env = { ...ENV, DB: new FakeDB([await pubKeyIdOf(stolen)]) };
  const res = await worker.fetch(post("/auth/register", { pub_jwk: stolen }), env);
  const data = await res.json();
  assert.equal(res.status, 409);
  assert.ok(!data.session_token, "receipt-derived key must never produce a session");
});

test("registering a genuinely NEW key still works (no regression)", async () => {
  const pub = await freshPublicJwk();
  const env = { ...ENV, DB: new FakeDB([]) };
  const res = await worker.fetch(post("/auth/register", { display_name: "New User", pub_jwk: pub }), env);
  const data = await res.json();
  assert.equal(res.status, 201, "new-device registration must still succeed");
  assert.ok(data.session_token, "a brand-new registration may issue a session");
  assert.equal(data.existing, false);
});

test("/auth/login no longer exists", async () => {
  const env = { ...ENV, DB: new FakeDB([]) };
  const res = await worker.fetch(post("/auth/login", { pub_key_id: "anything" }), env);
  assert.equal(res.status, 404, "the bare-pub_key_id login endpoint must stay deleted");
});

test("/users/by-key/:id no longer exists (identity oracle closed)", async () => {
  const env = { ...ENV, DB: new FakeDB([]) };
  const res = await worker.fetch(get("/users/by-key/AAAAAAAAAAAAAAAAAA"), env);
  assert.equal(res.status, 404, "unauthenticated identity lookup must stay deleted");
});

test("register still validates its input", async () => {
  const env = { ...ENV, DB: new FakeDB([]) };
  const res = await worker.fetch(post("/auth/register", {}), env);
  assert.equal(res.status, 400);
});
