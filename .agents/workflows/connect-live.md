---
description: Guide an approved local TSI connection without exposing secrets
---
1. Read AGENTS.md and the TSI integration notes. Explain the 90-day history limitation and local single-operator security model.
2. Have the user rotate exposed credentials, verify client-ID/secret assignment, and configure .env locally without pasting it into chat.
3. Require explicit approval before any live API request or archive-changing command. Ensure a backup exists before imports.
4. Use a bounded recent sync first, not an automatic 89-day fetch. Report sanitized status, not tokens or raw auth responses.
5. Check archive counts, device metadata, dates and missing-history coverage without publishing private coordinates or identifiers.
6. Explain worker mode: it replaces the ordinary server and runs one process only. No public deployment or infrastructure provisioning.
