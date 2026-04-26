# Idempotent Batch 10 migration for the remote test D1 database.
# Table/index creation is safe to re-run because both statements use IF NOT EXISTS.

$ErrorActionPreference = "Stop"

function Invoke-D1Command {
  param([Parameter(Mandatory=$true)][string]$Sql)
  wrangler d1 execute irlid-db-test --remote --command $Sql
}

Invoke-D1Command @"
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
"@

Invoke-D1Command "CREATE INDEX IF NOT EXISTS idx_rebind_history_expected_month ON rebind_history(org_code, expected_id, created_at);"
