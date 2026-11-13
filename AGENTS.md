# Aero workspace instructions

## Start here
Read README.md, docs/TSI-INTEGRATION.md, docs/ACCEPTANCE.md and VERIFICATION.txt before changing architecture. This is an actual runnable zero-server-dependency Node app, not a placeholder. Preserve its existing behavior unless the user requests a migration. Use Node >=22.9. Commands: npm run check, npm test, npm start. HTTP preview is http://127.0.0.1:3000. No Python or npm dependency install is required for the current app.

## Non-negotiable constraints
- Never read, print, commit or request the contents of .env unless the user explicitly authorizes secret handling. Ask the user to configure secrets locally; explain variable names only. Never put TSI secrets/tokens in browser code or logs.
- Demo is synthetic and isolated from live data. Never convert a live error to fake success.
- Apr 1–Sep 30 2026 is inclusive; internal upper boundary Oct 1 UTC. Missing history remains missing. TSI 90-day history cannot be bypassed by chunking.
- Preserve sensor/account identity, UTC timestamps, units, zero values and quality flags. Do not label concentration graphs or relative marker colors official AQI.
- CSV/PNG must match last applied filters and disclose demo status.
- Existing JSON archive is single-process/small-scale only. Do not claim durable multi-instance or production readiness. Back up before any data migration; never delete live files to reset demo.
- Do not deploy, publish, create cloud resources, send mail, run a real backfill or incur charges without explicit approval.

## Workflow
Inspect source, explain intended changes, implement in small steps, run syntax/unit/HTTP tests, and use browser testing if available. For browser testing use demo mode only unless live access is explicitly approved. Verify keyboard/mobile layout and downloads. Report what was actually tested, failures, and unconfigured integrations. No invented screenshots, completed tests or live results.

## Improvement priorities when requested
Prefer PostgreSQL and migrations for scaling, OIDC and account-level roles for public access, durable queues/leases/checkpoints for logging, staged import previews/provenance, per-device coverage, mocked TSI retry/token tests, and Playwright UI/export tests. Do not silently rewrite the entire app just to match a framework preference.
