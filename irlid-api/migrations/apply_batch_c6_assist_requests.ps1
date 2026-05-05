$ErrorActionPreference = "Stop"

wrangler d1 execute irlid-db-test --remote --command @"
CREATE TABLE IF NOT EXISTS org_assist_requests (
  org_id        TEXT NOT NULL REFERENCES organisations(id),
  pub_fp        TEXT NOT NULL,
  nonce         TEXT NOT NULL,
  pub_jwk       TEXT,
  issued_at     INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  expected_id   INTEGER,
  expected_name TEXT,
  reason        TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (org_id, pub_fp, nonce)
);
CREATE INDEX IF NOT EXISTS idx_org_assist_requests_expiry ON org_assist_requests(org_id, expires_at);
"@
