# Idempotent Batch 8 migration for the remote test D1 database.
# SQLite/D1 does not support ALTER TABLE ADD COLUMN IF NOT EXISTS, so this
# script inspects PRAGMA table_info first and only runs ALTER statements for
# columns that are absent.

$ErrorActionPreference = "Stop"

function Invoke-D1Command {
  param([Parameter(Mandatory=$true)][string]$Sql)
  wrangler d1 execute irlid-db-test --remote --command $Sql
}

function Get-D1TableColumns {
  param([Parameter(Mandatory=$true)][string]$Table)
  $output = Invoke-D1Command "PRAGMA table_info($Table);" | Out-String
  $matches = [regex]::Matches($output, '"name"\s*:\s*"([^"]+)"')
  @($matches | ForEach-Object { $_.Groups[1].Value })
}

function Add-D1ColumnIfMissing {
  param(
    [Parameter(Mandatory=$true)][string]$Table,
    [Parameter(Mandatory=$true)][string]$Column,
    [Parameter(Mandatory=$true)][string]$Definition,
    [Parameter(Mandatory=$true)][string[]]$ExistingColumns
  )
  if ($ExistingColumns -contains $Column) {
    Write-Host "skip $Table.$Column"
    return
  }
  Write-Host "add $Table.$Column"
  Invoke-D1Command "ALTER TABLE $Table ADD COLUMN $Definition;"
}

$checkinColumns = Get-D1TableColumns "org_checkins"
Add-D1ColumnIfMissing "org_checkins" "attendee_pub_jwk"       "attendee_pub_jwk TEXT"                  $checkinColumns
Add-D1ColumnIfMissing "org_checkins" "checkout_payload_hash"  "checkout_payload_hash TEXT"             $checkinColumns
Add-D1ColumnIfMissing "org_checkins" "checkout_signature"     "checkout_signature TEXT"                $checkinColumns
Add-D1ColumnIfMissing "org_checkins" "checkout_ts"            "checkout_ts INTEGER"                    $checkinColumns
Add-D1ColumnIfMissing "org_checkins" "checkout_method"        "checkout_method TEXT DEFAULT 'signed'"  $checkinColumns
Add-D1ColumnIfMissing "org_checkins" "device_key_fp"          "device_key_fp TEXT"                     $checkinColumns
Add-D1ColumnIfMissing "org_checkins" "status"                 "status TEXT DEFAULT 'checked_in'"       $checkinColumns
Add-D1ColumnIfMissing "org_checkins" "expected_id"            "expected_id INTEGER"                    $checkinColumns
Add-D1ColumnIfMissing "org_checkins" "conflict_id"            "conflict_id INTEGER"                    $checkinColumns

$expectedColumns = Get-D1TableColumns "org_expected"
Add-D1ColumnIfMissing "org_expected" "device_key_fp" "device_key_fp TEXT" $expectedColumns

Invoke-D1Command @"
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
"@

Invoke-D1Command "CREATE INDEX IF NOT EXISTS idx_attendee_conflicts_org ON attendee_conflicts(org_code, resolution);"
