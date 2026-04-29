# Idempotent Batch C migration for expected attendee/member roles.
# Adds org_expected.prototype_role only when the remote test D1 table does not already have it.

$ErrorActionPreference = "Stop"

$info = wrangler d1 execute irlid-db-test --remote --command "PRAGMA table_info(org_expected);"
$hasRole = $info -match "\bprototype_role\b"

if ($hasRole) {
  Write-Host "org_expected.prototype_role already exists"
  exit 0
}

wrangler d1 execute irlid-db-test --remote --command "ALTER TABLE org_expected ADD COLUMN prototype_role TEXT DEFAULT 'attendee';"
Write-Host "Added org_expected.prototype_role"
