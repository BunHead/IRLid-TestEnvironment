# Idempotent Batch 13 Task 1 migration for the remote test D1 database.
# Table/index creation is safe to re-run because all statements use IF NOT EXISTS.

$ErrorActionPreference = "Stop"

function Invoke-D1Command {
  param([Parameter(Mandatory=$true)][string]$Sql)
  wrangler d1 execute irlid-db-test --remote --command $Sql
}

Invoke-D1Command @"
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
"@

Invoke-D1Command "CREATE INDEX IF NOT EXISTS idx_staff_sessions_org ON org_staff_sessions(org_id, expires_at);"
Invoke-D1Command "CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_sessions_org_hello ON org_staff_sessions(org_id, hello_hash);"
