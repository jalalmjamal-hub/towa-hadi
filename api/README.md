# Pilgrim API

The static pilgrim site calls the same-origin `POST /api/pilgrim` Vercel Function. The function accepts only the eight `pilgrim.*` actions, forwards only validated fields to Apps Script, and never returns cached responses.

## Required server configuration

Set these variables only in the Vercel project environment; do not commit values or put them in browser code:

- `PILGRIM_APPS_SCRIPT_URL`: the approved HTTPS Apps Script `/macros/s/{deployment-id}/exec` URL.
- `PILGRIM_API_TOKEN`: a random secret of at least 32 characters. Configure the identical value in Apps Script Script Properties under `PILGRIM_API_TOKEN`.

The Apps Script handler fails closed if the property is absent or the token does not match. This work does not set Script Properties, change deployments, or publish either project. The current Apps Script deployment access setting must also be explicitly reviewed and approved before a real Vercel-to-Apps-Script connection can work.

The in-memory IP limiter is best-effort per function instance; it is not a distributed abuse-control system. Do not treat it as ownership verification. Knowing an identity or phone number alone does not establish that the caller is the pilgrim.

## Local checks

From the UI repository, run:

```powershell
node --test tests\pilgrim-api.test.js
```

From the local Apps Script project copy, run:

```powershell
node --test pilgrim_api_local.test.js
```

Both suites use synthetic records and do not call production services.
