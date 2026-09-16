# Meter API v2

The existing `structure.md` is a legacy architecture snapshot. This document describes the September 2026 changes without replacing existing local edits to that guide.

Send `X-Kafai-Version: 2` and the existing Bearer JWT. `/api/version` reports capability version 2. GET/POST/PUT/DELETE `/api/kafai` retain their paths. v2 uses `recordedAt` (ISO timestamp with timezone), `meterReading`, `modulus` (default 10000), `cycle` (integer cumulative rollover count), `seriesId`, and `source`. It does not expose or require `targetDate`. `meterReading + cycle * modulus` is the continuous cumulative scale. A first reading is a baseline, not consumption. Decimal precision is six places in calculated differences.

POST infers the minimum rollover count between adjacent readings unless `cycle` is supplied. A rollover requires `confirmRollover: true`. A replacement meter uses a new `seriesId`; consumption intervals in two series must not overlap. PUT and DELETE from v2 supply the previous `updatedAt` to prevent stale edits. Invalid data returns 400, missing/not-owned 404, conflicts 409. All queries and migrations are scoped by JWT userId. Unversioned clients only see legacy usage records and cannot mutate new readings.

Every mutation runs in a MongoDB transaction and first increments the owner's `meterRevision`, serializing mutations across instances. MongoDB Atlas/replica-set support is required. New indexes cover user/date and uniquely identify a timestamp within a meter series. Deleting an intermediate reading retains cycle counts on remaining readings, so full rotations are not lost. Editing reconstructed records retains reconstructed provenance and adjusts adjacent intervals without rebasing all history.

## Migration

`POST /migration/preview` is read-only. Default mode expects `startAt`, `anchorAt` equal to the last legacy period endpoint, and `anchorReading`. `mode: usage_days` instead uses legacy target dates as historical usage days, applies explicit `dateCorrections: {recordId: YYYY-MM-DD}`, groups duplicate usage days without discarding their amounts, and reconstructs readings at the start of each usage period plus the measured final anchor. Raw source IDs are retained. Missing spans require explicit `acceptListedUsageTotal: true`; they remain reconstructed intervals, not measured daily observations.

`POST /migration/commit` requires a fingerprint of record IDs and updatedAt values from the preview snapshot. It stores all original raw records, correction policy, gaps, and owner revision in `kafai_migrations`, then atomically replaces the active records. Repeated commits are rejected after migration. `GET /migration/latest` reports the last migration without exposing the full archive. `POST /migration/rollback` accepts `migrationId` and restores the exact archived documents only when no later mutations occurred. The archive remains available if selective recovery is needed later.

Maintenance CLI, read-only by default:

```powershell
node scripts/migrate-usage.js --username <account> --anchor <reading> --at <ISO-time>
# Add --correction <recordId>=<YYYY-MM-DD> for each user-specified correction.
# Add --accept-listed-total only when the user explicitly chooses that reconstruction assumption.
# Add --apply after both apps are deployed. This POSTs the authenticated migration API.
```

Credentials come from ignored `.env` / environment only. No migration executes automatically during startup or deployment. The maintenance script verifies the resulting count/anchor and removes obsolete targetDate indexes after successful migration; the old date values survive in the archive.

## Verification

`npm test` starts an isolated in-memory MongoDB replica set and tests transactions, ownership, rollover, concurrent duplicates, stale updates, invalid dates/numbers, migration preview/apply/rerun/rollback and corrected usage-day reconstruction. It never uses the production URI. Deploy the backend first, verify `/api/version`, then deploy frontend, then run any authorized migration.
