// Copyright 2025 Spencer Austin. All rights reserved.
// Licensed under Apache 2.0 with Commons Clause. See LICENSE.
// irlid-api/src/index.js -- v7
// IRLid Backend -- Cloudflare Worker + D1
// Auth (device key + Google), profile, receipts, device linking, user lookup
// Deploy 116: Gmail allowlist gating on googleAuth(), GPS strip on getReceipt()

// =====================
//  HELPERS
// =====================

function uuid() { return crypto.randomUUID(); }
function now() { return Math.floor(Date.now() / 1000); }

function b64urlEncode(bytes) {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function b64urlJsonDecode(str) {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(String(str || ""))));
}

async function inflateRawB64urlJson(str) {
  if (typeof DecompressionStream !== "function") throw new Error("Compressed HELLO unsupported");
  const stream = new Blob([b64urlDecode(String(str || ""))]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return JSON.parse(await new Response(stream).text());
}

function canonical(obj) {
  const keys = Object.keys(obj).sort();
  const o = {};
  for (const k of keys) o[k] = obj[k];
  return JSON.stringify(o);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function noStore(response) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function err(message, status = 400) { return json({ error: message }, status); }
function authErr(message, status = 401) {
  const response = err(message, status);
  response.error = true;
  return response;
}

function randomToken() { return b64urlEncode(crypto.getRandomValues(new Uint8Array(32))); }

const EXPECTED_MEMBER_ROLES = new Set(["attendee", "staff", "manager", "lead_admin", "developer"]);
const EXPECTED_ROLE_RANK = { attendee: 0, staff: 1, manager: 2, lead_admin: 3, developer: 4 };
const THEME_SCRAPE_TTL_MS = 24 * 60 * 60 * 1000;
const THEME_SCRAPE_TIMEOUT_MS = 5000;
const IMAGE_PROXY_MAX_BYTES = 2 * 1024 * 1024;
const PUBLIC_HTTP_URL_RE = /^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d{2,5})?(?:[/?#]|$)/i;

function expectedMemberRole(value) {
  const role = String(value || "attendee").trim().toLowerCase();
  return EXPECTED_MEMBER_ROLES.has(role) ? role : "attendee";
}

function expectedRoleRank(role) {
  return EXPECTED_ROLE_RANK[expectedMemberRole(role)] ?? 0;
}

function isInternalHostname(hostname) {
  const host = String(hostname || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  if (/^(fc|fd|fe80):/i.test(host)) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const parts = ipv4.slice(1).map(Number);
  if (parts.some(n => n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
}

function parsePublicHttpUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048 || !PUBLIC_HTTP_URL_RE.test(trimmed)) return null;
  let url;
  try { url = new URL(trimmed); } catch (_) { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (isInternalHostname(url.hostname)) return null;
  return url;
}

// Batch C polish 5 — Developer role is bootstrap-only. The /org/expected create
// + update endpoints accept prototype_role from any authenticated org member.
// That's fine for attendee/staff/manager/lead_admin (gated by frontend RBAC
// dropdown options), but Developer must NEVER be grantable through that path —
// the role exists to bootstrap the network and a Developer-can-add-Developer
// loop collapses that into recursive trust. New Developers come only via
// BOOTSTRAP_DEVELOPER_FP env var (today) or signed invite tokens (v5.6+).
// Defence in depth alongside the frontend dropdown filter.
function isExpectedRoleAllowedFromDashboard(role) {
  return role !== "developer";
}

function randomCode6() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const num = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(num % 1000000).padStart(6, "0");
}

// =====================
//  CRYPTO
// =====================

async function hashPayloadToB64url(payloadObj, protocolV) {
  // v3+: canonical() — order-independent. v2 and below: JSON.stringify (backward compat).
  const v = (protocolV != null) ? Number(protocolV) : ((payloadObj && payloadObj.v) ? Number(payloadObj.v) : 3);
  const str = (v >= 3) ? canonical(payloadObj) : JSON.stringify(payloadObj);
  const bytes = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
  return b64urlEncode(new Uint8Array(hashBuf));
}

async function sha256B64url(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return b64urlEncode(new Uint8Array(buf));
}

async function verifySig(midB64url, sigB64url, pubJwk) {
  try {
    const pub = await crypto.subtle.importKey("jwk", pubJwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64urlDecode(sigB64url), b64urlDecode(midB64url));
  } catch { return false; }
}

async function pubKeyId(pubJwk) {
  const s = `${pubJwk.kty}.${pubJwk.crv}.${pubJwk.x}.${pubJwk.y}`;
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return b64urlEncode(new Uint8Array(h)).slice(0, 18);
}

async function deviceKeyFp(pubJwk) {
  if (!pubJwk) return null;
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(pubJwk)));
  return b64urlEncode(new Uint8Array(h)).slice(0, 16);
}

// =====================
//  v5 ENVELOPE VERIFIER (PROTOCOL.md §13.7) — Batch A port from live Worker
// =====================
// Used by /org/login/claim (PROTOCOL.md §14) to verify hardware-backed signing
// envelopes for org-portal sign-in. Mirrors the verifier in the live Worker
// (irlid-api/src/index.js) byte-for-byte; differences would be implementation bugs.

const IRLID_V5_ORIGIN_ALLOWLIST = [
  "https://irlid.co.uk",
  "https://bunhead.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

function irlidV5OriginAllowed(origin) {
  return IRLID_V5_ORIGIN_ALLOWLIST.includes(String(origin));
}

// Verify a v5 envelope. Returns true on success; throws Error on first failure.
async function verifyV5Envelope(payload, pubJwk, sigRawB64u, webauthnEnv, expectedRpOrigin) {
  if (!webauthnEnv || !webauthnEnv.authData || !webauthnEnv.clientData) {
    throw new Error("v5: envelope missing");
  }
  if (!pubJwk || pubJwk.kty !== "EC" || pubJwk.crv !== "P-256") {
    throw new Error("v5: pub is not a P-256 JWK");
  }
  if (!sigRawB64u) throw new Error("v5: sig missing");
  const payloadHashB64u = await hashPayloadToB64url(payload);
  const clientDataBytes = b64urlDecode(webauthnEnv.clientData);
  let clientData;
  try {
    clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));
  } catch (e) {
    throw new Error("v5: clientDataJSON not valid JSON");
  }
  if (clientData.type !== "webauthn.get") {
    throw new Error("v5: clientData.type is '" + clientData.type + "', expected 'webauthn.get'");
  }
  if (expectedRpOrigin !== undefined && expectedRpOrigin !== null) {
    if (clientData.origin !== expectedRpOrigin) {
      throw new Error("v5: origin '" + clientData.origin + "' did not match expected '" + expectedRpOrigin + "'");
    }
  } else if (!irlidV5OriginAllowed(clientData.origin)) {
    throw new Error("v5: origin '" + clientData.origin + "' not in allowlist");
  }
  if (clientData.challenge !== payloadHashB64u) {
    throw new Error("v5: clientData.challenge does not match recomputed payload hash");
  }
  const authDataBytes = b64urlDecode(webauthnEnv.authData);
  if (authDataBytes.length < 37) throw new Error("v5: authData too short");
  const flags = authDataBytes[32];
  if ((flags & 0x04) !== 0x04) {
    throw new Error("v5: UV flag not asserted in authData");
  }
  const clientDataHashBuf = await crypto.subtle.digest("SHA-256", clientDataBytes);
  const clientDataHash = new Uint8Array(clientDataHashBuf);
  const signedBytes = new Uint8Array(authDataBytes.length + clientDataHash.length);
  signedBytes.set(authDataBytes, 0);
  signedBytes.set(clientDataHash, authDataBytes.length);
  let pubKey;
  try {
    pubKey = await crypto.subtle.importKey(
      "jwk", pubJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false, ["verify"]
    );
  } catch (e) {
    throw new Error("v5: failed to import pub: " + (e.message || e));
  }
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    pubKey,
    b64urlDecode(sigRawB64u),
    signedBytes
  );
  if (!ok) throw new Error("v5: ECDSA signature verification failed");
  return true;
}

async function helloHashB64url(helloObj, protocolV) {
  const v = (protocolV != null) ? Number(protocolV) : ((helloObj && helloObj.v) ? Number(helloObj.v) : 3);
  const str = (v >= 3) ? canonical(helloObj) : JSON.stringify(helloObj);
  const bytes = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
  return b64urlEncode(new Uint8Array(hashBuf));
}

async function parseHelloInput(input) {
  if (input && typeof input === "object") return input;
  if (typeof input !== "string") throw new Error("HELLO payload required");
  const raw = input.trim();
  if (raw.startsWith("H:")) return b64urlJsonDecode(raw.slice(2));
  if (raw.startsWith("HZ:")) return inflateRawB64urlJson(raw.slice(3));
  if (raw.startsWith("{")) return JSON.parse(raw);
  return b64urlJsonDecode(raw);
}

async function verifySignedHello(helloObj, tsTolS = 90) {
  if (!helloObj || helloObj.type !== "hello") return { ok: false, status: 400, error: "Invalid HELLO" };
  if (!helloObj.pub || !helloObj.pub.kty || !helloObj.pub.crv || !helloObj.pub.x || !helloObj.pub.y) {
    return { ok: false, status: 400, error: "Invalid HELLO (missing pub)" };
  }
  const offer = helloObj.offer;
  if (!offer || !offer.payload || !offer.sig) {
    return { ok: false, status: 400, error: "Invalid HELLO (bad offer structure)" };
  }
  const computed = await hashPayloadToB64url(offer.payload);
  if (offer.hash && computed !== offer.hash) return { ok: false, status: 401, error: "HELLO offer hash mismatch" };
  const sigOk = await verifySig(computed, offer.sig, helloObj.pub);
  if (!sigOk) return { ok: false, status: 401, error: "HELLO offer signature invalid" };
  const t = now();
  const ts = Number(offer.payload.ts);
  if (!Number.isFinite(ts)) return { ok: false, status: 400, error: "HELLO offer timestamp missing" };
  if (ts > t + 5) return { ok: false, status: 401, error: "HELLO offer timestamp in future" };
  if (Math.abs(t - ts) > tsTolS) return { ok: false, status: 401, error: "HELLO offer timestamp expired" };
  return { ok: true, verification_state: "signature_verified", offer_hash: computed };
}

// =====================
//  GOOGLE TOKEN VERIFY
// =====================

const GOOGLE_CLIENT_ID = "1027068182677-b69k36slkhjr0ltjbde7q6ktopjscmeq.apps.googleusercontent.com";

async function verifyGoogleToken(idToken) {
  // Use Google's tokeninfo endpoint to verify
  const resp = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken));
  if (!resp.ok) return null;

  const payload = await resp.json();

  // Verify audience matches our client ID
  if (payload.aud !== GOOGLE_CLIENT_ID) return null;

  // Verify issuer
  if (payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") return null;

  // Verify not expired
  if (payload.exp && Number(payload.exp) < now()) return null;

  return {
    sub: payload.sub,           // Unique Google user ID
    email: payload.email,
    email_verified: payload.email_verified === "true",
    name: payload.name || null,
    given_name: payload.given_name || null,
    family_name: payload.family_name || null,
    picture: payload.picture || null
  };
}

// =====================
//  RECEIPT VERIFICATION
// =====================

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function verifyReceipt(comb) {
  const TS_TOL = 90; const DIST_TOL = 12; const checks = {};

  const a = comb.a;
  if (a && a.payload && a.hash && a.sig && a.pub) {
    checks.a_structure = true;
    // Pass a.v so v2 uses JSON.stringify, v3+ uses canonical().
    checks.a_hash = (await hashPayloadToB64url(a.payload, a.v)) === a.hash;
    checks.a_sig = await verifySig(a.hash, a.sig, a.pub);
  } else { checks.a_structure = false; checks.a_hash = false; checks.a_sig = false; }

  const b = comb.b;
  if (b && b.payload && b.hash && b.sig && b.pub) {
    checks.b_structure = true;
    checks.b_hash = (await hashPayloadToB64url(b.payload, b.v)) === b.hash;
    checks.b_sig = await verifySig(b.hash, b.sig, b.pub);
  } else { checks.b_structure = false; checks.b_hash = false; checks.b_sig = false; }

  const hello = comb.hello;
  if (hello && hello.offer && hello.offer.payload && hello.offer.sig && hello.pub) {
    // Offer hash uses the offer payload's own version (offer.payload.v).
    const computedOfferHash = await hashPayloadToB64url(hello.offer.payload);
    if (hello.offer.hash) checks.hello_hash = computedOfferHash === hello.offer.hash; // back-compat v2
    checks.hello_sig = await verifySig(computedOfferHash, hello.offer.sig, hello.pub);
  }

  if (hello) {
    // v3+: canonical(). v2 and below: JSON.stringify (backward compat).
    const hv = (hello && hello.v) ? Number(hello.v) : 3;
    const helloStr = (hv >= 3) ? canonical(hello) : JSON.stringify(hello);
    const helloHash = b64urlEncode(new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(helloStr))
    ));
    if (a && a.payload) checks.a_binds_hello = a.payload.helloHash === helloHash;
    if (b && b.payload) checks.b_binds_hello = b.payload.helloHash === helloHash;
  }

  const tsA = a?.payload?.ts; const tsB = b?.payload?.ts;
  if (typeof tsA === "number" && typeof tsB === "number") {
    checks.time_delta_s = Math.abs(tsA - tsB);
    checks.time_delta_ok = checks.time_delta_s <= TS_TOL;
  } else { checks.time_delta_ok = false; }

  const latA = a?.payload?.lat; const lonA = a?.payload?.lon;
  const latB = b?.payload?.lat; const lonB = b?.payload?.lon;
  if (latA != null && lonA != null && latB != null && lonB != null) {
    checks.distance_m = Math.round(haversineMeters(latA, lonA, latB, lonB) * 100) / 100;
    checks.distance_ok = checks.distance_m <= DIST_TOL;
  } else { checks.distance_ok = false; }

  checks.valid = !!(checks.a_structure && checks.a_hash && checks.a_sig && checks.b_structure && checks.b_hash && checks.b_sig && checks.time_delta_ok && checks.distance_ok);
  return checks;
}

// =====================
//  AUTH MIDDLEWARE
// =====================

async function getSession(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const row = await env.DB.prepare("SELECT user_id, device_id, expires_at FROM sessions WHERE id = ?").bind(token).first();
  if (!row) return null;
  if (row.expires_at < now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(token).run();
    return null;
  }
  return { userId: row.user_id, deviceId: row.device_id, token };
}

function requireAuth(session) {
  if (!session) return err("Unauthorized", 401);
  return null;
}

// =====================
//  CORS
// =====================

function corsHeaders(env, request) {
  const origin = request.headers.get("Origin") || "";
  // Allowed origins: env.CORS_ORIGIN (the primary frontend host — bunhead.github.io for
  // test, irlid.co.uk for live), plus the live IRLid origin always (because PROTOCOL.md
  // §14 login flow has the phone-side org-login.html hosted at irlid.co.uk POSTing to
  // either prod or test Worker — by design cross-origin), plus localhost dev variants.
  const allowed = [
    env.CORS_ORIGIN || "https://irlid.co.uk",
    "https://irlid.co.uk",
    "https://bunhead.github.io",
    "http://localhost:3000", "http://localhost:8000",
    "http://127.0.0.1:3000", "http://127.0.0.1:8000"
  ];
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Org-Key",
    "Access-Control-Max-Age": "86400"
  };
}

function addCors(response, env, request) {
  const h = corsHeaders(env, request);
  for (const [k, v] of Object.entries(h)) response.headers.set(k, v);
  return response;
}

// =====================
//  AUTH HANDLERS
// =====================

async function register(request, env) {
  let body;
  try { body = await request.json(); } catch { return err("Invalid JSON body"); }
  const { display_name, pub_jwk } = body;
  if (!pub_jwk || !pub_jwk.kty || !pub_jwk.crv || !pub_jwk.x || !pub_jwk.y) return err("pub_jwk is required");

  const pkId = await pubKeyId(pub_jwk);
  const existing = await env.DB.prepare("SELECT d.id as device_id, d.user_id FROM devices d WHERE d.pub_key_id = ?").bind(pkId).first();

  if (existing) {
    const token = randomToken(); const ts = now();
    await env.DB.prepare("INSERT INTO sessions (id, user_id, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").bind(token, existing.user_id, existing.device_id, ts, ts + 30 * 86400).run();
    return json({ user_id: existing.user_id, device_id: existing.device_id, pub_key_id: pkId, session_token: token, existing: true });
  }

  const userId = uuid(); const deviceId = uuid(); const ts = now(); const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(userId, display_name || null, ts, ts),
    env.DB.prepare("INSERT INTO devices (id, user_id, pub_key_id, pub_jwk, created_at) VALUES (?, ?, ?, ?, ?)").bind(deviceId, userId, pkId, JSON.stringify(pub_jwk), ts),
    env.DB.prepare("INSERT INTO sessions (id, user_id, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").bind(token, userId, deviceId, ts, ts + 30 * 86400)
  ]);
  return json({ user_id: userId, device_id: deviceId, pub_key_id: pkId, session_token: token, existing: false }, 201);
}

// =====================
//  GOOGLE AUTH
// =====================

async function googleAuth(request, env) {
  let body;
  try { body = await request.json(); } catch { return err("Invalid JSON body"); }
  const { id_token, pub_jwk } = body;
  if (!id_token) return err("id_token required");

  // Verify the Google token
  const gUser = await verifyGoogleToken(id_token);
  if (!gUser) return err("Invalid or expired Google token.", 401);

  // =====================
  //  GMAIL ALLOWLIST (Deploy 116)
  // =====================
  // Normalise the incoming email — strip all whitespace and control chars
  const incomingEmail = gUser.email.toLowerCase().replace(/[\s​ ﻿]/g, "");
  const rawSecret = (env.ALLOWED_EMAILS || "");
  if (rawSecret.trim()) {
    const allowed = rawSecret
      .split(",")
      .map(e => e.toLowerCase().replace(/[\s​ ﻿]/g, ""))
      .filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(incomingEmail)) {
      return err("not_on_allowlist", 403);
    }
  }

  const ts = now();

  // Check if we already have a user with this google_sub
  let user = await env.DB.prepare("SELECT id, display_name FROM users WHERE google_sub = ?").bind(gUser.sub).first();
  let existing = !!user;

  if (!user) {
    // Check if there's a user with matching email (link Google to existing email-based account)
    if (gUser.email) {
      user = await env.DB.prepare("SELECT id, display_name FROM users WHERE email = ?").bind(gUser.email).first();
    }
  }

  let userId;
  let displayName;

  if (user) {
    // Existing user â€” update their Google info
    userId = user.id;
    displayName = user.display_name;
    await env.DB.prepare(
      "UPDATE users SET google_sub = ?, google_email = ?, google_name = ?, google_picture = ?, updated_at = ? WHERE id = ?"
    ).bind(gUser.sub, gUser.email, gUser.name, gUser.picture, ts, userId).run();

    // Fill in profile fields if they're empty
    if (!displayName && gUser.name) {
      displayName = gUser.name;
      await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ? AND display_name IS NULL").bind(displayName, userId).run();
    }
    await env.DB.prepare("UPDATE users SET first_name = COALESCE(first_name, ?), surname = COALESCE(surname, ?), email = COALESCE(email, ?) WHERE id = ?")
      .bind(gUser.given_name, gUser.family_name, gUser.email, userId).run();

  } else {
    // New user
    userId = uuid();
    displayName = gUser.name || gUser.email;
    await env.DB.prepare(
      "INSERT INTO users (id, display_name, first_name, surname, email, google_sub, google_email, google_name, google_picture, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(userId, displayName, gUser.given_name, gUser.family_name, gUser.email, gUser.sub, gUser.email, gUser.name, gUser.picture, ts, ts).run();
  }

  // If a device pub_jwk was provided, link it to this account
  let deviceId = null;
  if (pub_jwk && pub_jwk.kty && pub_jwk.x && pub_jwk.y) {
    const pkId = await pubKeyId(pub_jwk);
    const existingDevice = await env.DB.prepare("SELECT id, user_id FROM devices WHERE pub_key_id = ?").bind(pkId).first();

    if (existingDevice) {
      if (existingDevice.user_id === userId) {
        deviceId = existingDevice.id;
      } else {
        // Device was registered to a different user â€” reassign to current user.
        // This happens when a new person logs in on a device previously used by someone else.
        deviceId = existingDevice.id;
        await env.DB.prepare("UPDATE devices SET user_id = ? WHERE id = ?")
          .bind(userId, deviceId).run();
      }
    } else {
      deviceId = uuid();
      await env.DB.prepare("INSERT INTO devices (id, user_id, pub_key_id, pub_jwk, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(deviceId, userId, pkId, JSON.stringify(pub_jwk), ts).run();
    }
  }

  // Create session
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(token, userId, deviceId, ts, ts + 30 * 86400).run();

  return json({
    user_id: userId,
    display_name: displayName,
    session_token: token,
    device_id: deviceId,
    existing: existing,
    google_email: gUser.email
  });
}

// =====================
//  OTHER AUTH
// =====================

async function login(request, env) {
  let body;
  try { body = await request.json(); } catch { return err("Invalid JSON body"); }
  const { pub_key_id } = body;
  if (!pub_key_id) return err("pub_key_id required");
  const device = await env.DB.prepare("SELECT id, user_id, revoked_at FROM devices WHERE pub_key_id = ?").bind(pub_key_id).first();
  if (!device) return err("Device not found.", 404);
  if (device.revoked_at) return err("Device key revoked.", 403);
  const token = randomToken(); const ts = now();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").bind(token, device.user_id, device.id, ts, ts + 30 * 86400).run();
  return json({ session_token: token, user_id: device.user_id, device_id: device.id });
}

async function logout(request, env) {
  const session = await getSession(request, env);
  const denied = requireAuth(session);
  if (denied) return denied;
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(session.token).run();
  return json({ ok: true });
}

async function me(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ logged_in: false });

  const user = await env.DB.prepare(
    "SELECT id, display_name, first_name, middle_names, surname, email, google_sub, google_email, google_picture, created_at FROM users WHERE id = ?"
  ).bind(session.userId).first();
  if (!user) return json({ logged_in: false });

  const devices = await env.DB.prepare("SELECT id, pub_key_id, label, created_at, revoked_at FROM devices WHERE user_id = ?").bind(session.userId).all();
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM (
       SELECT DISTINCT r.id FROM receipts r
       WHERE r.uploader_id = ?
          OR r.pub_key_a IN (SELECT pub_key_id FROM devices WHERE user_id = ?)
          OR r.pub_key_b IN (SELECT pub_key_id FROM devices WHERE user_id = ?)
     )`
  ).bind(session.userId, session.userId, session.userId).first();

  return json({
    logged_in: true,
    user: {
      id: user.id,
      display_name: user.display_name,
      first_name: user.first_name,
      middle_names: user.middle_names,
      surname: user.surname,
      email: user.email,
      google_linked: !!user.google_sub,
      google_email: user.google_email,
      google_picture: user.google_picture,
      created_at: user.created_at
    },
    devices: (devices.results || []).map(d => ({
      id: d.id, pub_key_id: d.pub_key_id, label: d.label,
      created_at: d.created_at, revoked: !!d.revoked_at
    })),
    current_device_id: session.deviceId,
    receipt_count: countRow ? countRow.cnt : 0
  });
}

// =====================
//  PROFILE
// =====================

async function updateProfile(request, env) {
  const session = await getSession(request, env);
  const denied = requireAuth(session);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return err("Invalid JSON body"); }

  const allowed = ["display_name", "first_name", "middle_names", "surname", "email"];
  const sets = [];
  const vals = [];

  for (const field of allowed) {
    if (field in body) {
      sets.push(field + " = ?");
      vals.push(body[field] || null);
    }
  }

  if (sets.length === 0) return err("No fields to update.");

  sets.push("updated_at = ?");
  vals.push(now());
  vals.push(session.userId);

  await env.DB.prepare("UPDATE users SET " + sets.join(", ") + " WHERE id = ?").bind(...vals).run();
  return json({ ok: true });
}

// =====================
//  DEVICE LINKING
// =====================

async function linkCreate(request, env) {
  const session = await getSession(request, env);
  const denied = requireAuth(session);
  if (denied) return denied;

  await env.DB.prepare("DELETE FROM link_codes WHERE user_id = ? AND claimed = 0").bind(session.userId).run();

  const code = randomCode6();
  const ts = now();
  const expiresAt = ts + 300;
  await env.DB.prepare("INSERT INTO link_codes (code, user_id, created_at, expires_at, claimed) VALUES (?, ?, ?, ?, 0)").bind(code, session.userId, ts, expiresAt).run();
  return json({ code: code, expires_at: expiresAt });
}

async function linkClaim(request, env) {
  let body;
  try { body = await request.json(); } catch { return err("Invalid JSON body"); }
  const { code, pub_jwk } = body;
  if (!code || !pub_jwk) return err("code and pub_jwk required");

  const row = await env.DB.prepare("SELECT code, user_id, expires_at, claimed FROM link_codes WHERE code = ?").bind(code).first();
  if (!row) return err("Invalid code.", 404);
  if (row.claimed) return err("Code already used.", 410);
  if (row.expires_at < now()) return err("Code expired.", 410);

  const userId = row.user_id;
  const pkId = await pubKeyId(pub_jwk);

  const existingDevice = await env.DB.prepare("SELECT id, user_id FROM devices WHERE pub_key_id = ?").bind(pkId).first();

  if (existingDevice) {
    if (existingDevice.user_id === userId) {
      const token = randomToken(); const ts = now();
      await env.DB.batch([
        env.DB.prepare("UPDATE link_codes SET claimed = 1 WHERE code = ?").bind(code),
        env.DB.prepare("INSERT INTO sessions (id, user_id, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").bind(token, userId, existingDevice.id, ts, ts + 30 * 86400)
      ]);
      const user = await env.DB.prepare("SELECT display_name FROM users WHERE id = ?").bind(userId).first();
      return json({ session_token: token, user_id: userId, device_id: existingDevice.id, display_name: user ? user.display_name : null, already_linked: true });
    }
    return err("Device key already registered under another account.", 409);
  }

  const deviceId = uuid(); const ts = now(); const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("UPDATE link_codes SET claimed = 1 WHERE code = ?").bind(code),
    env.DB.prepare("INSERT INTO devices (id, user_id, pub_key_id, pub_jwk, created_at) VALUES (?, ?, ?, ?, ?)").bind(deviceId, userId, pkId, JSON.stringify(pub_jwk), ts),
    env.DB.prepare("INSERT INTO sessions (id, user_id, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").bind(token, userId, deviceId, ts, ts + 30 * 86400)
  ]);

  const user = await env.DB.prepare("SELECT display_name FROM users WHERE id = ?").bind(userId).first();
  return json({ session_token: token, user_id: userId, device_id: deviceId, display_name: user ? user.display_name : null, linked: true }, 201);
}

// =====================
//  DEVICE MANAGEMENT
// =====================

async function renameDevice(request, env) {
  const session = await getSession(request, env);
  const denied = requireAuth(session);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return err("Invalid JSON body"); }
  const { device_id, label } = body;
  if (!device_id) return err("device_id required");
  if (!label || !label.trim()) return err("label required");

  const device = await env.DB.prepare("SELECT id FROM devices WHERE id = ? AND user_id = ?").bind(device_id, session.userId).first();
  if (!device) return err("Device not found or not yours.", 404);

  await env.DB.prepare("UPDATE devices SET label = ? WHERE id = ?").bind(label.trim(), device_id).run();
  return json({ ok: true });
}

async function revokeDevice(request, env) {
  const session = await getSession(request, env);
  const denied = requireAuth(session);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return err("Invalid JSON body"); }
  const { device_id } = body;
  if (!device_id) return err("device_id required");

  const device = await env.DB.prepare("SELECT id, user_id, revoked_at FROM devices WHERE id = ? AND user_id = ?").bind(device_id, session.userId).first();
  if (!device) return err("Device not found or not yours.", 404);
  if (device.revoked_at) return err("Already revoked.", 409);
  if (device_id === session.deviceId) return err("Cannot revoke your current device.", 400);

  const ts = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE devices SET revoked_at = ? WHERE id = ?").bind(ts, device_id),
    env.DB.prepare("DELETE FROM sessions WHERE device_id = ?").bind(device_id)
  ]);
  return json({ ok: true, revoked_at: ts });
}

// =====================
//  RECEIPT HANDLERS
// =====================

async function uploadReceipt(request, env) {
  // Auth is optional — logged-in users get their profile attached,
  // anonymous users can still store receipts for free verification
  const session = await getSession(request, env);

  let body;
  try { body = await request.json(); } catch { return err("Invalid JSON body"); }
  const { combined } = body;
  if (!combined || combined.type !== "combined") return err("Body must include 'combined' with type:'combined'");

  const receiptHash = await sha256B64url(canonical(combined));
  const dup = await env.DB.prepare("SELECT id FROM receipts WHERE receipt_hash = ?").bind(receiptHash).first();
  if (dup) return json({ receipt_id: dup.id, receipt_hash: receiptHash, duplicate: true });

  const checks = await verifyReceipt(combined);
  const pkA = (combined.a && combined.a.pub) ? await pubKeyId(combined.a.pub) : "";
  const pkB = (combined.b && combined.b.pub) ? await pubKeyId(combined.b.pub) : "";
  const tsA = combined.a?.payload?.ts || null;
  const tsB = combined.b?.payload?.ts || null;
  const receiptId = uuid();
  const uploaderId = session ? session.userId : null;

  // Look up user info for both parties at upload time (snapshot)
  let partyA = null, partyB = null;
  if (pkA) {
    const devA = await env.DB.prepare("SELECT user_id FROM devices WHERE pub_key_id = ? AND revoked_at IS NULL").bind(pkA).first();
    if (devA) {
      const uA = await env.DB.prepare("SELECT display_name, google_picture FROM users WHERE id = ?").bind(devA.user_id).first();
      if (uA) partyA = { display_name: uA.display_name || null, google_picture: uA.google_picture || null };
    }
  }
  if (pkB) {
    const devB = await env.DB.prepare("SELECT user_id FROM devices WHERE pub_key_id = ? AND revoked_at IS NULL").bind(pkB).first();
    if (devB) {
      const uB = await env.DB.prepare("SELECT display_name, google_picture FROM users WHERE id = ?").bind(devB.user_id).first();
      if (uB) partyB = { display_name: uB.display_name || null, google_picture: uB.google_picture || null };
    }
  }

  // Store party info as JSON metadata alongside the receipt
  const partyInfo = JSON.stringify({ a: partyA, b: partyB });

  await env.DB.prepare(
    `INSERT INTO receipts (id, uploader_id, receipt_hash, pub_key_a, pub_key_b, ts_a, ts_b, receipt_json, verified, created_at, party_info) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(receiptId, uploaderId, receiptHash, pkA, pkB, tsA, tsB, JSON.stringify(combined), checks.valid ? 1 : 0, now(), partyInfo).run();
  return json({ receipt_id: receiptId, receipt_hash: receiptHash, verified: checks.valid, checks, party_info: { a: partyA, b: partyB } }, 201);
}

async function listReceipts(request, env) {
  const session = await getSession(request, env);
  const denied = requireAuth(session);
  if (denied) return denied;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20")));
  const offset = (page - 1) * limit;

  // Include receipts where user uploaded OR where user's device key is party a or b
  const rows = await env.DB.prepare(
    `SELECT DISTINCT r.id, r.receipt_hash, r.pub_key_a, r.pub_key_b, r.ts_a, r.ts_b, r.verified, r.created_at
     FROM receipts r
     WHERE r.uploader_id = ?
        OR r.pub_key_a IN (SELECT pub_key_id FROM devices WHERE user_id = ?)
        OR r.pub_key_b IN (SELECT pub_key_id FROM devices WHERE user_id = ?)
     ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
  ).bind(session.userId, session.userId, session.userId, limit, offset).all();

  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM (
       SELECT DISTINCT r.id FROM receipts r
       WHERE r.uploader_id = ?
          OR r.pub_key_a IN (SELECT pub_key_id FROM devices WHERE user_id = ?)
          OR r.pub_key_b IN (SELECT pub_key_id FROM devices WHERE user_id = ?)
     )`
  ).bind(session.userId, session.userId, session.userId).first();
  return json({ receipts: rows.results || [], total: countRow ? countRow.cnt : 0, page, limit });
}

async function getReceipt(request, env, receiptHash) {
  const row = await env.DB.prepare(
    "SELECT id, receipt_hash, pub_key_a, pub_key_b, ts_a, ts_b, receipt_json, verified, created_at, party_info FROM receipts WHERE receipt_hash = ?"
  ).bind(receiptHash).first();
  if (!row) return err("Receipt not found", 404);
  let combined = null;
  try { combined = JSON.parse(row.receipt_json); } catch {}
  let partyInfo = null;
  try { if (row.party_info) partyInfo = JSON.parse(row.party_info); } catch {}
  // GPS coords are required for client-side hash/signature re-verification.
  // Stripping them breaks client verification. Do not strip.
  return json({ receipt_id: row.id, receipt_hash: row.receipt_hash, pub_key_a: row.pub_key_a, pub_key_b: row.pub_key_b, ts_a: row.ts_a, ts_b: row.ts_b, verified: !!row.verified, created_at: row.created_at, combined, party_info: partyInfo });
}

async function verify(request, env) {
  let body;
  try { body = await request.json(); } catch { return err("Invalid JSON body"); }
  const { combined } = body;
  if (!combined) return err("combined object required");
  const checks = await verifyReceipt(combined);
  checks.receipt_hash = await sha256B64url(canonical(combined));
  return json(checks);
}

// =====================
//  USER LOOKUP BY KEY
// =====================

async function lookupByKey(request, env, pubKeyIdParam) {
  const device = await env.DB.prepare(
    "SELECT user_id FROM devices WHERE pub_key_id = ? AND revoked_at IS NULL"
  ).bind(pubKeyIdParam).first();
  if (!device) return json({ found: false });
  const user = await env.DB.prepare(
    "SELECT display_name, google_picture FROM users WHERE id = ?"
  ).bind(device.user_id).first();
  if (!user) return json({ found: false });
  return json({ found: true, display_name: user.display_name || null, google_picture: user.google_picture || null });
}

// =====================
//  IDENTITY-BOUND SESSIONS — PROTOCOL.md §14 — Batch A
// =====================
// Three endpoints implement the QR-scan login flow:
//   POST /org/login/init  — desktop asks for a fresh login challenge
//   GET  /org/login/poll  — desktop polls for session arrival (1.5s cadence)
//   POST /org/login/claim — phone sends a v5-signed envelope binding the nonce
// Plus rate limiting (3 failed claims / 60s / nonce → 5min cooldown) and the
// generic auth_failed error to prevent user-enumeration oracles (§14.10).

const LOGIN_CHALLENGE_TTL_S  = 180;           // §14.5 — 3-minute login QR (was 60s, bumped 4 May after IRL test showed
                                              // 60s is too tight for a real human flow: scan + URL tap + page load +
                                              // biometric prompt + sign + POST commonly runs to ~30-60s naturally,
                                              // leaving zero margin. 180s still bounds the replay window narrowly
                                              // enough that a leaked QR is low-value.)
const LOGIN_SESSION_TTL_S    = 86400;         // §14.7 — 24h sliding TTL
const LOGIN_CLAIM_FAIL_LIMIT = 3;             // §14.10 — 3 attempts per nonce
const LOGIN_CLAIM_COOLDOWN_S = 300;           // §14.10 — 5min cooldown

function randomNonce16() {
  // 16 random bytes, base64url. ~22 char output. Single-use, 60s TTL.
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
}

async function hashIp(request) {
  // SHA-256 of the source IP, hex truncated to 16 chars. Audit-only; never used
  // for authorisation. Cloudflare exposes the client IP on `cf-connecting-ip`.
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "";
  if (!ip) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 16);
}

// Generic auth-failed error per §14.10 oracle defence — does NOT distinguish
// between "invalid signature" and "valid signature but unknown user" in
// production. Test env can opt into verbose diagnostics by setting the
// LOGIN_DEBUG worker secret to "1" (`wrangler secret put LOGIN_DEBUG` then
// paste 1). When LOGIN_DEBUG is on, the optional `debug` object is included
// in the response so client-side diagnostics surface the specific failure.
// THREAT-MODEL.md §XI.5 documents this verbose-mode caveat explicitly.
function genericAuthFailed(env, debug) {
  if (debug && env && env.LOGIN_DEBUG === "1") {
    return json(Object.assign({ error: "auth_failed" }, debug), 401);
  }
  return json({ error: "auth_failed" }, 401);
}

async function orgLoginInit(request, env) {
  // §14.4 step [2]: generate nonce, write login_challenges row, return for QR display.
  const nonce = randomNonce16();
  const tNow = now();
  const expiresAt = tNow + LOGIN_CHALLENGE_TTL_S;
  await env.DB.prepare(
    "INSERT INTO login_challenges (nonce, issued_at, expires_at, claimed_by, session_token, consumed, fail_count, locked_until) VALUES (?, ?, ?, NULL, NULL, 0, 0, 0)"
  ).bind(nonce, tNow, expiresAt).run();
  return json({ nonce, expires_at: expiresAt });
}

async function orgLoginPoll(request, env) {
  // §14.4 steps [4] and [11]: desktop polls for the session.
  const url = new URL(request.url);
  const nonce = (url.searchParams.get("nonce") || "").trim();
  if (!nonce) return err("nonce required");
  const row = await env.DB.prepare(
    "SELECT nonce, issued_at, expires_at, claimed_by, session_token, consumed FROM login_challenges WHERE nonce = ?"
  ).bind(nonce).first();
  if (!row) return json({ error: "challenge_expired" }, 410);
  if (row.expires_at < now() && !row.session_token) {
    // Expired before claim — single-shot 410.
    await env.DB.prepare("DELETE FROM login_challenges WHERE nonce = ?").bind(nonce).run();
    return json({ error: "challenge_expired" }, 410);
  }
  if (!row.session_token) return json({ status: "pending" });

  // Claimed. Resolve session + user + memberships, then mark consumed (single-use).
  const session = await env.DB.prepare(
    "SELECT token, user_id, expires_at FROM login_sessions WHERE token = ?"
  ).bind(row.session_token).first();
  if (!session) {
    // Session vanished (revoked between claim and poll). Treat as expired.
    await env.DB.prepare("DELETE FROM login_challenges WHERE nonce = ?").bind(nonce).run();
    return json({ error: "challenge_expired" }, 410);
  }
  const user = await env.DB.prepare(
    "SELECT id, display_name, pub_fp FROM portal_users WHERE id = ?"
  ).bind(session.user_id).first();
  const memberships = await env.DB.prepare(
    "SELECT m.role, o.id, o.name, o.slug FROM org_memberships m JOIN organisations o ON o.id = m.org_id WHERE m.user_id = ?"
  ).bind(session.user_id).all();
  const orgs = (memberships.results || []).map(m => ({ id: m.id, name: m.name, slug: m.slug, role: m.role }));

  // Developer can always create new orgs; lead_admin can also create new orgs (§14.9).
  // Bootstrap dev with no orgs yet still gets can_create_org: true.
  const bootstrapFp = (env.BOOTSTRAP_DEVELOPER_FP || "").trim();
  const is_developer = !!bootstrapFp && user.pub_fp === bootstrapFp;
  const can_create_org = is_developer
    || orgs.some(o => o.role === "developer" || o.role === "lead_admin");

  // Mark challenge consumed (single-shot; subsequent polls 410).
  await env.DB.prepare("UPDATE login_challenges SET consumed = 1 WHERE nonce = ?").bind(nonce).run();

  return json({
    status: "claimed",
    session_token: row.session_token,
    user_id: user.id,
    display_name: user.display_name,
    orgs,
    can_create_org,
    is_developer
  });
}

async function orgLoginClaim(request, env) {
  // §14.4 steps [7]–[9]: phone sends signed envelope binding the nonce.
  let body;
  try { body = await request.json(); } catch { return err("Invalid JSON"); }
  const { nonce, pub_jwk, sig, webauthn } = body || {};
  if (!nonce || !pub_jwk || !sig || !webauthn) return genericAuthFailed();

  // Look up challenge row first — order matters for rate-limit accounting.
  const challenge = await env.DB.prepare(
    "SELECT nonce, issued_at, expires_at, claimed_by, session_token, consumed, fail_count, locked_until FROM login_challenges WHERE nonce = ?"
  ).bind(nonce).first();
  if (!challenge) return json({ error: "challenge_expired" }, 410);
  const tNow = now();
  if (challenge.expires_at < tNow) {
    return json({ error: "challenge_expired" }, 410);
  }
  if (challenge.session_token) {
    // Already claimed by a previous successful POST. Idempotent rejection.
    return json({ error: "challenge_expired" }, 410);
  }
  if (challenge.locked_until > tNow) {
    return json({ error: "rate_limited", retry_after: challenge.locked_until - tNow }, 429);
  }

  // Verify the v5 envelope. Payload to verify is { nonce, type: "irlid_login_v5" } —
  // the phone signs exactly this object. The `type` discriminator binds the signature
  // to the login context so an envelope produced here cannot be replayed in any other
  // v5-signing context (PROTOCOL.md §14.10). The challenge inside webauthn.clientData
  // must equal SHA-256-b64url(canonical({nonce, type:"irlid_login_v5"})). v5-only (§14.13).
  // TEST-ENV DEBUG: capture the specific verifier error so we can diagnose failures
  // without deploy cycles. PROTOCOL.md §14.10 anti-enumeration only matters in
  // production with a real user database; test env has one user (Captain), so
  // verbose errors trade nothing.
  let envelopeOk = false;
  let envelopeErr = "";
  try {
    await verifyV5Envelope({ nonce, type: "irlid_login_v5" }, pub_jwk, sig, webauthn);
    envelopeOk = true;
  } catch (e) {
    envelopeOk = false;
    envelopeErr = (e && e.message) ? String(e.message) : String(e);
  }

  if (!envelopeOk) {
    // Increment fail_count; if at limit, lock for cooldown.
    const newFails = (challenge.fail_count || 0) + 1;
    if (newFails >= LOGIN_CLAIM_FAIL_LIMIT) {
      await env.DB.prepare(
        "UPDATE login_challenges SET fail_count = ?, locked_until = ? WHERE nonce = ?"
      ).bind(newFails, tNow + LOGIN_CLAIM_COOLDOWN_S, nonce).run();
      const rateBody = { error: "rate_limited", retry_after: LOGIN_CLAIM_COOLDOWN_S };
      if (env.LOGIN_DEBUG === "1") rateBody.debug_reason = "envelope_failed: " + envelopeErr;
      return json(rateBody, 429);
    } else {
      await env.DB.prepare(
        "UPDATE login_challenges SET fail_count = ? WHERE nonce = ?"
      ).bind(newFails, nonce).run();
      return genericAuthFailed(env, { debug_reason: "envelope_verify_failed", debug_detail: envelopeErr });
    }
  }

  // Envelope verified. Compute pub_fp (matches existing device_pub_fp pattern, 16 chars).
  const fp = await deviceKeyFp(pub_jwk);
  if (!fp) return genericAuthFailed(env, { debug_reason: "fp_compute_failed" });

  // Look up or bootstrap user.
  let user = await env.DB.prepare(
    "SELECT id, display_name FROM portal_users WHERE pub_fp = ?"
  ).bind(fp).first();

  if (!user) {
    // Not a known user. Permitted only if this fp matches BOOTSTRAP_DEVELOPER_FP (§14.6).
    const bootstrapFp = (env.BOOTSTRAP_DEVELOPER_FP || "").trim();
    if (!bootstrapFp || fp !== bootstrapFp) {
      // TEST-ENV DEBUG: include diagnostic detail so Captain can see WHICH path
      // failed (no bootstrap fp set vs fp != bootstrap fp). Production v5.5 will
      // restore the generic auth_failed per §14.10.
      const newFails = (challenge.fail_count || 0) + 1;
      if (newFails >= LOGIN_CLAIM_FAIL_LIMIT) {
        await env.DB.prepare(
          "UPDATE login_challenges SET fail_count = ?, locked_until = ? WHERE nonce = ?"
        ).bind(newFails, tNow + LOGIN_CLAIM_COOLDOWN_S, nonce).run();
        return json({ error: "rate_limited", retry_after: LOGIN_CLAIM_COOLDOWN_S }, 429);
      } else {
        await env.DB.prepare(
          "UPDATE login_challenges SET fail_count = ? WHERE nonce = ?"
        ).bind(newFails, nonce).run();
        return genericAuthFailed(env, {
          debug_reason: !bootstrapFp ? "no_bootstrap_fp_configured" : "fp_mismatch",
          debug_computed_fp: fp,
          debug_bootstrap_fp_len: bootstrapFp ? bootstrapFp.length : 0,
          debug_bootstrap_fp_first4: bootstrapFp ? bootstrapFp.slice(0, 4) : "",
          debug_bootstrap_fp_last4: bootstrapFp ? bootstrapFp.slice(-4) : ""
        });
      }
    }
    // Bootstrap path — create the founding developer user row.
    // Display name "Developer (Super-Admin)" per Captain's 4 May feedback —
    // most observers won't parse "Captain" but will understand "Super-Admin".
    const userId = randomToken().slice(0, 26); // ULID-like length, opaque
    const bootstrapDisplayName = "Developer (Super-Admin)";
    await env.DB.prepare(
      "INSERT INTO portal_users (id, pub_jwk, pub_fp, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(userId, JSON.stringify(pub_jwk), fp, bootstrapDisplayName, tNow, tNow).run();
    user = { id: userId, display_name: bootstrapDisplayName };
  }

  // Issue session.
  const sessionToken = randomToken();
  const sessionExpires = tNow + LOGIN_SESSION_TTL_S;
  const ipHash = await hashIp(request);
  const ua = (request.headers.get("user-agent") || "").slice(0, 256);
  await env.DB.prepare(
    "INSERT INTO login_sessions (token, user_id, issued_at, expires_at, ip_hash, user_agent) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(sessionToken, user.id, tNow, sessionExpires, ipHash, ua).run();

  // Bind session to challenge for the desktop poll to pick up.
  await env.DB.prepare(
    "UPDATE login_challenges SET claimed_by = ?, session_token = ? WHERE nonce = ?"
  ).bind(user.id, sessionToken, nonce).run();

  return json({ ok: true });
}

// =====================
//  USER ENDPOINTS — PROTOCOL.md §14, Batch C
// =====================
// Session-authenticated user-level endpoints. Auth via Authorization: Bearer <token>
// where the token came from /org/login/poll on a successful claim. The Worker resolves
// the token to a portal_users row, slides the session expiry forward, and the calling
// endpoint operates with that user identity.

async function requireSession(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+([A-Za-z0-9_-]{16,})$/.exec(auth.trim());
  if (!m) return { error: json({ error: "session_required" }, 401) };
  const token = m[1];
  const session = await env.DB.prepare(
    "SELECT token, user_id, expires_at FROM login_sessions WHERE token = ?"
  ).bind(token).first();
  if (!session) return { error: json({ error: "session_invalid" }, 401) };
  const tNow = now();
  if (session.expires_at < tNow) {
    // Expired — clean up and reject.
    await env.DB.prepare("DELETE FROM login_sessions WHERE token = ?").bind(token).run();
    return { error: json({ error: "session_expired" }, 401) };
  }
  // Sliding TTL — every authed request resets expires_at.
  await env.DB.prepare(
    "UPDATE login_sessions SET expires_at = ? WHERE token = ?"
  ).bind(tNow + LOGIN_SESSION_TTL_S, token).run();
  // Resolve the user.
  const user = await env.DB.prepare(
    "SELECT id, display_name, pub_fp FROM portal_users WHERE id = ?"
  ).bind(session.user_id).first();
  if (!user) return { error: json({ error: "session_user_missing" }, 401) };
  return { user };
}

// GET /user/orgs — list orgs the authenticated user belongs to, with role and api_key
// (api_key is returned to authorized members so the existing X-Org-Key dashboard code
// can keep working during the v5.5 transition; v6+ will move dashboard ops onto Bearer
// session auth and api_key returns to service-account-only). Per §14.9 role table.
async function userListOrgs(request, env) {
  const ctx = await requireSession(request, env);
  if (ctx.error) return ctx.error;
  const user = ctx.user;
  const memberships = await env.DB.prepare(
    "SELECT m.role, o.id, o.name, o.slug, o.api_key, o.settings_json " +
    "FROM org_memberships m JOIN organisations o ON o.id = m.org_id WHERE m.user_id = ? " +
    "ORDER BY m.granted_at ASC"
  ).bind(user.id).all();
  const orgs = (memberships.results || []).map(m => {
    let settings = null;
    try { settings = m.settings_json ? JSON.parse(m.settings_json) : null; } catch (_) {}
    return {
      id: m.id,
      name: m.name,
      slug: m.slug,
      role: m.role,
      api_key: m.api_key,
      settings,
      implicit_membership: false
    };
  });

  // PROTOCOL.md §14.9 — `developer` is a platform-tier role, not just an org-tier
  // role. The bootstrap developer (whose pub_fp matches BOOTSTRAP_DEVELOPER_FP) is
  // the founder of the IRLid deployment and gets implicit "see all orgs" rights
  // so they can recover orgs whose lead_admins have left, perform forensic audits,
  // or simply observe the platform. Non-bootstrap users only see orgs they
  // explicitly belong to (per §14.9 row "lead_admin"). This dev-implicit access is
  // returned alongside explicit memberships with role: 'developer' and a flag
  // implicit_membership: true so the UI can label the difference (e.g. "(dev access)").
  // Captain's 4 May expectation that "developer" means "super admin who can fix any
  // org" — confirmed in spec, now matched in implementation.
  const bootstrapFp = (env.BOOTSTRAP_DEVELOPER_FP || "").trim();
  const isBootstrapDev = bootstrapFp && user.pub_fp === bootstrapFp;
  if (isBootstrapDev) {
    const ownIds = new Set(orgs.map(o => o.id));
    const allOrgs = await env.DB.prepare(
      "SELECT id, name, slug, api_key, settings_json FROM organisations ORDER BY created_at DESC"
    ).all();
    for (const o of (allOrgs.results || [])) {
      if (!ownIds.has(o.id)) {
        let settings = null;
        try { settings = o.settings_json ? JSON.parse(o.settings_json) : null; } catch (_) {}
        orgs.push({
          id: o.id,
          name: o.name,
          slug: o.slug,
          role: 'developer',
          api_key: o.api_key,
          settings,
          implicit_membership: true
        });
      }
    }
  }

  return json({ user_id: user.id, display_name: user.display_name, orgs, is_developer: isBootstrapDev });
}

// POST /user/create-org — create a new organisation with the authenticated user as
// lead_admin (or developer if user.pub_fp is the bootstrap fp). Authorization:
//   • developer (pub_fp matches BOOTSTRAP_DEVELOPER_FP), OR
//   • user has lead_admin or developer role on at least one existing org
// Body: { name: string (required, min 2), website_url?: string (optional, https/http) }
// Staff scan-in flow deferred to Batch C.5 — MVP creates the org with the requester
// as the sole member; additional members get added via dashboard "Add staff" actions.
async function userCreateOrg(request, env) {
  const ctx = await requireSession(request, env);
  if (ctx.error) return ctx.error;
  const user = ctx.user;

  let body;
  try { body = await request.json(); } catch { return err("Invalid JSON"); }
  const name = (body && typeof body.name === "string") ? body.name.trim() : "";
  const websiteUrl = (body && typeof body.website_url === "string") ? body.website_url.trim() : "";
  if (!name || name.length < 2) return err("name required (min 2 chars)");
  if (websiteUrl && !/^https?:\/\/[^\s]{3,}$/i.test(websiteUrl)) return err("website_url must be a valid http(s) URL or omitted");

  // Authorization check: developer OR has lead_admin/developer role somewhere.
  const bootstrapFp = (env.BOOTSTRAP_DEVELOPER_FP || "").trim();
  const isBootstrapDev = bootstrapFp && user.pub_fp === bootstrapFp;
  let hasAdminRole = false;
  if (!isBootstrapDev) {
    const elevated = await env.DB.prepare(
      "SELECT 1 FROM org_memberships WHERE user_id = ? AND role IN ('lead_admin','developer') LIMIT 1"
    ).bind(user.id).first();
    hasAdminRole = !!elevated;
  }
  if (!isBootstrapDev && !hasAdminRole) {
    return json({ error: "create_org_forbidden", reason: "only developer or existing lead_admin may create orgs" }, 403);
  }

  // Slug + uniqueness check.
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) return err("name produced empty slug — use letters/numbers");
  const existing = await env.DB.prepare("SELECT id FROM organisations WHERE slug = ?").bind(slug).first();
  if (existing) return err("Organisation name already taken (slug collision)");

  // Provision the org row + venue keypair (mirrors orgRegister).
  const orgId = uuid();
  const apiKey = "org_" + randomToken();
  const tNow = now();
  const venueKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pubJwk = await crypto.subtle.exportKey("jwk", venueKey.publicKey);
  const prvJwk = await crypto.subtle.exportKey("jwk", venueKey.privateKey);
  const defaultSettings = {
    minScore: 50, distanceM: 12, windowS: 90,
    bioRequired: false, privacyMode: true, checkoutEnabled: true, anonymousMode: false,
    websiteUrl: websiteUrl || ""
    // theme_scrape_status: "queued" once Batch D ships the website-scrape worker function.
  };
  await env.DB.prepare(
    "INSERT INTO organisations (id, name, slug, api_key, venue_pub_jwk, venue_prv_jwk, settings_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).bind(orgId, name, slug, apiKey, JSON.stringify(pubJwk), JSON.stringify(prvJwk), JSON.stringify(defaultSettings), tNow, tNow).run();

  // Insert the creator's membership. Bootstrap developer keeps developer role; everyone
  // else becomes lead_admin of their own new org. Per Captain's 4 May direction
  // ("orgs only have one Lead Admin"), the schema doesn't yet enforce uniqueness
  // but we check at insert time. For org creation this is automatic — a new org
  // has no existing memberships — but the same check fires when invite-claim
  // promotes someone to lead_admin (Batch C.5). Developer override path is a
  // future v6+ admin tool (rescue scenarios when the sole lead_admin loses their
  // device). For now, one primary lead_admin per org is the contract.
  const role = isBootstrapDev ? "developer" : "lead_admin";
  if (role === "lead_admin") {
    const existingLead = await env.DB.prepare(
      "SELECT user_id FROM org_memberships WHERE org_id = ? AND role = 'lead_admin' LIMIT 1"
    ).bind(orgId).first();
    if (existingLead) {
      // Should never happen for a fresh org, but defensive: if somehow there
      // already is a lead_admin, fall back to manager rather than violating the
      // one-lead_admin-per-org contract.
      return err("Org already has a lead_admin (unexpected) — contact developer", 409);
    }
  }
  await env.DB.prepare(
    "INSERT INTO org_memberships (user_id, org_id, role, granted_by, granted_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(user.id, orgId, role, user.id, tNow).run();

  return json({
    org: { id: orgId, name, slug, api_key: apiKey, settings: defaultSettings },
    membership: { role, user_id: user.id, granted_at: tNow },
    theme_scrape_status: websiteUrl ? "deferred_to_batch_d" : "none"
  }, 201);
}

async function requireOrgThemeAdmin(request, env, orgId) {
  const ctx = await requireSession(request, env);
  if (ctx.error) return { error: ctx.error };
  const org = await env.DB.prepare("SELECT * FROM organisations WHERE id = ?")
    .bind(orgId).first();
  if (!org) return { error: json({ error: "org_not_found" }, 404) };

  const bootstrapFp = (env.BOOTSTRAP_DEVELOPER_FP || "").trim();
  const isBootstrapDev = bootstrapFp && ctx.user.pub_fp === bootstrapFp;
  if (isBootstrapDev) return { user: ctx.user, org, role: "developer" };

  const membership = await env.DB.prepare(
    "SELECT role FROM org_memberships WHERE org_id = ? AND user_id = ? LIMIT 1"
  ).bind(orgId, ctx.user.id).first();
  const role = membership && membership.role;
  if (role !== "lead_admin" && role !== "developer") {
    return { error: json({ error: "forbidden", reason: "lead_admin_or_developer_required" }, 403) };
  }
  return { user: ctx.user, org, role };
}

function absoluteUrl(value, baseUrl) {
  if (!value || typeof value !== "string") return "";
  try { return new URL(value.trim(), baseUrl).href; } catch (_) { return ""; }
}

function normalizeScrapedThemeColor(value) {
  const color = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return "#" + color.slice(1).split("").map(ch => ch + ch).join("").toUpperCase();
  }
  return color;
}

async function userScrapeTheme(request, env, orgId) {
  const ctx = await requireOrgThemeAdmin(request, env, orgId);
  if (ctx.error) return ctx.error;

  const org = ctx.org;
  let settings = {};
  try { settings = org.settings_json ? JSON.parse(org.settings_json) : {}; } catch (_) {}
  const websiteValue = settings.websiteUrl || settings.website_url || "";
  const websiteUrl = parsePublicHttpUrl(websiteValue);
  if (!websiteUrl) return err("websiteUrl must be a public http(s) URL in org settings");

  const cached = settings.theme_scrape;
  if (cached && cached.website_url === websiteUrl.href && Date.now() - Number(cached.scraped_at || 0) < THEME_SCRAPE_TTL_MS) {
    return json({ cached: true, ...cached });
  }

  let htmlResponse;
  try {
    htmlResponse = await fetch(websiteUrl.href, {
      headers: {
        "User-Agent": "IRLidThemeScraper/1.0 (+https://github.com/BunHead/IRLid-TestEnvironment)",
        "Accept": "text/html,application/xhtml+xml"
      },
      signal: AbortSignal.timeout(THEME_SCRAPE_TIMEOUT_MS),
      redirect: "follow"
    });
  } catch (e) {
    return json({ error: "scrape_fetch_failed", detail: e && e.message ? e.message : "fetch failed" }, 502);
  }
  if (!htmlResponse.ok) return json({ error: "scrape_fetch_failed", status: htmlResponse.status }, 502);

  const contentType = htmlResponse.headers.get("content-type") || "";
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    return json({ error: "scrape_not_html", content_type: contentType }, 415);
  }

  const found = { theme_color: null, logo_candidates: [], og_image: null, title: "" };
  const baseUrl = htmlResponse.url || websiteUrl.href;
  const seenLogos = new Set();
  const addLogo = (href) => {
    const absolute = absoluteUrl(href, baseUrl);
    if (!absolute || seenLogos.has(absolute)) return;
    seenLogos.add(absolute);
    if (found.logo_candidates.length < 12) found.logo_candidates.push(absolute);
  };

  const rewriter = new HTMLRewriter()
    .on('meta[name="theme-color"]', {
      element(el) {
        if (!found.theme_color) found.theme_color = normalizeScrapedThemeColor(el.getAttribute("content"));
      }
    })
    .on('meta[property="og:image"]', {
      element(el) {
        if (!found.og_image) found.og_image = absoluteUrl(el.getAttribute("content"), baseUrl);
      }
    })
    .on('link[rel]', {
      element(el) {
        const rel = String(el.getAttribute("rel") || "").toLowerCase();
        if (/(^|\s)(icon|shortcut icon|apple-touch-icon|mask-icon)(\s|$)/.test(rel)) addLogo(el.getAttribute("href"));
      }
    })
    .on("title", {
      text(text) {
        if (found.title.length < 240) found.title += text.text;
      }
    });

  try {
    await rewriter.transform(htmlResponse).arrayBuffer();
  } catch (e) {
    return json({ error: "scrape_parse_failed", detail: e && e.message ? e.message : "HTML parse failed" }, 502);
  }

  if (found.og_image) addLogo(found.og_image);
  const result = {
    website_url: websiteUrl.href,
    title: found.title.trim().replace(/\s+/g, " ").slice(0, 160),
    theme_color: found.theme_color || null,
    og_image: found.og_image || null,
    logo_candidates: found.logo_candidates,
    scraped_at: Date.now()
  };

  settings.websiteUrl = websiteUrl.href;
  settings.theme_scrape = result;
  await env.DB.prepare("UPDATE organisations SET settings_json=?, updated_at=? WHERE id=?")
    .bind(JSON.stringify(settings), now(), org.id).run();
  return json({ cached: false, ...result });
}

async function utilImageProxy(request, env) {
  const target = parsePublicHttpUrl(new URL(request.url).searchParams.get("url") || "");
  if (!target) return err("url must be a public http(s) image URL", 400);

  let proxied;
  try {
    proxied = await fetch(target.href, {
      headers: {
        "User-Agent": "IRLidImageProxy/1.0",
        "Accept": "image/*"
      },
      signal: AbortSignal.timeout(THEME_SCRAPE_TIMEOUT_MS),
      redirect: "follow"
    });
  } catch (e) {
    return err("image_fetch_failed", 502);
  }
  if (!proxied.ok) return err("image_fetch_failed", 502);

  const type = proxied.headers.get("content-type") || "";
  if (!/^image\//i.test(type)) return err("not_an_image", 415);
  const declaredLength = Number(proxied.headers.get("content-length") || 0);
  if (declaredLength && declaredLength > IMAGE_PROXY_MAX_BYTES) return err("image_too_large", 413);

  const bytes = await proxied.arrayBuffer();
  if (bytes.byteLength > IMAGE_PROXY_MAX_BYTES) return err("image_too_large", 413);

  const response = new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff"
    }
  });
  return addCors(response, env, request);
}

// =====================
//  ORGANISATION PORTAL
// =====================

async function orgRegister(request, env) {
  let body;
  try { body = await request.json(); } catch { return err("Invalid JSON"); }
  const { name } = body;
  if (!name || name.trim().length < 2) return err("name required (min 2 chars)");
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const existing = await env.DB.prepare("SELECT id FROM organisations WHERE slug = ?").bind(slug).first();
  if (existing) return err("Organisation name already taken");
  const id = uuid();
  const apiKey = "org_" + randomToken();
  const t = now();
  // Generate persistent venue keypair for attendee-scan mode
  const venueKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pubJwk = await crypto.subtle.exportKey("jwk", venueKey.publicKey);
  const prvJwk = await crypto.subtle.exportKey("jwk", venueKey.privateKey);
  const defaultSettings = { minScore: 50, distanceM: 12, windowS: 90, bioRequired: false, privacyMode: true, checkoutEnabled: true, anonymousMode: false };
  await env.DB.prepare(
    "INSERT INTO organisations (id, name, slug, api_key, venue_pub_jwk, venue_prv_jwk, settings_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).bind(id, name.trim(), slug, apiKey, JSON.stringify(pubJwk), JSON.stringify(prvJwk), JSON.stringify(defaultSettings), t, t).run();
  return json({ id, name: name.trim(), slug, api_key: apiKey, settings: defaultSettings }, 201);
}

async function orgGetSettings(request, env) {
  const org = await orgAuth(request, env); if (org.error) return org;
  const settings = JSON.parse(org.settings_json || "{}");
  return json({ id: org.id, name: org.name, slug: org.slug, settings });
}

async function orgUpdateSettings(request, env) {
  const org = await orgAuth(request, env); if (org.error) return org;
  let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
  // Settings allowlist. Adding new keys is purely additive — existing rows are unaffected.
  // Branding + theme keys (Batch 6.5, 3 May 2026) extend the original v6 set.
  const allowed = [
    // --- Original v6 core gates ---
    "minScore","distanceM","windowS","bioRequired","privacyMode","checkoutEnabled","anonymousMode",
    // --- Identity / proof rules (placeholder-but-persist-able for first-scan flow integration) ---
    "returnAllowed","allowSelfSelection","requireDoormanConfirmation","requireAdditionalProof",
    "allowProofRecording","enableIdPhotoCapture",
    // --- Branding ---
    "logoUrl","welcomeMessage","redirectUrl","websiteUrl",
    // --- Theme (Batch 6.5 → 6.5f) ---
    "theme"  // { primary, accent, qrFg, palette[], bgPalette[], darkMode, bgMode, bgIntensity, bgPattern, bgImageUrl, bgImagePosition, bgImageAnchor, bgImageAlphaCycle, cycleMode, bgAnimDuration, cycleAnimDuration } — validated below
  ];
  // Theme validators — defensive, applied before merge.
  function isHex6(v) { return typeof v === "string" && /^#[0-9A-Fa-f]{6}$/.test(v); }
  function relLuminance(hex) {
    const m = /^#([0-9a-fA-F]{6})$/.exec(hex || ""); if (!m) return 0;
    const v = parseInt(m[1], 16);
    const ch = [(v>>16)&255, (v>>8)&255, v&255].map(c => {
      const s = c/255; return s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4);
    });
    return 0.2126*ch[0] + 0.7152*ch[1] + 0.0722*ch[2];
  }
  function contrastVsWhite(hex) {
    const l = relLuminance(hex); return (1 + 0.05) / (l + 0.05);
  }
  function validateTheme(t) {
    if (t === null || t === undefined) return null; // allow clearing theme
    if (typeof t !== "object") return "theme must be an object";
    if (t.primary !== undefined && !isHex6(t.primary)) return "theme.primary must be a #RRGGBB hex string";
    if (t.accent  !== undefined && !isHex6(t.accent))  return "theme.accent must be a #RRGGBB hex string";
    if (t.qrFg    !== undefined) {
      if (!isHex6(t.qrFg)) return "theme.qrFg must be a #RRGGBB hex string";
      // QR readability — reject foregrounds with insufficient contrast against white.
      if (contrastVsWhite(t.qrFg) < 4.5) return "theme.qrFg contrast against white below 4.5:1 — QR may not scan reliably";
    }
    if (t.palette !== undefined) {
      if (!Array.isArray(t.palette)) return "theme.palette must be an array";
      if (t.palette.length > 7) return "theme.palette length must be at most 7";
      for (const c of t.palette) { if (!isHex6(c)) return "theme.palette entries must be #RRGGBB hex strings"; }
    }
    if (t.darkMode !== undefined && typeof t.darkMode !== "boolean" && t.darkMode !== "auto") {
      return "theme.darkMode must be true, false, or 'auto'";
    }
    if (t.acceptCycleEnabled !== undefined && typeof t.acceptCycleEnabled !== "boolean") {
      return "theme.acceptCycleEnabled must be a boolean";
    }
    // Batch 6.5f — Celebration mode (replaces acceptCycleEnabled).
    if (t.cycleMode !== undefined) {
      if (typeof t.cycleMode !== "string" || ["off","page","glow","pattern"].indexOf(t.cycleMode) === -1) {
        return "theme.cycleMode must be one of: off, page, glow, pattern";
      }
    }
    // Batch 6.5b — animation speed controls
    if (t.bgAnimEnabled !== undefined && typeof t.bgAnimEnabled !== "boolean") {
      return "theme.bgAnimEnabled must be a boolean";
    }
    if (t.bgAnimDuration !== undefined) {
      if (typeof t.bgAnimDuration !== "number" || !Number.isFinite(t.bgAnimDuration) || t.bgAnimDuration < 1 || t.bgAnimDuration > 600) {
        return "theme.bgAnimDuration must be a number between 1 and 600 (seconds)";
      }
    }
    if (t.cycleAnimDuration !== undefined) {
      if (typeof t.cycleAnimDuration !== "number" || !Number.isFinite(t.cycleAnimDuration) || t.cycleAnimDuration < 0.1 || t.cycleAnimDuration > 30) {
        return "theme.cycleAnimDuration must be a number between 0.1 and 30 (seconds)";
      }
    }
    // Batch 6.5d → 6.5e — background mode + intensity + bgPalette array + pattern + Tier-3
    if (t.celebrationTextTemplate !== undefined) {
      if (typeof t.celebrationTextTemplate !== "string" || ["none","outcome","checked_in","welcome"].indexOf(t.celebrationTextTemplate) === -1) {
        return "theme.celebrationTextTemplate must be one of: none, outcome, checked_in, welcome";
      }
    }
    if (t.celebrationTextPosition !== undefined) {
      if (typeof t.celebrationTextPosition !== "string" || ["top","center","bottom"].indexOf(t.celebrationTextPosition) === -1) {
        return "theme.celebrationTextPosition must be one of: top, center, bottom";
      }
    }
    if (t.celebrationTextSize !== undefined) {
      if (typeof t.celebrationTextSize !== "string" || ["small","medium","large"].indexOf(t.celebrationTextSize) === -1) {
        return "theme.celebrationTextSize must be one of: small, medium, large";
      }
    }
    if (t.bgMode !== undefined) {
      if (typeof t.bgMode !== "string" || ["off","page","glow","pattern","image"].indexOf(t.bgMode) === -1) {
        return "theme.bgMode must be one of: off, page, glow, pattern, image";
      }
    }
    // bgIntensity — Batch 6.5e canonical name for muted/vibrant page-cycle.
    if (t.bgIntensity !== undefined) {
      if (typeof t.bgIntensity !== "string" || ["muted","vibrant"].indexOf(t.bgIntensity) === -1) {
        return "theme.bgIntensity must be either 'muted' or 'vibrant'";
      }
    }
    // bgPalette — Batch 6.5e canonical: array of up to 7 hex strings (Background palette).
    // Backward compat: still accept string 'muted'|'vibrant' (6.5d shape) which the
    // client translates to bgIntensity on load. Reject anything else.
    if (t.bgPalette !== undefined) {
      if (Array.isArray(t.bgPalette)) {
        if (t.bgPalette.length > 7) return "theme.bgPalette length must be at most 7";
        for (const c of t.bgPalette) { if (!isHex6(c)) return "theme.bgPalette entries must be #RRGGBB hex strings"; }
      } else if (typeof t.bgPalette === "string") {
        if (["muted","vibrant"].indexOf(t.bgPalette) === -1) {
          return "theme.bgPalette (legacy string form) must be 'muted' or 'vibrant'";
        }
      } else {
        return "theme.bgPalette must be an array of hex strings (or legacy 'muted'/'vibrant' string)";
      }
    }
    if (t.bgPattern !== undefined) {
      if (typeof t.bgPattern !== "string") return "theme.bgPattern must be a string";
      const PATTERNS = ["dots","hex","diag","checker","grid","weave","chevron","iso","custom"];
      if (PATTERNS.indexOf(t.bgPattern) === -1) return "theme.bgPattern not recognised";
    }
    if (t.bgImageUrl !== undefined && t.bgImageUrl !== null) {
      // Accepts https:// URLs (for hosted images) or data:image/ URIs (for inline
      // upload — went live in 4 May tidy 2). Length cap 300_000 chars allows ~225KB
      // binary as a base64 data URI. Frontend caps uploads at 200KB binary
      // (~270K chars) so 300K leaves a small buffer for safety.
      if (typeof t.bgImageUrl !== "string") return "theme.bgImageUrl must be a string or null";
      if (t.bgImageUrl.length > 300000) return "theme.bgImageUrl too long (max 300000 chars ≈ 225KB binary)";
      if (!/^(https:\/\/|data:image\/)/i.test(t.bgImageUrl)) return "theme.bgImageUrl must be an https:// URL or data:image/ URI";
    }
    if (t.bgImagePosition !== undefined) {
      // v5.7.1m.1 — added edge anchors top/bottom/left/right alongside the four corner anchors.
      const POSITIONS = ["centre","tile","cover","top","top-left","top-right","bottom","bottom-left","bottom-right","left","right"];
      if (typeof t.bgImagePosition !== "string" || POSITIONS.indexOf(t.bgImagePosition) === -1) {
        return "theme.bgImagePosition must be one of: centre, tile, cover, top, top-left, top-right, bottom, bottom-left, bottom-right, left, right";
      }
    }
    // v5.7.1w — bgImageAnchor: outer (flush, default) | centre (~12.5% inset) | inner (~25% inset).
    // Visualised in the dashboard's 9-button position grid by sliding the dot inside
    // the active cell. Only meaningful for non-centre positions.
    if (t.bgImageAnchor !== undefined) {
      const ANCHORS = ["outer","centre","inner"];
      if (typeof t.bgImageAnchor !== "string" || ANCHORS.indexOf(t.bgImageAnchor) === -1) {
        return "theme.bgImageAnchor must be one of: outer, centre, inner";
      }
    }
    if (t.bgImageAlphaCycle !== undefined && typeof t.bgImageAlphaCycle !== "boolean") {
      return "theme.bgImageAlphaCycle must be a boolean";
    }
    return null;
  }
  const current = JSON.parse(org.settings_json || "{}");
  // Validate theme separately (other keys pass through as primitives/strings).
  if (body.theme !== undefined) {
    const themeErr = validateTheme(body.theme);
    if (themeErr) return err(themeErr);
  }
  // String length sanity — protect against an admin pasting a 1MB welcome message.
  if (body.logoUrl !== undefined && typeof body.logoUrl !== "string") return err("logoUrl must be a string");
  if (body.websiteUrl !== undefined && (typeof body.websiteUrl !== "string" || (body.websiteUrl.trim() && !parsePublicHttpUrl(body.websiteUrl)))) return err("websiteUrl must be a public http(s) URL or blank");
  if (body.welcomeMessage !== undefined && typeof body.welcomeMessage === "string" && body.welcomeMessage.length > 2000) return err("welcomeMessage too long (max 2000 chars)");
  if (body.redirectUrl !== undefined && typeof body.redirectUrl !== "string") return err("redirectUrl must be a string");
  for (const k of allowed) { if (body[k] !== undefined) current[k] = body[k]; }
  await env.DB.prepare("UPDATE organisations SET settings_json=?, updated_at=? WHERE id=?")
    .bind(JSON.stringify(current), now(), org.id).run();
  return json({ settings: current });
}

async function orgGetQR(request, env) {
  // Returns the venue's public key + metadata for the attendee-scan QR
  const org = await orgAuth(request, env); if (org.error) return org;
  const pub = JSON.parse(org.venue_pub_jwk);
  const settings = JSON.parse(org.settings_json || "{}");
  const payload = { orgId: org.id, orgName: org.name, pub, ts: now(), mode: "checkin-venue", v: 1 };
  return json({ payload, settings });
}

async function orgFromRequest(request, env) {
  const url = new URL(request.url);
  const key = request.headers.get("X-Org-Key") || url.searchParams.get("key") || url.searchParams.get("org");
  if (!key) return null;
  return env.DB.prepare("SELECT * FROM organisations WHERE api_key=? OR id=? OR slug=?").bind(key, key, key).first();
}

const EXPECTED_SELECT =
  "id,org_code,first_name,surname,status,created_at,linked_at,device_key_fp,COALESCE(prototype_role,'attendee') AS prototype_role";

async function expectedKeySet(env, orgCode, expectedId) {
  const keys = new Set();
  const primary = await env.DB.prepare(
    "SELECT device_key_fp FROM org_expected WHERE id=? AND org_code=?"
  ).bind(expectedId, orgCode).first();
  if (primary?.device_key_fp) keys.add(primary.device_key_fp);
  if (await tableExists(env, "rebind_history")) {
    const rows = await env.DB.prepare(
      "SELECT new_device_fp FROM rebind_history WHERE org_code=? AND expected_id=? ORDER BY created_at ASC, id ASC"
    ).bind(orgCode, expectedId).all();
    for (const row of (rows.results || [])) {
      if (row.new_device_fp) keys.add(row.new_device_fp);
    }
  }
  return Array.from(keys);
}

async function expectedRowWithKeys(env, orgCode, expectedId) {
  const row = await env.DB.prepare(
    `SELECT ${EXPECTED_SELECT} FROM org_expected WHERE id=? AND org_code=?`
  ).bind(expectedId, orgCode).first();
  if (!row) return null;
  row.device_key_fps = await expectedKeySet(env, orgCode, expectedId);
  return row;
}

async function findExpectedByDeviceFp(env, orgCode, deviceFp) {
  const fp = String(deviceFp || "").trim();
  if (!fp) return null;
  const direct = await env.DB.prepare(
    `SELECT ${EXPECTED_SELECT} FROM org_expected WHERE org_code=? AND device_key_fp=? AND status='linked' ORDER BY linked_at DESC, id DESC LIMIT 1`
  ).bind(orgCode, fp).first();
  if (direct) {
    direct.device_key_fps = await expectedKeySet(env, orgCode, direct.id);
    return direct;
  }
  if (await tableExists(env, "rebind_history")) {
    const viaHistory = await env.DB.prepare(
      "SELECT e.id,e.org_code,e.first_name,e.surname,e.status,e.created_at,e.linked_at,e.device_key_fp,COALESCE(e.prototype_role,'attendee') AS prototype_role FROM rebind_history r JOIN org_expected e ON e.id=r.expected_id AND e.org_code=r.org_code WHERE r.org_code=? AND r.new_device_fp=? AND e.status='linked' ORDER BY r.created_at DESC, r.id DESC LIMIT 1"
    ).bind(orgCode, fp).first();
    if (viaHistory) {
      viaHistory.device_key_fps = await expectedKeySet(env, orgCode, viaHistory.id);
      return viaHistory;
    }
  }
  return null;
}

async function orgRecognize(request, env) {
  const org = await orgFromRequest(request, env);
  if (!org) return authErr("organisation required", 401);
  const url = new URL(request.url);
  const deviceFp = (url.searchParams.get("device_pub") || "").trim();
  if (!deviceFp) return err("device_pub required");
  const row = await findExpectedByDeviceFp(env, org.id, deviceFp);
  if (!row) return json({ recognized: false });
  return json({ recognized: true, name: `${row.first_name || ""} ${row.surname || ""}`.trim(), expected_id: row.id });
}

async function orgExpectedLookupByFp(request, env, fpParam) {
  const org = await orgAuth(request, env);
  if (org.error) return noStore(err("organisation not found", 404));
  const fp = String(fpParam || "").trim();
  if (!fp) return noStore(err("pub_fp required", 400));

  const expected = await findExpectedByDeviceFp(env, org.id, fp);
  if (expected) {
    return noStore(json({
      status: "linked",
      expected_id: expected.id,
      expected_name: `${expected.first_name || ""} ${expected.surname || ""}`.trim()
    }));
  }

  const rejected = await env.DB.prepare(
    "SELECT id,status FROM org_checkins WHERE org_id=? AND device_key_fp=? AND status IN ('rejected','invalid') ORDER BY checkin_at DESC, id DESC LIMIT 1"
  ).bind(org.id, fp).first();
  if (rejected) {
    return noStore(json({
      status: "rejected",
      reason: rejected.status === "invalid" ? "Staff could not approve this device" : "Not allowed"
    }));
  }

  return noStore(json({ status: "pending" }));
}

async function orgActiveCheckin(request, env) {
  const org = await orgFromRequest(request, env);
  if (!org) return authErr("organisation required", 401);
  const url = new URL(request.url);
  const deviceFp = (url.searchParams.get("device_pub") || "").trim();
  if (!deviceFp) return err("device_pub required");

  const row = await env.DB.prepare(
    "SELECT id,name,attendee_label,checkin_at FROM org_checkins WHERE org_id=? AND device_key_fp=? AND checkout_at IS NULL AND status!='invalid' ORDER BY checkin_at DESC LIMIT 1"
  ).bind(org.id, deviceFp).first();
  if (!row) return json({ active: false });

  const settings = JSON.parse(org.settings_json || "{}");
  return json({
    active: true,
    checkin_id: row.id,
    nonce: "rescan_" + randomToken(),
    name: row.name || row.attendee_label || "",
    checkin_at: row.checkin_at,
    event: org.name || "IRLid Event",
    logo: settings.logoUrl || ""
  });
}

async function orgStaffAuth(request, env) {
  const org = await orgAuth(request, env); if (org.error) return org;
  let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }

  let hello;
  try {
    const helloInput = body.hello ?? body.helloPayload ?? body.staffHello ?? body.staff_hello ?? body.payload ?? body.qr;
    hello = await parseHelloInput(helloInput ?? body);
  } catch {
    return err("Invalid HELLO", 400);
  }

  const verified = await verifySignedHello(hello, 90);
  if (!verified.ok) return err(verified.error, verified.status);

  const t = now();
  const expiresAt = t + 15 * 60;
  const staffPubFp = await deviceKeyFp(hello.pub);
  const hHash = await helloHashB64url(hello);

  const existing = await env.DB.prepare(
    "SELECT id, expires_at FROM org_staff_sessions WHERE org_id=? AND hello_hash=?"
  ).bind(org.id, hHash).first();
  if (existing && existing.expires_at >= t) {
    await env.DB.prepare(
      "UPDATE org_staff_sessions SET last_seen_at=? WHERE id=?"
    ).bind(t, existing.id).run();
    return json({ ok: true, staff_session: existing.id, expires_at: existing.expires_at, staff_pub_fp: staffPubFp });
  }
  if (existing) {
    await env.DB.prepare("DELETE FROM org_staff_sessions WHERE id=?").bind(existing.id).run();
  }

  const token = "staff_" + randomToken();
  await env.DB.prepare(
    "INSERT INTO org_staff_sessions (id,org_id,staff_pub_fp,staff_pub_jwk,hello_hash,verification_state,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).bind(token, org.id, staffPubFp, JSON.stringify(hello.pub), hHash, verified.verification_state, t, expiresAt, t).run();

  return json({ ok: true, staff_session: token, expires_at: expiresAt, staff_pub_fp: staffPubFp });
}

async function requireOrgStaffSession(env, org, staffSessionToken) {
  const token = String(staffSessionToken || "").trim();
  if (!token) return authErr("Staff authentication required", 401);

  const session = await env.DB.prepare(
    "SELECT id, expires_at FROM org_staff_sessions WHERE id=? AND org_id=?"
  ).bind(token, org.id).first();
  if (!session) return authErr("Invalid staff session", 401);

  const t = now();
  if (Number(session.expires_at) <= t) {
    await env.DB.prepare("DELETE FROM org_staff_sessions WHERE id=?").bind(session.id).run();
    return authErr("Staff session expired", 401);
  }

  await env.DB.prepare("UPDATE org_staff_sessions SET last_seen_at=? WHERE id=?").bind(t, session.id).run();
  return null;
}

async function requireDevOrStaffSession(request, env, org, staffSessionToken) {
  const staffError = await requireOrgStaffSession(env, org, staffSessionToken);
  if (!staffError) return null;

  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+([A-Za-z0-9_-]{16,})$/.exec(auth.trim());
  if (m) {
    const ctx = await requireSession(request, env);
    if (!ctx.error) {
      const bootstrapFp = (env.BOOTSTRAP_DEVELOPER_FP || "").trim();
      if (bootstrapFp && ctx.user && ctx.user.pub_fp === bootstrapFp) return null;
    }
  }

  return staffError;
}

async function bootstrapDeveloperFromBearer(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!/^Bearer\s+([A-Za-z0-9_-]{16,})$/.test(auth.trim())) return null;
  const ctx = await requireSession(request, env);
  if (ctx.error) return null;
  const bootstrapFp = (env.BOOTSTRAP_DEVELOPER_FP || "").trim();
  if (bootstrapFp && ctx.user && ctx.user.pub_fp === bootstrapFp) return ctx.user;
  return null;
}

async function roleForStaffPubFp(env, org, staffPubFp) {
  const fp = String(staffPubFp || "").trim();
  if (!fp) return "staff";
  const bootstrapFp = (env.BOOTSTRAP_DEVELOPER_FP || "").trim();
  if (bootstrapFp && fp === bootstrapFp) return "developer";

  const user = await env.DB.prepare(
    "SELECT id FROM portal_users WHERE pub_fp=?"
  ).bind(fp).first();
  if (user) {
    const membership = await env.DB.prepare(
      "SELECT role FROM org_memberships WHERE user_id=? AND org_id=?"
    ).bind(user.id, org.id).first();
    if (membership && EXPECTED_MEMBER_ROLES.has(membership.role)) return membership.role;
  }

  const expected = await env.DB.prepare(
    "SELECT COALESCE(prototype_role,'staff') AS prototype_role FROM org_expected WHERE org_code=? AND device_key_fp=? ORDER BY linked_at DESC, id DESC LIMIT 1"
  ).bind(org.id, fp).first();
  return expectedMemberRole(expected?.prototype_role || "staff");
}

async function requireFreshStaffProof(request, env, org) {
  const developer = await bootstrapDeveloperFromBearer(request, env);
  if (developer) return { ok: true, role: "developer", developer: true, user: developer };

  let body = {};
  try { body = await request.clone().json(); } catch {}
  const token = String(body.staff_session || body.staffSession || "").trim();
  const freshnessS = Math.max(1, parseInt(env.STAFF_HELLO_FRESHNESS_S || "300", 10) || 300);
  const t = now();
  if (!token) {
    return { error: json({ error: "stale_staff_proof", fresh_required_within_s: freshnessS }, 401) };
  }

  const session = await env.DB.prepare(
    "SELECT id, staff_pub_fp, expires_at, created_at FROM org_staff_sessions WHERE id=? AND org_id=?"
  ).bind(token, org.id).first();
  if (!session) return { error: authErr("Invalid staff session", 401) };
  if (Number(session.expires_at) <= t) {
    await env.DB.prepare("DELETE FROM org_staff_sessions WHERE id=?").bind(session.id).run();
    return { error: authErr("Staff session expired", 401) };
  }
  if (Number(session.created_at || 0) < t - freshnessS) {
    return { error: json({ error: "stale_staff_proof", fresh_required_within_s: freshnessS }, 401) };
  }

  await env.DB.prepare("UPDATE org_staff_sessions SET last_seen_at=? WHERE id=?").bind(t, session.id).run();
  return {
    ok: true,
    role: await roleForStaffPubFp(env, org, session.staff_pub_fp),
    staff_session: session.id,
    staff_pub_fp: session.staff_pub_fp
  };
}

async function orgCheckin(request, env) {
  const org = await orgAuth(request, env); if (org.error) return org;
  let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
  const { mode, helloPayload, helloHash, attendeeLabel, name, score, bioVerified, gps, staff_session } = body;
  if (!mode || !["attendee_scan","doorman_scan"].includes(mode)) return err("mode must be attendee_scan or doorman_scan");
  if (mode === "doorman_scan") {
    const staffError = await requireDevOrStaffSession(request, env, org, staff_session);
    if (staffError) return staffError;
  }
  const settings = JSON.parse(org.settings_json || "{}");
  const minScore = settings.minScore || 50;
  if (score !== undefined && score < minScore) return err(`Score ${score} below minimum ${minScore}`, 403);
  const id = uuid();
  const t = now();
  let gpsHash = null;
  if (gps && (settings.privacyMode !== false)) {
    gpsHash = await sha256B64url(canonical({ lat: Math.round(gps.lat * 10000) / 10000, lon: Math.round(gps.lon * 10000) / 10000 }));
  }
  const attendeeKeyId = helloPayload?.pub ? await pubKeyId(helloPayload.pub) : null;
  const attendeePubJwk = helloPayload?.pub ? JSON.stringify(helloPayload.pub) : null;
  const attendeeDeviceFp = helloPayload?.pub ? await deviceKeyFp(helloPayload.pub) : null;
  const label = settings.anonymousMode ? null : (attendeeLabel || null);
  const displayName = settings.anonymousMode ? null : ((name || attendeeLabel || "").trim() || null);
  // Batch C polish 5 — defence in depth against ghost-row creation. When the
  // org has anonymousMode disabled (the default), an attendee_scan with no
  // resolvable name is what produced the JfpA3uQQisWrkGldzD row Captain spotted:
  // empty name -> r.name fell through to attendee_key_id in the dashboard
  // renderer. The frontend was fixed (the "I'm not on the list" button now
  // shows a "See an organiser" hold screen instead of POSTing). This guard
  // catches any future broken client (or direct API poke) that tries the same.
  // doorman_scan is exempt: staff records walk-ins legitimately under their
  // own staff_session, and that path validates the staff identity instead.
  if (mode === "attendee_scan" && !settings.anonymousMode && !displayName) {
    return err("attendee_scan requires a resolvable name when anonymousMode is off - speak to an organiser", 422);
  }
  let link = { linked: false };
  let expected = null;
  let status = "checked_in";
  let expectedId = null;
  let conflictId = null;
  if (attendeeDeviceFp) {
    expected = await findExpectedByDeviceFp(env, org.id, attendeeDeviceFp);
    if (expected) expectedId = expected.id;
  }
  if (!expected && displayName) {
    expected = await env.DB.prepare(
      `SELECT ${EXPECTED_SELECT} FROM org_expected WHERE org_code=? AND status IN ('assist','linked') AND LOWER(first_name || ' ' || surname)=LOWER(?) ORDER BY id ASC LIMIT 1`
    ).bind(org.id, displayName).first();
    if (expected) {
      expected.device_key_fps = await expectedKeySet(env, org.id, expected.id);
      expectedId = expected.id;
      const knownKeys = new Set(expected.device_key_fps || []);
      if (expected.device_key_fp && attendeeDeviceFp && !knownKeys.has(attendeeDeviceFp)) {
        status = "conflict";
      }
    }
  }
  await env.DB.prepare(
    "INSERT INTO org_checkins (id,org_id,mode,attendee_label,attendee_key_id,hello_hash,score,bio_verified,gps_hash,checkin_at,created_at,name,attendee_pub_jwk,device_key_fp,status,expected_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(id, org.id, mode, label, attendeeKeyId, helloHash||null, score||null, bioVerified?1:0, gpsHash, t, t, displayName, attendeePubJwk, attendeeDeviceFp, status, expectedId).run();
  if (status === "conflict" && expected) {
    const conflict = await env.DB.prepare(
      "INSERT INTO attendee_conflicts (org_code,expected_id,checkin_id,bound_device_fp,claiming_device_fp,claimed_name,created_at) VALUES (?,?,?,?,?,?,?) RETURNING id"
    ).bind(org.id, expected.id, id, expected.device_key_fp, attendeeDeviceFp, displayName, t).first();
    conflictId = conflict?.id || null;
    await env.DB.prepare("UPDATE org_checkins SET conflict_id=? WHERE id=? AND org_id=?").bind(conflictId, id, org.id).run();
    link = { linked: false, conflict: true, expected_id: expected.id, conflict_id: conflictId };
  } else if (expected) {
      await env.DB.prepare(
        "UPDATE org_expected SET status='linked', linked_at=COALESCE(linked_at,?), device_key_fp=COALESCE(device_key_fp,?) WHERE id=? AND org_code=?"
      ).bind(t, attendeeDeviceFp, expected.id, org.id).run();
      link = { linked: true, expected_id: expected.id, expected_name: `${expected.first_name} ${expected.surname}`.trim() };
  }
  return json({ checkin_id: id, checkin_at: t, org_name: org.name, settings, ...link });
}

async function orgCheckout(request, env) {
  const org = await orgAuth(request, env); if (org.error) return org;
  let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
  const url = new URL(request.url);
  const legacyCheckout = url.searchParams.get("checkout_method") === "legacy";
  const { checkin_id, attendee_key_id, checkout_payload, signature } = body;
  if (!checkin_id && !attendee_key_id) return err("checkin_id or attendee_key_id required");
  const row = checkin_id
    ? await env.DB.prepare("SELECT * FROM org_checkins WHERE id=? AND org_id=?").bind(checkin_id, org.id).first()
    : await env.DB.prepare("SELECT * FROM org_checkins WHERE attendee_key_id=? AND org_id=? AND checkout_at IS NULL ORDER BY checkin_at DESC LIMIT 1").bind(attendee_key_id, org.id).first();
  if (!row) return err("Check-in record not found", 404);
  if (row.checkout_at) return err("Already checked out");
  const t = now();
  const duration = t - row.checkin_at;
  if (legacyCheckout) {
    await env.DB.prepare("UPDATE org_checkins SET checkout_at=?, duration_s=?, checkout_ts=?, checkout_method=? WHERE id=?")
      .bind(t, duration, t, "legacy_button", row.id).run();
    return json({ ok: true, checkin_id: row.id, checkout_at: t, duration_s: duration, checkout_method: "legacy_button" });
  }
  if (!checkout_payload || !signature) return err("checkout_payload and signature required", 400);
  if (checkout_payload.checkin_id !== row.id) return err("checkout payload checkin_id mismatch", 400);
  if (!checkout_payload.nonce) return err("checkout payload nonce required", 400);
  if (!row.attendee_pub_jwk) return err("missing_attendee_public_key", 409);
  const pub = JSON.parse(row.attendee_pub_jwk);
  const payloadHash = await sha256B64url(canonical(checkout_payload));
  const valid = await verifySig(payloadHash, signature, pub);
  if (!valid) return err("invalid_checkout_signature", 401);
  await env.DB.prepare(
    "UPDATE org_checkins SET checkout_at=?, duration_s=?, checkout_ts=?, checkout_payload_hash=?, checkout_signature=?, checkout_method=? WHERE id=?"
  ).bind(t, duration, t, payloadHash, signature, "signed", row.id).run();
  return json({ ok: true, checkin_id: row.id, checkout_at: t, duration_s: duration, checkout_method: "signed" });
}

async function orgCreateCheckoutToken(request, env) {
  const org = await orgAuth(request, env); if (org.error) return org;
  let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
  const checkinId = String(body.checkin_id || "").trim();
  if (!checkinId) return err("checkin_id required");

  const checkin = await env.DB.prepare(
    "SELECT id, checkout_at FROM org_checkins WHERE id=? AND org_id=?"
  ).bind(checkinId, org.id).first();
  if (!checkin) return err("Check-in record not found", 404);
  if (checkin.checkout_at) return err("Already checked out", 409);

  const t = now();
  await env.DB.prepare(
    "UPDATE org_checkout_tokens SET consumed_at=? WHERE org_api_key=? AND checkin_id=? AND consumed_at IS NULL AND expires_at>?"
  ).bind(t, org.api_key, checkinId, t).run();

  const token = "chk_" + randomToken();
  const expiresAt = t + 5 * 60;
  await env.DB.prepare(
    "INSERT INTO org_checkout_tokens (token,checkin_id,org_api_key,created_at,expires_at,consumed_at) VALUES (?,?,?,?,?,NULL)"
  ).bind(token, checkinId, org.api_key, t, expiresAt).run();

  return json({ token, expires_at: expiresAt });
}

async function orgResolveCheckoutToken(request, env, tokenParam) {
  const token = String(tokenParam || "").trim();
  if (!token) return err("Checkout token not found", 404);

  const row = await env.DB.prepare(
    "SELECT token,checkin_id,org_api_key,expires_at,consumed_at FROM org_checkout_tokens WHERE token=?"
  ).bind(token).first();
  if (!row || row.consumed_at) return err("Checkout token not found", 404);

  const t = now();
  if (Number(row.expires_at) <= t) {
    return err("Checkout token expired", 410);
  }

  const org = await env.DB.prepare(
    "SELECT name,settings_json FROM organisations WHERE api_key=?"
  ).bind(row.org_api_key).first();
  if (!org) return err("Checkout token not found", 404);

  const checkin = await env.DB.prepare(
    "SELECT id, checkout_at FROM org_checkins WHERE id=?"
  ).bind(row.checkin_id).first();
  if (!checkin || checkin.checkout_at) return err("Checkout token not found", 404);

  await env.DB.prepare(
    "UPDATE org_checkout_tokens SET consumed_at=? WHERE token=? AND consumed_at IS NULL"
  ).bind(t, token).run();

  const settings = JSON.parse(org.settings_json || "{}");
  return json({
    org_api_key: row.org_api_key,
    checkin_id: row.checkin_id,
    nonce: row.token,
    event: org.name || "IRLid Event",
    logo: settings.logoUrl || ""
  });
}

async function orgAttendance(request, env) {
  const org = await orgAuth(request, env); if (org.error) return org;
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
  const since = url.searchParams.get("since") ? parseInt(url.searchParams.get("since")) : (now() - 86400);
  const rows = await env.DB.prepare(
    "SELECT id,mode,attendee_label,attendee_key_id,hello_hash,score,bio_verified,gps_hash,checkin_at,checkout_at,duration_s,name,device_key_fp,status,expected_id,conflict_id,CASE WHEN checkout_at IS NOT NULL AND checkout_signature IS NOT NULL THEN 'signed' WHEN checkout_at IS NOT NULL THEN 'legacy_button' ELSE checkout_method END AS checkout_method,checkout_ts FROM org_checkins WHERE org_id=? AND checkin_at>=? ORDER BY checkin_at DESC LIMIT ?"
  ).bind(org.id, since, limit).all();
  const total_in = rows.results.filter(r => !r.checkout_at && r.status !== "invalid").length;
  const total_out = rows.results.filter(r => r.checkout_at && r.status !== "invalid").length;
  const avg_score = rows.results.length ? Math.round(rows.results.reduce((s,r) => s+(r.score||0), 0) / rows.results.length) : 0;
  const bio_count = rows.results.filter(r => r.bio_verified).length;
  return json({ checkins: rows.results, stats: { total: rows.results.length, currently_in: total_in, checked_out: total_out, avg_score, bio_verified: bio_count } });
}

function isDebugOrg(org) {
  const key = String(org.api_key || "");
  const slug = String(org.slug || "").toLowerCase();
  return key === "org_DEV_IRLID_TEST_ENVIRONMENT" || key.startsWith("org_DEV_") || slug === "dev" || slug.startsWith("codex-");
}

async function tableExists(env, tableName) {
  const row = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).bind(tableName).first();
  return !!row;
}

async function orgDebugClearAttendance(request, env) {
  const org = await orgAuth(request, env); if (org.error) return org;
  // Batch C polish 9 — Captain's call: clear-attendance should be available to
  // Developer (any org, for ops + bake-off testing) and Lead Admin (their own
  // org, for legitimate dataset reset). The legacy isDebugOrg key/slug match
  // remains as a third allow path so existing DEV orgs keep working without
  // requiring a session token. If a Bearer session is present, validate it and
  // check for Developer or org-scoped lead_admin membership.
  let allowed = isDebugOrg(org);
  if (!allowed) {
    const auth = request.headers.get("Authorization") || "";
    const m = /^Bearer\s+([A-Za-z0-9_-]{16,})$/.exec(auth.trim());
    if (m) {
      const ctx = await requireSession(request, env);
      if (!ctx.error) {
        const user = ctx.user;
        const bootstrapFp = (env.BOOTSTRAP_DEVELOPER_FP || "").trim();
        if (bootstrapFp && user.pub_fp === bootstrapFp) {
          allowed = true; // Developer — clear any org
        } else {
          // Lead Admin / Developer membership of the requested org.
          const membership = await env.DB.prepare(
            "SELECT role FROM org_memberships WHERE user_id = ? AND org_id = ?"
          ).bind(user.id, org.id).first();
          if (membership && (membership.role === "lead_admin" || membership.role === "developer")) {
            allowed = true;
          }
        }
      }
    }
  }
  if (!allowed) return err("Clear attendance requires Developer or Lead Admin role", 403);

  let body; try { body = await request.json(); } catch { body = {}; }
  const includeExpected = !!body.include_expected;

  const checkins = await env.DB.prepare("DELETE FROM org_checkins WHERE org_id=?").bind(org.id).run();
  const conflicts = await env.DB.prepare("DELETE FROM attendee_conflicts WHERE org_code=?").bind(org.id).run();
  let checkoutTokensCleared = 0;
  if (await tableExists(env, "org_checkout_tokens")) {
    const tokens = await env.DB.prepare("DELETE FROM org_checkout_tokens WHERE org_api_key=?").bind(org.api_key).run();
    checkoutTokensCleared = tokens.meta?.changes || 0;
  }

  let expectedCleared = 0;
  if (includeExpected) {
    const expectedIds = await env.DB.prepare("SELECT id FROM org_expected WHERE org_code=?").bind(org.id).all();
    const ids = (expectedIds.results || []).map(r => r.id);
    if (ids.length && await tableExists(env, "rebind_history")) {
      for (const id of ids) {
        await env.DB.prepare("DELETE FROM rebind_history WHERE org_code=? AND expected_id=?").bind(org.id, id).run();
      }
    }
    const expected = await env.DB.prepare("DELETE FROM org_expected WHERE org_code=?").bind(org.id).run();
    expectedCleared = expected.meta?.changes || 0;
  }

  return json({
    ok: true,
    org_key: org.api_key,
    cleared: {
      checkins: checkins.meta?.changes || 0,
      conflicts: conflicts.meta?.changes || 0,
      checkout_tokens: checkoutTokensCleared,
      expected_attendees: expectedCleared
    }
  });
}

async function orgExpectedList(request, env) {
  const org = await orgAuth(request, env); if (org.error) return org;
  const rows = await env.DB.prepare(
    "SELECT id,org_code,first_name,surname,status,created_at,linked_at,device_key_fp,COALESCE(prototype_role,'attendee') AS prototype_role FROM org_expected WHERE org_code=? ORDER BY LOWER(surname) ASC, LOWER(first_name) ASC, id ASC"
  ).bind(org.id).all();
  return json({ expected: rows.results });
}

async function orgExpectedCreate(request, env) {
  const org = await orgAuth(request, env); if (org.error) return org;
  let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
  const firstName = (body.first_name || "").trim();
  const surname = (body.surname || "").trim();
  const prototypeRole = expectedMemberRole(body.prototype_role || body.role);
  if (!firstName || !surname) return err("first_name and surname required");
  if (!isExpectedRoleAllowedFromDashboard(prototypeRole)) {
    return err("developer role cannot be granted from the dashboard - bootstrap or invite token only", 403);
  }
  const existing = await env.DB.prepare(
    "SELECT id FROM org_expected WHERE org_code=? AND LOWER(first_name)=LOWER(?) AND LOWER(surname)=LOWER(?) LIMIT 1"
  ).bind(org.id, firstName, surname).first();
  if (existing) return json({ error: "duplicate", existing_id: existing.id }, 409);
  const createdAt = now();
  const row = await env.DB.prepare(
    "INSERT INTO org_expected (org_code,first_name,surname,status,created_at,prototype_role) VALUES (?,?,?,?,?,?) RETURNING id,org_code,first_name,surname,status,created_at,linked_at,device_key_fp,COALESCE(prototype_role,'attendee') AS prototype_role"
  ).bind(org.id, firstName, surname, "assist", createdAt, prototypeRole).first();
  return json({ expected: row });
}

function validDevicePubJwk(pubJwk) {
  return !!pubJwk
    && pubJwk.kty === "EC"
    && pubJwk.crv === "P-256"
    && typeof pubJwk.x === "string"
    && typeof pubJwk.y === "string";
}

function doorRolePermitted(actorRole, targetRole) {
  const actor = expectedMemberRole(actorRole);
  const target = expectedMemberRole(targetRole);
  if (actor === "developer") return true;
  if (target === "developer") return false;
  return expectedRoleRank(actor) >= expectedRoleRank(target);
}

async function expectedBoundToDevice(env, orgCode, deviceFp) {
  const direct = await env.DB.prepare(
    "SELECT id FROM org_expected WHERE org_code=? AND device_key_fp=? LIMIT 1"
  ).bind(orgCode, deviceFp).first();
  if (direct) return direct.id;
  if (await tableExists(env, "rebind_history")) {
    const historical = await env.DB.prepare(
      "SELECT expected_id AS id FROM rebind_history WHERE org_code=? AND new_device_fp=? ORDER BY created_at DESC, id DESC LIMIT 1"
    ).bind(orgCode, deviceFp).first();
    if (historical) return historical.id;
  }
  return null;
}

async function bindAdditionalExpectedKey(request, env, id) {
  const org = await orgAuth(request, env); if (org.error) return org;
  let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
  const staffError = await requireDevOrStaffSession(request, env, org, body.staff_session || body.staffSession);
  if (staffError) return staffError;

  const pubJwk = body.pub_jwk || body.pub || body.device_pub_jwk;
  if (!validDevicePubJwk(pubJwk)) return err("pub_jwk must be a P-256 public JWK");
  const pubFp = String(body.pub_fp || body.device_pub_fp || "").trim();
  const computedFp = await deviceKeyFp(pubJwk);
  if (!pubFp) return err("pub_fp required");
  if (pubFp !== computedFp) return err("pub_fp does not match pub_jwk", 422);

  const expected = await expectedRowWithKeys(env, org.id, id);
  if (!expected) return err("Expected attendee not found", 404);
  if ((expected.device_key_fps || []).includes(pubFp)) {
    return json({ ok: true, already_bound: true, expected });
  }
  const boundExpectedId = await expectedBoundToDevice(env, org.id, pubFp);
  if (boundExpectedId && Number(boundExpectedId) !== Number(id)) {
    return json({ error: "device_key_already_bound", expected_id: boundExpectedId }, 409);
  }

  const t = now();
  if (!expected.device_key_fp) {
    await env.DB.prepare(
      "UPDATE org_expected SET device_key_fp=?, status='linked', linked_at=COALESCE(linked_at,?) WHERE id=? AND org_code=?"
    ).bind(pubFp, t, id, org.id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO rebind_history (org_code,expected_id,old_device_fp,new_device_fp,admin_signature,reason,created_at) VALUES (?,?,?,?,?,?,?)"
    ).bind(org.id, id, expected.device_key_fp, pubFp, `bind-additional:${org.id}:${t}`, "doorman_choose_from_list", t).run();
    await env.DB.prepare(
      "UPDATE org_expected SET status='linked', linked_at=COALESCE(linked_at,?) WHERE id=? AND org_code=?"
    ).bind(t, id, org.id).run();
  }

  return json({ ok: true, expected: await expectedRowWithKeys(env, org.id, id) });
}

async function orgExpectedCreateAndBind(request, env) {
  const org = await orgAuth(request, env); if (org.error) return org;
  const proof = await requireFreshStaffProof(request, env, org);
  if (proof.error) return proof.error;

  let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
  const firstName = (body.first_name || "").trim();
  const surname = (body.surname || "").trim();
  const prototypeRole = expectedMemberRole(body.prototype_role || body.role);
  const pubJwk = body.device_pub_jwk || body.pub_jwk || body.pub;
  const suppliedFp = String(body.device_pub_fp || body.pub_fp || "").trim();
  if (!firstName || !surname) return err("first_name and surname required");
  if (!validDevicePubJwk(pubJwk)) return err("device_pub_jwk must be a P-256 public JWK");
  const computedFp = await deviceKeyFp(pubJwk);
  if (suppliedFp && suppliedFp !== computedFp) return err("device_pub_fp does not match device_pub_jwk", 422);
  const deviceFp = suppliedFp || computedFp;

  if (!doorRolePermitted(proof.role, prototypeRole)) {
    return json({ error: "role_not_permitted_at_door" }, 403);
  }
  const boundExpectedId = await expectedBoundToDevice(env, org.id, deviceFp);
  if (boundExpectedId) return json({ error: "device_key_already_bound", expected_id: boundExpectedId }, 409);
  const existing = await env.DB.prepare(
    "SELECT id FROM org_expected WHERE org_code=? AND LOWER(first_name)=LOWER(?) AND LOWER(surname)=LOWER(?) LIMIT 1"
  ).bind(org.id, firstName, surname).first();
  if (existing) return json({ error: "duplicate", existing_id: existing.id }, 409);

  const t = now();
  const expected = await env.DB.prepare(
    `INSERT INTO org_expected (org_code,first_name,surname,status,created_at,linked_at,device_key_fp,prototype_role) VALUES (?,?,?,?,?,?,?,?) RETURNING ${EXPECTED_SELECT}`
  ).bind(org.id, firstName, surname, "linked", t, t, deviceFp, prototypeRole).first();
  expected.device_key_fps = [deviceFp];

  let member = null;
  if (prototypeRole !== "attendee") {
    let user = await env.DB.prepare("SELECT id FROM portal_users WHERE pub_fp=?").bind(deviceFp).first();
    if (!user) {
      const userId = uuid();
      await env.DB.prepare(
        "INSERT INTO portal_users (id,pub_jwk,pub_fp,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)"
      ).bind(userId, JSON.stringify(pubJwk), deviceFp, `${firstName} ${surname}`.trim(), t, t).run();
      user = { id: userId };
    }
    await env.DB.prepare(
      "INSERT OR REPLACE INTO org_memberships (user_id,org_id,role,granted_by,granted_at) VALUES (?,?,?,?,?)"
    ).bind(user.id, org.id, prototypeRole, proof.user?.id || proof.staff_pub_fp || null, t).run();
    member = { user_id: user.id, org_id: org.id, role: prototypeRole, granted_at: t };
  }

  return json({ ok: true, expected, ...(member ? { member } : {}) });
}

async function orgExpectedDelete(request, env, id) {
  const org = await orgAuth(request, env); if (org.error) return org;
  const result = await env.DB.prepare(
    "DELETE FROM org_expected WHERE id=? AND org_code=?"
  ).bind(id, org.id).run();
  const deleted = (result.meta?.changes || 0) > 0;
  if (!deleted) return err("Expected attendee not found", 404);
  return json({ deleted: true, id });
}

// v5.7.0g — Cascading delete for an attendee record. Removes the
// org_checkins history rows, rebind_history, attendee_conflicts, AND the
// org_expected row itself. Use this when the attendee has moved past the
// "expected" state (e.g. checked in/out, conflict, invalid) and the
// regular orgExpectedDelete is no longer reachable from the UI.
//
// Refuses to delete a row with an active (un-checked-out) checkin —
// staff must check the attendee out cleanly first. This guard exists so
// the audit trail of live attendees can't be silently hand-wiped; if
// ever needed, lead_admin+ can pass ?force=true to override (audit ts
// of the delete preserved via the row's natural absence after cascade).
async function orgExpectedDeleteFull(request, env, id) {
  const org = await orgAuth(request, env); if (org.error) return org;

  // Confirm the row exists for this org before any cascade work.
  const expected = await env.DB.prepare(
    "SELECT id FROM org_expected WHERE id=? AND org_code=?"
  ).bind(id, org.id).first();
  if (!expected) return err("Expected attendee not found", 404);

  // Check for an active (un-checked-out) checkin tied to this expected_id.
  // Skip the guard if the caller explicitly opts in via ?force=true.
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";
  if (!force) {
    const liveCheckin = await env.DB.prepare(
      "SELECT id FROM org_checkins WHERE org_id=? AND expected_id=? AND checkout_at IS NULL LIMIT 1"
    ).bind(org.id, id).first();
    if (liveCheckin) {
      return err("Attendee has an active check-in. Check them out first, or pass force=true to delete anyway.", 409);
    }
  }

  // Cascade: checkins → rebind_history → attendee_conflicts → expected row.
  // Each step is independent; partial failure leaves the database in a
  // legible state (older rows persist, the org_expected row goes last so
  // the cascade is idempotent on retry).
  const checkinsResult = await env.DB.prepare(
    "DELETE FROM org_checkins WHERE org_id=? AND expected_id=?"
  ).bind(org.id, id).run();
  await env.DB.prepare(
    "DELETE FROM rebind_history WHERE org_code=? AND expected_id=?"
  ).bind(org.id, id).run();
  await env.DB.prepare(
    "DELETE FROM attendee_conflicts WHERE org_code=? AND expected_id=?"
  ).bind(org.id, id).run();
  const expectedResult = await env.DB.prepare(
    "DELETE FROM org_expected WHERE id=? AND org_code=?"
  ).bind(id, org.id).run();

  return json({
    deleted: true,
    id,
    cascade: {
      checkins: checkinsResult.meta?.changes || 0,
      expected: expectedResult.meta?.changes || 0
    }
  });
}

async function orgExpectedUpdate(request, env, id) {
  const org = await orgAuth(request, env); if (org.error) return org;
  let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
  const firstName = (body.first_name || "").trim();
  const surname = (body.surname || "").trim();
  const roleProvided = body.prototype_role !== undefined || body.role !== undefined;
  const prototypeRole = roleProvided ? expectedMemberRole(body.prototype_role || body.role) : null;
  if (!firstName || !surname) return err("first_name and surname required");
  if (roleProvided && !isExpectedRoleAllowedFromDashboard(prototypeRole)) {
    return err("developer role cannot be granted from the dashboard - bootstrap or invite token only", 403);
  }
  const existing = await env.DB.prepare(
    "SELECT id FROM org_expected WHERE org_code=? AND id<>? AND LOWER(first_name)=LOWER(?) AND LOWER(surname)=LOWER(?) LIMIT 1"
  ).bind(org.id, id, firstName, surname).first();
  if (existing) return json({ error: "duplicate", existing_id: existing.id }, 409);
  const row = roleProvided
    ? await env.DB.prepare(
      "UPDATE org_expected SET first_name=?, surname=?, prototype_role=? WHERE id=? AND org_code=? RETURNING id,org_code,first_name,surname,status,created_at,linked_at,device_key_fp,COALESCE(prototype_role,'attendee') AS prototype_role"
    ).bind(firstName, surname, prototypeRole, id, org.id).first()
    : await env.DB.prepare(
      "UPDATE org_expected SET first_name=?, surname=? WHERE id=? AND org_code=? RETURNING id,org_code,first_name,surname,status,created_at,linked_at,device_key_fp,COALESCE(prototype_role,'attendee') AS prototype_role"
    ).bind(firstName, surname, id, org.id).first();
  if (!row) return err("Expected attendee not found", 404);
  return json({ expected: row });
}

async function orgExpectedRebind(request, env, id) {
  const org = await orgAuth(request, env); if (org.error) return org;
  let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
  const newDeviceFp = (body.new_device_fp || "").trim();
  const reason = body.reason ? String(body.reason).trim() : null;
  if (!newDeviceFp) return err("new_device_fp required");

  const expected = await env.DB.prepare(
    "SELECT id,device_key_fp FROM org_expected WHERE id=? AND org_code=?"
  ).bind(id, org.id).first();
  if (!expected) return err("Expected attendee not found", 404);

  const t = now();
  const date = new Date(t * 1000);
  const monthStart = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000);
  const nextMonthStart = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000);
  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM rebind_history WHERE org_code=? AND expected_id=? AND created_at>=? AND created_at<?"
  ).bind(org.id, id, monthStart, nextMonthStart).first();
  if ((countRow?.cnt || 0) >= 2) {
    return json({ error: "rebind_limit_exceeded", retry_after: nextMonthStart }, 429);
  }

  const rebind = await env.DB.prepare(
    "INSERT INTO rebind_history (org_code,expected_id,old_device_fp,new_device_fp,admin_signature,reason,created_at) VALUES (?,?,?,?,?,?,?) RETURNING id"
  ).bind(org.id, id, expected.device_key_fp || null, newDeviceFp, `${org.id}:${t}`, reason || null, t).first();

  await env.DB.prepare(
    "UPDATE org_expected SET device_key_fp=?, status='linked', linked_at=COALESCE(linked_at,?) WHERE id=? AND org_code=?"
  ).bind(newDeviceFp, t, id, org.id).run();

  return json({ ok: true, rebind_id: rebind?.id || null });
}

async function orgExpectedClaim(request, env, id) {
  const org = await orgAuth(request, env); if (org.error) return org;
  let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
  const devicePubFp = (body.device_pub_fp || "").trim();
  if (!devicePubFp) return err("device_pub_fp required");

  const expected = await env.DB.prepare(
    "SELECT id,org_code,first_name,surname,status,created_at,linked_at,device_key_fp,COALESCE(prototype_role,'attendee') AS prototype_role FROM org_expected WHERE id=? AND org_code=?"
  ).bind(id, org.id).first();
  if (!expected) return err("Expected attendee not found", 404);

  if (expected.device_key_fp && expected.device_key_fp !== devicePubFp) {
    return json({ error: "already_claimed", existing_fp_short: expected.device_key_fp.slice(0, 8) }, 409);
  }

  if (expected.device_key_fp === devicePubFp) {
    return json({ ok: true, expected });
  }

  const t = now();
  const row = await env.DB.prepare(
    "UPDATE org_expected SET device_key_fp=?, status='linked', linked_at=COALESCE(linked_at,?) WHERE id=? AND org_code=? RETURNING id,org_code,first_name,surname,status,created_at,linked_at,device_key_fp,COALESCE(prototype_role,'attendee') AS prototype_role"
  ).bind(devicePubFp, t, id, org.id).first();
  return json({ ok: true, expected: row });
}

async function orgResolveConflict(request, env, id) {
  const org = await orgAuth(request, env); if (org.error) return org;
  let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
  const resolution = body.resolution;
  if (!["confirmed_new_device", "rejected"].includes(resolution)) return err("resolution must be confirmed_new_device or rejected");
  const conflict = await env.DB.prepare(
    "SELECT * FROM attendee_conflicts WHERE id=? AND org_code=? AND resolution IS NULL"
  ).bind(id, org.id).first();
  if (!conflict) return err("Conflict not found", 404);
  const t = now();
  if (resolution === "confirmed_new_device") {
    await env.DB.batch([
      env.DB.prepare("UPDATE org_expected SET status='linked', device_key_fp=?, linked_at=COALESCE(linked_at,?) WHERE id=? AND org_code=?")
        .bind(conflict.claiming_device_fp, t, conflict.expected_id, org.id),
      env.DB.prepare("UPDATE org_checkins SET status='checked_in' WHERE id=? AND org_id=?")
        .bind(conflict.checkin_id, org.id),
      env.DB.prepare("UPDATE attendee_conflicts SET resolution=?, resolved_at=? WHERE id=? AND org_code=?")
        .bind(resolution, t, id, org.id)
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare("UPDATE org_checkins SET status='invalid', checkout_at=COALESCE(checkout_at,?), duration_s=COALESCE(duration_s,0) WHERE id=? AND org_id=?")
        .bind(t, conflict.checkin_id, org.id),
      env.DB.prepare("UPDATE attendee_conflicts SET resolution=?, resolved_at=? WHERE id=? AND org_code=?")
        .bind(resolution, t, id, org.id)
    ]);
  }
  return json({ ok: true, conflict_id: id, resolution });
}

async function orgAuth(request, env) {
  const key = request.headers.get("X-Org-Key") || new URL(request.url).searchParams.get("key");
  if (!key) return authErr("X-Org-Key header required", 401);
  const org = await env.DB.prepare("SELECT * FROM organisations WHERE api_key=?").bind(key).first();
  if (!org) return authErr("Invalid API key", 401);
  return org;
}

// =====================
//  ROUTER
// =====================

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return addCors(new Response(null, { status: 204 }), env, request);

    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    let response;
    try {
      if (path === "/" || path === "/health") response = json({ status: "ok", service: "irlid-api", version: 7 });

      else if (method === "POST" && path === "/auth/register")       response = await register(request, env);
      else if (method === "POST" && path === "/auth/login")          response = await login(request, env);
      else if (method === "POST" && path === "/auth/logout")         response = await logout(request, env);
      else if (method === "GET"  && path === "/auth/me")              response = await me(request, env);
      else if (method === "POST" && path === "/auth/profile")        response = await updateProfile(request, env);
      else if (method === "POST" && path === "/auth/google")         response = await googleAuth(request, env);

      else if (method === "POST" && path === "/auth/link/create")    response = await linkCreate(request, env);
      else if (method === "POST" && path === "/auth/link/claim")     response = await linkClaim(request, env);

      else if (method === "POST" && path === "/auth/device/rename")  response = await renameDevice(request, env);
      else if (method === "POST" && path === "/auth/device/revoke")  response = await revokeDevice(request, env);

      else if (method === "POST" && path === "/receipts")            response = await uploadReceipt(request, env);
      else if (method === "GET"  && path === "/receipts")             response = await listReceipts(request, env);
      else if (method === "POST" && path === "/verify")              response = await verify(request, env);
      else if (method === "GET"  && path === "/util/image-proxy")     response = await utilImageProxy(request, env);

      // Org Portal — Identity-Bound Sessions (PROTOCOL.md §14, Batch A)
      else if (method === "POST" && path === "/org/login/init")      response = await orgLoginInit(request, env);
      else if (method === "GET"  && path === "/org/login/poll")      response = await orgLoginPoll(request, env);
      else if (method === "POST" && path === "/org/login/claim")     response = await orgLoginClaim(request, env);
      // User-level endpoints (PROTOCOL.md §14, Batch C) — Bearer session token auth.
      else if (method === "GET"  && path === "/user/orgs")           response = await userListOrgs(request, env);
      else if (method === "POST" && path === "/user/create-org")     response = await userCreateOrg(request, env);
      else if (method === "POST" && /^\/user\/orgs\/[^/]+\/scrape-theme$/.test(path)) {
        const mScrapeTheme = path.match(/^\/user\/orgs\/([^/]+)\/scrape-theme$/);
        response = await userScrapeTheme(request, env, decodeURIComponent(mScrapeTheme[1]));
      }

      // Org Portal
      else if (method === "POST" && path === "/org/register")        response = await orgRegister(request, env);
      else if (method === "GET"  && path === "/org/settings")        response = await orgGetSettings(request, env);
      else if (method === "POST" && path === "/org/settings")        response = await orgUpdateSettings(request, env);
      else if (method === "GET"  && path === "/org/qr")              response = await orgGetQR(request, env);
      else if (method === "GET"  && path === "/org/recognize")       response = await orgRecognize(request, env);
      else if (method === "GET"  && path === "/org/active-checkin")  response = await orgActiveCheckin(request, env);
      else if (method === "POST" && path === "/org/staff/auth")      response = await orgStaffAuth(request, env);
      else if (method === "POST" && path === "/org/checkin")         response = await orgCheckin(request, env);
      else if (method === "POST" && path === "/org/checkout")        response = await orgCheckout(request, env);
      else if (method === "POST" && path === "/org/checkout-token")  response = await orgCreateCheckoutToken(request, env);
      else if (method === "GET"  && path === "/org/attendance")      response = await orgAttendance(request, env);
      else if (method === "POST" && path === "/org/debug/clear-attendance") response = await orgDebugClearAttendance(request, env);
      else if (method === "GET"  && path === "/org/expected")        response = await orgExpectedList(request, env);
      else if (method === "POST" && path === "/org/expected")        response = await orgExpectedCreate(request, env);
      else if (method === "POST" && path === "/org/expected/create-and-bind") response = await orgExpectedCreateAndBind(request, env);

      else {
        const mExpected = path.match(/^\/org\/expected\/(\d+)$/);
        const mExpectedFull = path.match(/^\/org\/expected\/(\d+)\/full$/);
        const mExpectedRebind = path.match(/^\/org\/expected\/(\d+)\/rebind$/);
        const mExpectedBindAdditional = path.match(/^\/org\/expected\/(\d+)\/bind-additional-key$/);
        const mExpectedClaim = path.match(/^\/org\/expected\/(\d+)\/claim$/);
        const mExpectedLookupByFp = path.match(/^\/org\/expected\/lookup-by-fp\/([^/]+)$/);
        const mConflict = path.match(/^\/org\/conflicts\/(\d+)\/resolve$/);
        const mCheckoutToken = path.match(/^\/org\/checkout-token\/([^/]+)$/);
        if (method === "DELETE" && mExpected) response = await orgExpectedDelete(request, env, Number(mExpected[1]));
        else if (method === "DELETE" && mExpectedFull) response = await orgExpectedDeleteFull(request, env, Number(mExpectedFull[1]));
        else if (method === "PATCH" && mExpected) response = await orgExpectedUpdate(request, env, Number(mExpected[1]));
        else if (method === "POST" && mExpectedRebind) response = await orgExpectedRebind(request, env, Number(mExpectedRebind[1]));
        else if (method === "POST" && mExpectedBindAdditional) response = await bindAdditionalExpectedKey(request, env, Number(mExpectedBindAdditional[1]));
        else if (method === "POST" && mExpectedClaim) response = await orgExpectedClaim(request, env, Number(mExpectedClaim[1]));
        else if (method === "GET" && mExpectedLookupByFp) response = await orgExpectedLookupByFp(request, env, decodeURIComponent(mExpectedLookupByFp[1]));
        else if (method === "POST" && mConflict) response = await orgResolveConflict(request, env, Number(mConflict[1]));
        else if (method === "GET" && mCheckoutToken) response = await orgResolveCheckoutToken(request, env, decodeURIComponent(mCheckoutToken[1]));
        else {
          const m = path.match(/^\/receipts\/([A-Za-z0-9\-_]+)$/);
          if (method === "GET" && m) response = await getReceipt(request, env, m[1]);
          else {
            const mKey = path.match(/^\/users\/by-key\/([A-Za-z0-9\-_]+)$/);
            if (method === "GET" && mKey) response = await lookupByKey(request, env, mKey[1]);
            else response = err("Not found", 404);
          }
        }
      }
    } catch (e) {
      console.error("Unhandled:", e);
      response = err("Internal error: " + (e.message || e), 500);
    }

    return addCors(response, env, request);
  }
};
