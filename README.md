# Aero — Antigravity application workspace

This archive contains an actual runnable Node.js app, not only a prompt. No Python is required. It is a local single-operator starter, not a production-certified service. It includes server-side TSI integration, a browser dashboard, persistent local archive, tests, and Antigravity project instructions.

## Open in Antigravity

1. Extract the ZIP. Open the extracted aero-antigravity folder as your workspace in Antigravity.
2. Ask the agent: "Read AGENTS.md and README.md. Run the syntax checks and tests, start the app, then verify the dashboard in the browser. Preserve working features and report any failures. Do not access live credentials or deploy anything without my approval."
3. AGENTS.md is the workspace instruction entry point. Optional reusable workflows are included under .agents/workflows. If your version does not list them automatically, open the Markdown workflow and ask the agent to follow it; no workflow discovery is required to run the app.

## Quick start

Install a current supported Node.js release, version 22.9 or newer. In the project folder:

```sh
npm run check
npm test
npm start
```

Open http://127.0.0.1:3000 and leave the terminal running. Ctrl+C stops it. There are no npm server dependencies to install. Browser map/chart libraries load from pinned CDN URLs and require internet access; map tiles are external too. npm start also works in Windows PowerShell.

The app starts in DEMONSTRATION DATA mode. Readings are synthetic for three fictional sites with illustrative New York coordinates. Five fully missing days illustrate gaps; flagged samples illustrate QC. Demo data is not your real network.

## Features implemented

- Responsive dashboard and sensor map with coordinate validation, latest stored value, UTC timestamp, >24-hour stale warning, quality flags and click-to-filter.
- Default Previous rotation: April 1 through September 30, 2026 inclusive (UTC).
- Device, metric, dates and daily/hourly filters. Last applied filters drive CSV and PNG, not unsubmitted edits.
- PM2.5, PM10, CO2, temperature and humidity when supplied by instruments.
- Equal-weight sensor/device/bucket summaries, observed min/max envelope, null gaps, coverage and flagged sample counts; accessible data table.
- White-background PNG with report title, device, dates, coverage and demo watermark.
- Raw CSV export including sensor/account IDs, units, quality, source and UTC timestamps.
- Validated normalized historical CSV import with user confirmation and all-row validation before archive mutation.
- OAuth client-credentials integration, token cache, bounded upstream retries, one-day sync slices and overlapping idempotent writes.
- Background worker process with 15-minute sync interval independent of browser tabs.
- Live mode Basic authentication, same-origin POST header checks, local-only listening, fixed static-file allowlist, 10 MB import request limit and CSV formula escaping for text.

## Connect live TSI data

Rotate the two credential values previously shared in chat. Confirm in your TSI developer account which is the client ID and which is the client secret. Neither is included in this archive.

Copy .env.example to .env and edit its placeholders. The app loads .env through Node's built-in environment-file option. Do not commit it or paste its contents into agent prompts. Environment variables already set in the shell take precedence.

```env
DEMO_MODE=false
PORT=3000
TSI_CLIENT_ID=YOUR_ROTATED_CLIENT_ID
TSI_CLIENT_SECRET=YOUR_ROTATED_CLIENT_SECRET
PORTAL_USER=admin
PORTAL_PASSWORD=YOUR_LONG_UNIQUE_PASSWORD
```

Then run:

```sh
npm run sync -- 89
npm start
```

The optional initial backfill fetches up to 89 recent days. Use npm run sync -- 2 for a shorter sync. Sign into the browser prompt with PORTAL_USER and PORTAL_PASSWORD. The app refuses live requests without both values.

For continued logging, stop the ordinary server and instead run:

```sh
npm run worker
```

Worker mode runs BOTH the server and a periodic logger in one process. Do not run npm start and npm run worker simultaneously against the same archive or port. The manual Sync button also runs in this process with a shared in-process lock. Use a supervisor for long-term availability; this starter does not provision a service or scheduler for you. A browser tab does not need to stay open.

## History limitation

The supplied TSI API v3 specification limits start_date and latest_as_of_date to 90 days before current time. Smaller chunks do not bypass that restriction. The complete April–September 2026 rotation is not recoverable from those API calls alone at the November 12, 2026 request date. Import an existing archive for older history. Missing periods are not zero-filled. Historical access and upstream completeness have NOT been tested against your account.

## Archive and CSV schema

Default archive files: data/demo.json and data/live.json. DATA_PATH optionally overrides the path. Each successful sync slice is persisted using a serialized atomic-file replacement. Key identity is account+device+sensor+metric+measurement timestamp, so duplicate windows update rather than inflate counts. Sensor serial is preferred; absent serial falls back to model/type and source sensor index, which may be unstable if upstream ordering changes. Audit-quality use needs a stronger device-specific sensor mapping.

Normalized UTF-8 CSV columns:

```csv
account_id,device_id,sensor_id,timestamp,metric,value,unit,quality,source
example-account,example-device,example-sensor,2026-04-01T00:00:00Z,mcpm2x5,10,µg/m³,valid,historical-import
```

Required columns: account_id,device_id,sensor_id,timestamp,metric,value,unit,quality. source is optional. Quality is valid or flagged. Timestamps require Z or an explicit timezone offset. Units must match exactly: mcpm2x5/mcpm10 = µg/m³, co2_ppm = ppm, temperature = °C, rh = %. The included sample is synthetic and should not be mistaken for real measurements. This importer is not an automatic converter for arbitrary vendor CSV formats.

Maximum import is 50,000 rows and 10 MB. All rows are validated before committing. Updates replace matching records; back up the archive first. Formula-like TEXT fields are apostrophe-prefixed on export; unusual IDs beginning with =,+,-,@ may need normalization before reimport. Legitimate negative numeric values are preserved.

## Statistical definitions

1. Average valid samples per sensor per daily/hourly UTC bucket.
2. Equal-weight sensor means within each device, then device means within a fleet bucket.
3. Period mean is the equal-weight mean of populated fleet buckets.
4. Peak and envelope derive from valid raw samples; system/sensor status flags exclude samples from summaries but not raw exports.
5. Coverage is populated buckets divided by requested buckets: any selected device's valid sample makes a bucket populated. It is NOT fleet uptime or per-device completeness. Apr–Sep denominator is 183 days or 4,392 UTC hours.

Map markers show latest stored readings regardless of report dates. Colors compare relative concentrations; they are not EPA AQI categories or a continuous modeled pollution surface. No automatic email is sent by graph download.

## Limits and production hardening

The local JSON store is loaded into memory and rewritten on updates; it is intentionally simple and unsuitable for a large fleet, multi-process access or indefinite high-volume logging. Run one app/worker only. Device metadata is keyed by device ID; multi-account authorization and granular roles are NOT implemented. All authenticated operators share the same archive and privileges. There is no import rollback UI, durable job queue, distributed lease, per-device coverage panel, audit trail or sync checkpoint ledger. Successful day slices survive restart, but retries rescan the configured lookback window.

The TSI specification does not document pagination or quota sizes. This app does not invent them. One-day slices reduce response sizes but do not prove upstream completeness; verify with your account. Network exceptions fail the sync; later scheduled runs retry. A 401 clears the cached token and retries within a bounded loop. No live credentials have been tested.

Use localhost for now. Do not expose Basic authentication over public HTTP. A public deployment needs HTTPS, SSO/OIDC and authorization, rate limiting, stricter CSP and asset hosting, managed PostgreSQL or equivalent with migrations/indexes, job queue and distributed leases, provenance/audit history, staged imports, backups and load/security tests. Do not put this JSON archive on ephemeral serverless disk. Configure a suitable map tile provider for production-scale use. Do not deploy infrastructure or incur charges without approval.

## Verification

See VERIFICATION.txt for actual output. Four Node test groups passed, covering UTC conversion, CSV handling, means/QC, and HTTP demo/live-import/auth/date-boundary/deduplication behavior. Syntax checks passed for server, analysis helpers, browser JavaScript and tests. Browser rendering, map/PNG downloads, real TSI access and long-running worker reliability are not verified in the build environment.

## Reference basis

TSI contract distilled from the user-supplied tsi-external-api.yaml (OpenAPI 3.0.3, API version 3.0). Original raw YAML is not bundled in this reconstructed workspace; add it to docs/ if available. Antigravity customization layout follows Google's documented AGENTS.md and .agents/workflows conventions. No external account, repository or cloud resource was created.
