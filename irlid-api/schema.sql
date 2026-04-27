-- IRLid D1 Schema (Deploy 112 + Org Portal)
-- Matches irlid-api/src/index.js v6 + org endpoints

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  display_name    TEXT,
  first_name      TEXT,
  middle_names    TEXT,
  surname         TEXT,
  email           TEXT,
  google_sub      TEXT,
  google_email    TEXT,
  google_name     TEXT,
  google_picture  TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  pub_key_id    TEXT NOT NULL UNIQUE,
  pub_jwk       TEXT NOT NULL,
  label         TEXT,
  created_at    INTEGER NOT NULL,
  revoked_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_pubkey ON devices(pub_key_id);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  device_id     TEXT NOT NULL REFERENCES devices(id),
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS receipts (
  id            TEXT PRIMARY KEY,
  uploader_id   TEXT REFERENCES users(id),
  receipt_hash  TEXT NOT NULL UNIQUE,
  pub_key_a     TEXT NOT NULL,
  pub_key_b     TEXT NOT NULL,
  ts_a          INTEGER,
  ts_b          INTEGER,
  receipt_json  TEXT NOT NULL,
  verified      INTEGER DEFAULT 0,
  created_at    INTEGER NOT NULL,
  party_info    TEXT
);
CREATE INDEX IF NOT EXISTS idx_receipts_uploader ON receipts(uploader_id);
CREATE INDEX IF NOT EXISTS idx_receipts_keys ON receipts(pub_key_a, pub_key_b);
CREATE INDEX IF NOT EXISTS idx_receipts_hash ON receipts(receipt_hash);

CREATE TABLE IF NOT EXISTS link_codes (
  code          TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  claimed       INTEGER DEFAULT 0
);

-- =====================
--  ORGANISATION PORTAL
-- =====================

CREATE TABLE IF NOT EXISTS organisations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  api_key       TEXT NOT NULL UNIQUE,
  venue_pub_jwk TEXT,                  -- persistent venue keypair for attendee-scan mode
  venue_prv_jwk TEXT,                  -- stored encrypted; used to sign QR
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_apikey ON organisations(api_key);
CREATE INDEX IF NOT EXISTS idx_org_slug ON organisations(slug);

-- Batch 13 Task 1 additive migration: short-lived staff HELLO auth sessions.
CREATE TABLE IF NOT EXISTS org_staff_sessions (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL REFERENCES organisations(id),
  staff_pub_fp       TEXT NOT NULL,
  staff_pub_jwk      TEXT NOT NULL,
  hello_hash         TEXT NOT NULL,
  verification_state TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  expires_at         INTEGER NOT NULL,
  last_seen_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_org ON org_staff_sessions(org_id, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_sessions_org_hello ON org_staff_sessions(org_id, hello_hash);

CREATE TABLE IF NOT EXISTS org_checkins (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organisations(id),
  mode            TEXT NOT NULL,       -- 'attendee_scan' | 'doorman_scan'
  attendee_label  TEXT,                -- display name if known
  attendee_key_id TEXT,                -- pub_key_id from HELLO
  hello_hash      TEXT,                -- SHA-256 of canonical HELLO payload
  score           INTEGER,             -- trust score 0-100
  bio_verified    INTEGER DEFAULT 0,   -- 1 if bioVerified:true in signed payload
  gps_hash        TEXT,                -- SHA-256(canonical(GPS)) — privacy mode
  checkin_at      INTEGER NOT NULL,
  checkout_at     INTEGER,             -- NULL until checkout
  duration_s      INTEGER,             -- populated on checkout
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkins_org ON org_checkins(org_id);
CREATE INDEX IF NOT EXISTS idx_checkins_at ON org_checkins(org_id, checkin_at);

-- Batch 2 additive migration: nullable attendee-provided display name.
-- Existing rows remain valid and keep name as NULL.
ALTER TABLE org_checkins ADD COLUMN name TEXT;

-- Batch 8 additive migration: signed attendee check-out proof.
-- Existing rows remain valid; legacy button check-outs can be marked explicitly by the Worker.
ALTER TABLE org_checkins ADD COLUMN attendee_pub_jwk TEXT;
ALTER TABLE org_checkins ADD COLUMN checkout_payload_hash TEXT;
ALTER TABLE org_checkins ADD COLUMN checkout_signature TEXT;
ALTER TABLE org_checkins ADD COLUMN checkout_ts INTEGER;
ALTER TABLE org_checkins ADD COLUMN checkout_method TEXT DEFAULT 'signed';
ALTER TABLE org_checkins ADD COLUMN device_key_fp TEXT;
ALTER TABLE org_checkins ADD COLUMN status TEXT DEFAULT 'checked_in';
ALTER TABLE org_checkins ADD COLUMN expected_id INTEGER;
ALTER TABLE org_checkins ADD COLUMN conflict_id INTEGER;

-- Batch 3 additive migration: org-managed expected attendees.
-- Purely additive; existing tables and rows are untouched.
CREATE TABLE IF NOT EXISTS org_expected (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code   TEXT NOT NULL,
  first_name TEXT NOT NULL,
  surname    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'assist',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_expected_org ON org_expected(org_code);

-- Batch 4 additive migration: first-seen timestamp when a new check-in links an expected attendee.
-- Existing expected rows stay untouched with linked_at as NULL.
ALTER TABLE org_expected ADD COLUMN linked_at INTEGER;
ALTER TABLE org_expected ADD COLUMN device_key_fp TEXT;

-- Batch 8 additive migration: name/device conflicts for expected attendees.
CREATE TABLE IF NOT EXISTS attendee_conflicts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code           TEXT NOT NULL,
  expected_id        INTEGER NOT NULL,
  checkin_id         TEXT,
  bound_device_fp    TEXT,
  claiming_device_fp TEXT NOT NULL,
  claimed_name       TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  resolution         TEXT DEFAULT NULL,
  resolved_at        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_attendee_conflicts_org ON attendee_conflicts(org_code, resolution);

-- Batch 10 additive migration: admin recovery fallback for expected attendee device rebinding.
CREATE TABLE IF NOT EXISTS rebind_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code        TEXT NOT NULL,
  expected_id     INTEGER NOT NULL,
  old_device_fp   TEXT,
  new_device_fp   TEXT NOT NULL,
  admin_signature TEXT,
  reason          TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rebind_history_expected_month ON rebind_history(org_code, expected_id, created_at);
