# Acceptance and outstanding checks

Automated checks: run npm run check and npm test. See VERIFICATION.txt for build-time output.

Manual demo acceptance:
- Dashboard loads, mobile layout works, focus visible.
- Three fictional map sites; latest UTC timestamp and stale flag visible.
- Previous rotation Apr 1–Sep 30 inclusive; daily denominator 183, hourly 4,392.
- Five missing days remain chart gaps; flagged values retained in CSV, excluded from summaries.
- Graph and CSV follow applied filters, even after editing filter controls without applying.
- PNG has white background, demo watermark, dates, device and coverage.
- Device clicking/filtering and accessible data table work.

Live acceptance (requires explicit user approval):
- Rotated server-only credentials; authenticated localhost access required.
- Recent token/device/telemetry request succeeds without exposing secrets.
- Sensor identity and units survive ingestion; duplicates update existing values.
- CSV Sep 30 last reading included; Oct 1 excluded; invalid import rejects all rows.
- Worker survives normal errors and resumes next interval; single process only.
- History gaps are acknowledged; no promise of inaccessible April data.

Not included: full browser automation, mocked TSI network error tests, production security review, managed database, multi-account authorization, distributed jobs, performance testing, or deployment. Do not mark those completed without doing the work.
