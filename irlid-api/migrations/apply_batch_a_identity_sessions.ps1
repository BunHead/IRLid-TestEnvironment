# Idempotent Batch A migration for the remote test D1 database.
# Implements PROTOCOL.md §14 — Identity-Bound Sessions storage model.
# Tables: users, org_memberships, login_sessions, login_challenges.
# Safe to re-run because all statements use IF NOT EXISTS.

$ErrorActionPreference = "Stop"

function Invoke-D1Command {
  param([Parameter(Mandatory=$true)][string]$Sql)
  wrangler d1 execute irlid-db-test --remote --command $Sql
}

# One row per human who can act in the Org Portal. pub_fp is the canonical
# identity fingerprint (SHA-256 of canonical(compactJwk(pub_jwk)), base64url,
# truncated to 16 chars to match the device_pub_fp pattern used elsewhere).
# NOTE: named portal_users (not users) because schema.sql already defines a
# users table for the live-IRLid Google-OAuth account system. These are
# distinct concepts during v5.5 and may be unified in a future protocol version.
Invoke-D1Command @"
CREATE TABLE IF NOT EXISTS portal_users (
  id           TEXT PRIMARY KEY,
  pub_jwk      TEXT NOT NULL,
  pub_fp       TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
"@
Invoke-D1Command "CREATE INDEX IF NOT EXISTS idx_portal_users_pub_fp ON portal_users(pub_fp);"

# Many-to-many: which users belong to which orgs, with what role.
# Roles per PROTOCOL.md §14.9: attendee, staff, manager, lead_admin, developer.
Invoke-D1Command @"
CREATE TABLE IF NOT EXISTS org_memberships (
  user_id    TEXT NOT NULL,
  org_id     TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('attendee','staff','manager','lead_admin','developer')),
  granted_by TEXT,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, org_id)
);
"@
Invoke-D1Command "CREATE INDEX IF NOT EXISTS idx_memberships_org ON org_memberships(org_id);"
Invoke-D1Command "CREATE INDEX IF NOT EXISTS idx_memberships_user ON org_memberships(user_id);"

# Short-lived session tokens issued after successful login.
# token: 32 random bytes base64url. 24h sliding TTL (refreshed on use).
Invoke-D1Command @"
CREATE TABLE IF NOT EXISTS login_sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  issued_at   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  ip_hash     TEXT,
  user_agent  TEXT
);
"@
Invoke-D1Command "CREATE INDEX IF NOT EXISTS idx_sessions_user ON login_sessions(user_id);"
Invoke-D1Command "CREATE INDEX IF NOT EXISTS idx_sessions_expires ON login_sessions(expires_at);"

# Pending login challenges (the QR-on-screen → phone-scans → desktop-polls flow).
# nonce: 16 random bytes base64url. 60s TTL.
# claimed_by: NULL until the phone successfully POSTs /org/login/claim.
# session_token: written when claim succeeds; the desktop's poll then returns it.
# consumed: 1 once the desktop has retrieved the session (single-use).
# fail_count: per-nonce failed-claim counter for rate limiting (§14.10).
Invoke-D1Command @"
CREATE TABLE IF NOT EXISTS login_challenges (
  nonce         TEXT PRIMARY KEY,
  issued_at     INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  claimed_by    TEXT,
  session_token TEXT,
  consumed      INTEGER NOT NULL DEFAULT 0,
  fail_count    INTEGER NOT NULL DEFAULT 0,
  locked_until  INTEGER NOT NULL DEFAULT 0
);
"@
Invoke-D1Command "CREATE INDEX IF NOT EXISTS idx_challenges_expires ON login_challenges(expires_at);"

Write-Host ""
Write-Host "Batch A schema migration complete." -ForegroundColor Green
Write-Host "Next step: set BOOTSTRAP_DEVELOPER_FP via:" -ForegroundColor Yellow
Write-Host '  wrangler secret put BOOTSTRAP_DEVELOPER_FP' -ForegroundColor Cyan
Write-Host "Paste your 16-char pub_fp when prompted." -ForegroundColor Yellow
