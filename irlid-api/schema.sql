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
