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

function canonical(obj) {
  const keys = Object.keys(obj).sort();
  const o = {};
  for (const k of keys) o[k] = obj[k];
  return JSON.stringify(o);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function err(message, status = 400) { return json({ error: message }, status); }

function randomToken() { return b64urlEncode(crypto.getRandomValues(new Uint8Array(32))); }

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
  const allowed = [
    env.CORS_ORIGIN || "https://irlid.co.uk",
    "http://localhost:3000", "http://localhost:8000",
    "http://127.0.0.1:3000", "http://127.0.0.1:8000"
  ];
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
  const allowed = ["minScore","distanceM","windowS","bioRequired","privacyMode","checkoutEnabled","anonymousMode"];
  const current = JSON.parse(org.settings_json || "{}");
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

async function orgCheckin(request, env) {
  const org = await orgAuth(request, env); if (org.error) return org;
  let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
  const { mode, helloPayload, helloHash, attendeeLabel, name, score, bioVerified, gps } = body;
  if (!mode || !["attendee_scan","doorman_scan"].includes(mode)) return err("mode must be attendee_scan or doorman_scan");
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
  const label = settings.anonymousMode ? null : (attendeeLabel || null);
  const displayName = settings.anonymousMode ? null : ((name || attendeeLabel || "").trim() || null);
  await env.DB.prepare(
    "INSERT INTO org_checkins (id,org_id,mode,attendee_label,attendee_key_id,hello_hash,score,bio_verified,gps_hash,checkin_at,created_at,name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(id, org.id, mode, label, attendeeKeyId, helloHash||null, score||null, bioVerified?1:0, gpsHash, t, t, displayName).run();
  let link = { linked: false };
  if (displayName) {
    const expected = await env.DB.prepare(
      "SELECT id,first_name,surname FROM org_expected WHERE org_code=? AND status='assist' AND LOWER(first_name || ' ' || surname)=LOWER(?) ORDER BY id ASC LIMIT 1"
    ).bind(org.id, displayName).first();
    if (expected) {
      await env.DB.prepare(
        "UPDATE org_expected SET status='linked', linked_at=? WHERE id=? AND org_code=? AND status='assist'"
      ).bind(t, expected.id, org.id).run();
      link = { linked: true, expected_id: expected.id, expected_name: `${expected.first_name} ${expected.surname}`.trim() };
    }
  }
  return json({ checkin_id: id, checkin_at: t, org_name: org.name, settings, ...link });
}

async function orgCheckout(request, env) {
  const org = await orgAuth(request, env); if (org.error) return org;
  let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
  const { checkin_id, attendee_key_id } = body;
  if (!checkin_id && !attendee_key_id) return err("checkin_id or attendee_key_id required");
  const row = checkin_id
    ? await env.DB.prepare("SELECT * FROM org_checkins WHERE id=? AND org_id=?").bind(checkin_id, org.id).first()
    : await env.DB.prepare("SELECT * FROM org_checkins WHERE attendee_key_id=? AND org_id=? AND checkout_at IS NULL ORDER BY checkin_at DESC LIMIT 1").bind(attendee_key_id, org.id).first();
  if (!row) return err("Check-in record not found", 404);
  if (row.checkout_at) return err("Already checked out");
  const t = now();
  const duration = t - row.checkin_at;
  await env.DB.prepare("UPDATE org_checkins SET checkout_at=?, duration_s=? WHERE id=?").bind(t, duration, row.id).run();
  return json({ checkin_id: row.id, checkout_at: t, duration_s: duration });
}

async function orgAttendance(request, env) {
  const org = await orgAuth(request, env); if (org.error) return org;
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
  const since = url.searchParams.get("since") ? parseInt(url.searchParams.get("since")) : (now() - 86400);
  const rows = await env.DB.prepare(
    "SELECT id,mode,attendee_label,attendee_key_id,hello_hash,score,bio_verified,gps_hash,checkin_at,checkout_at,duration_s,name FROM org_checkins WHERE org_id=? AND checkin_at>=? ORDER BY checkin_at DESC LIMIT ?"
  ).bind(org.id, since, limit).all();
  const total_in = rows.results.filter(r => !r.checkout_at).length;
  const total_out = rows.results.filter(r => r.checkout_at).length;
  const avg_score = rows.results.length ? Math.round(rows.results.reduce((s,r) => s+(r.score||0), 0) / rows.results.length) : 0;
  const bio_count = rows.results.filter(r => r.bio_verified).length;
  return json({ checkins: rows.results, stats: { total: rows.results.length, currently_in: total_in, checked_out: total_out, avg_score, bio_verified: bio_count } });
}

async function orgExpectedList(request, env) {
  const org = await orgAuth(request, env); if (org.error) return org;
  const rows = await env.DB.prepare(
    "SELECT id,org_code,first_name,surname,status,created_at,linked_at FROM org_expected WHERE org_code=? ORDER BY created_at DESC, id DESC"
  ).bind(org.id).all();
  return json({ expected: rows.results });
}

async function orgExpectedCreate(request, env) {
  const org = await orgAuth(request, env); if (org.error) return org;
  let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
  const firstName = (body.first_name || "").trim();
  const surname = (body.surname || "").trim();
  if (!firstName || !surname) return err("first_name and surname required");
  const createdAt = now();
  const row = await env.DB.prepare(
    "INSERT INTO org_expected (org_code,first_name,surname,status,created_at) VALUES (?,?,?,?,?) RETURNING id,org_code,first_name,surname,status,created_at,linked_at"
  ).bind(org.id, firstName, surname, "assist", createdAt).first();
  return json({ expected: row });
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

async function orgAuth(request, env) {
  const key = request.headers.get("X-Org-Key") || new URL(request.url).searchParams.get("key");
  if (!key) return err("X-Org-Key header required", 401);
  const org = await env.DB.prepare("SELECT * FROM organisations WHERE api_key=?").bind(key).first();
  if (!org) return err("Invalid API key", 401);
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

      // Org Portal
      else if (method === "POST" && path === "/org/register")        response = await orgRegister(request, env);
      else if (method === "GET"  && path === "/org/settings")        response = await orgGetSettings(request, env);
      else if (method === "POST" && path === "/org/settings")        response = await orgUpdateSettings(request, env);
      else if (method === "GET"  && path === "/org/qr")              response = await orgGetQR(request, env);
      else if (method === "POST" && path === "/org/checkin")         response = await orgCheckin(request, env);
      else if (method === "POST" && path === "/org/checkout")        response = await orgCheckout(request, env);
      else if (method === "GET"  && path === "/org/attendance")      response = await orgAttendance(request, env);
      else if (method === "GET"  && path === "/org/expected")        response = await orgExpectedList(request, env);
      else if (method === "POST" && path === "/org/expected")        response = await orgExpectedCreate(request, env);

      else {
        const mExpected = path.match(/^\/org\/expected\/(\d+)$/);
        if (method === "DELETE" && mExpected) response = await orgExpectedDelete(request, env, Number(mExpected[1]));
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
