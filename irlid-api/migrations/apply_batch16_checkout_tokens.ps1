# Idempotent Batch 16 Task 1 migration for the remote test D1 database.
# Table/index creation is safe to re-run because all statements use IF NOT EXISTS.

$ErrorActionPreference = "Stop"

function Invoke-D1Command {
  param([Parameter(Mandatory=$true)][string]$Sql)
  wrangler d1 execute irlid-db-test --remote --command $Sql
}

Invoke-D1Command @"
CREATE TABLE IF NOT EXISTS org_checkout_tokens (
  token       TEXT PRIMARY KEY,
  checkin_id  TEXT NOT NULL,
  org_api_key TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER
);
"@

Invoke-D1Command "CREATE INDEX IF NOT EXISTS idx_checkout_tokens_checkin ON org_checkout_tokens(org_api_key, checkin_id, expires_at);"
Invoke-D1Command "CREATE INDEX IF NOT EXISTS idx_checkout_tokens_expires ON org_checkout_tokens(expires_at);"
