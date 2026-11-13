---
description: Verify the Aero local app safely in demo mode
---
1. Read AGENTS.md and README.md. Do not read .env or live archive contents.
2. Confirm Node >=22.9. Run npm run check and npm test; inspect actual outputs.
3. Start the server with DEMO_MODE=true and a separate temporary DATA_PATH. Avoid reading .env by running node server.mjs directly with these environment variables. Use a free port if 3000 is occupied.
4. Open the localhost preview if browser tools are available. Check demo badge, 183-day range, visible gaps, map popups, device filters and mobile/keyboard usability.
5. Test CSV and PNG downloads against applied filters. Verify CSV content and PNG labels if tooling allows.
6. Stop only processes started by this workflow. Do not touch user services or live data.
7. Report passed, failed and not-run checks separately. No deployment or live sync.
