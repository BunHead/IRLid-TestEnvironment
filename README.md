# IRLid TestEnvironment

## What This Is

This repository is the IRLid test environment for trying website, organisation portal, and Worker changes before they affect the production project. The live static frontend is published from `BunHead/IRLid-TestEnvironment` to GitHub Pages, and the test backend is the `irlid-api-test` Cloudflare Worker. That Worker uses the test D1 database configured in `irlid-api/wrangler.toml`, with database id `b7d7ccc9-a7b9-46e6-8690-385545d547f1`.

The HTML files at the repo root are the test site pages, including the QR flow, receipt flow, account screens, and organisation portal. The Worker code lives in `irlid-api/src/index.js`, while its database schema lives in `irlid-api/schema.sql`. This repo is allowed to be practical and experimental, but changes should still be split into small, reviewable PRs.

## What This Is NOT

This is not the production IRLid repository. Production work belongs in `BunHead/IRLid`, and this repo should not be treated as the source of truth for production deployment policy or canonical protocol decisions.

This is also not the canonical protocol specification. The canonical protocol spec lives in `BunHead/IRLid/PROTOCOL.md`; reference it when needed, but do not import or rewrite it here as part of test-environment work. Local protocol notes in this repo are supporting context only.

## How To Run Locally

Run the Worker from the `irlid-api` directory with Wrangler:

```powershell
cd irlid-api
wrangler dev
```

The Worker expects a D1 binding named `DB`, which is declared in `irlid-api/wrangler.toml`. `CORS_ORIGIN` is set there for the GitHub Pages origin, and `ALLOWED_EMAILS` may be configured as a Worker secret when Google login needs to be gated. Organisation endpoints use an organisation API key sent as `X-Org-Key`; user/session endpoints use `Authorization: Bearer <session_token>`.

Serve the static frontend with any simple static server from the repo root. The Worker CORS list currently allows `http://localhost:3000`, `http://localhost:8000`, `http://127.0.0.1:3000`, and `http://127.0.0.1:8000`, so prefer one of those ports for local browser testing. For example, use whatever local static server is available in your environment and open `org.html` or `index.html` from that server rather than from `file://`.

## How To Reset The Test DB

The schema source is `irlid-api/schema.sql`. To apply it to the local Wrangler database, run:

```powershell
cd irlid-api
wrangler d1 execute irlid-db-test --local --file .\schema.sql
```

To apply the schema to the remote test D1 database, use the remote D1 flag intentionally:

```powershell
cd irlid-api
wrangler d1 execute irlid-db-test --remote --file .\schema.sql
```

Be careful with destructive resets, deletes, or manual SQL against the remote test database. It is a test database, not production, but other sessions may still rely on its current rows while testing GitHub Pages and `irlid-api-test` together.

## Working Rules

The current session contract is kept in `HANDOVER.md`. It may contain up to three atomic tasks per session, and they must be completed in order with one separate PR per task. Stop after Task 3 and wait for a fresh handover before starting more work.

Stay inside `BunHead/IRLid-TestEnvironment` unless the handover explicitly says otherwise. Do not touch `BunHead/IRLid`, do not rewrite the canonical production protocol spec from here, and keep each PR scoped to the files listed for its task. If scope or Worker behavior is unclear, stop and ask rather than improvising.

## Tagged Commits Convention

Codex commits should be prefixed with `[codex]`. This makes automated or delegated work easy to distinguish in history and PR stacks.

Number One updates should be prefixed with `[no1]`. Handover commits, working-rule updates, and direct maintainer changes should use that tag so future sessions can quickly understand where instructions came from.
