# Pilgrim API

The static pilgrim site calls the same-origin `POST /api/pilgrim` Vercel
Function. For this read-only stage, the function accepts only:

- `pilgrim.lookup`
- `pilgrim.season`

The function forwards only validated fields to Apps Script, returns a
strictly filtered response, and never caches responses. Search values are
sent in the POST body, not in URLs, and are not logged.

## Required server configuration

Set these variables only in the Vercel project environment; do not commit
values or put them in browser code:

- `PILGRIM_APPS_SCRIPT_URL`: the approved HTTPS Apps Script `/macros/s/{deployment-id}/exec` URL.
- `PILGRIM_API_TOKEN`: a random secret of at least 32 characters. Configure the identical value in the standalone Apps Script Script Properties.

The Apps Script project also needs the development spreadsheet ID and
synchronized active season year as Script Properties. The season property is
not automatically synchronized with the administration project's
`SEASON_ACTIVE_YEAR_V1`; update the pilgrim project's property when the active
season changes.

The in-memory IP limiter is best-effort per function instance; it is not a
distributed abuse-control system. Do not treat it as ownership verification.
Knowing an identity or phone number alone does not establish that the caller
is the pilgrim.

## Local checks

From this repository:

```powershell
node --test tests\pilgrim-api.test.js
```

Tests use synthetic records and credentials; they make no Google, Vercel, or
production calls.
