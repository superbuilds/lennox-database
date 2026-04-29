# Lennox Lending — Data Migration Tool

One-shot importer that takes Lennox Lending's deal pipeline data from
Google Sheets CSV exports, matches sponsors against FollowUpBoss (FUB) Persons
to backfill contact info, and writes everything into the already-deployed
Supabase schema.

The Supabase schema is **already deployed**. This tool is import-only — it
does not run migrations or modify schema.

## Stack

- TypeScript run with `tsx` (Node 20+)
- `@supabase/supabase-js` for DB writes (service-role key, bypasses RLS)
- `papaparse` for CSV parsing
- `dotenv` for config

## Run order

1. `npm install`
2. Drop the two CSVs into `data/`:
   - `data/sponsors.csv`
   - `data/pipeline.csv`
   (these contain PII and are gitignored — never commit them)
3. `cp .env.example .env` and fill in:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `FUB_API_KEY`
4. `npm run migrate` — **dry run** (default). Reads CSVs, hits FUB, computes
   everything, prints a detailed report. **Writes nothing.**
5. Inspect output. Confirm match counts, normalization issues, sales-rep
   mapping, and that there are no unexpected orphan deals.
6. `npm run migrate:write` — actually commits inserts to Supabase.
7. `npm run validate` — re-runs the post-import sanity checks against the DB
   and exits non-zero if anything fails.

## What the tool does

1. Seeds `app_users` from a hardcoded list of 9 reps (idempotent upsert on email).
2. Loads `sponsors.csv`, fetches every FUB Person via cursor pagination,
   builds a name index, matches each sponsor:
   - 1 hit → `exact_unique` (writes fub_person_id, email, phone, fub_url, fub_stage)
   - >1 hits → `exact_ambiguous_resolved` (picks highest-stage-priority candidate,
     records all candidate IDs in `import_notes`)
   - 0 hits → `none` (fub_person_id stays null)
3. Flags duplicate sponsor names within the source CSV via `needs_dedup_review`.
4. Resolves `Sales Rep` text to `app_users.id`.
5. Inserts sponsors (upsert on `legacy_sheet_name`).
6. Loads `pipeline.csv`, normalizes every enum field, parses money/percent/dates,
   categorizes Quote Lost Reasons (`Rejected` / `Ghosted` / `Pricing` / `Other`),
   resolves `sponsor_id` via the name → uuid map.
7. Inserts deals in batches of 100.
8. Runs validation queries (row counts, FUB match floor, stage distribution,
   orphan check, sponsor → app_user FK integrity, sum of quoted loan amounts).

## Files

```
src/
├── env.ts            loads + validates env vars
├── supabase.ts       Supabase client, batch insert helper
├── fub.ts            FUB API client (cursor pagination)
├── normalize.ts      enum + money + percent + date parsers
├── match.ts          name index + FUB person matching
├── import-sponsors.ts
├── import-deals.ts
├── validate.ts       post-import sanity checks
└── main.ts           CLI entry (--write to commit)
```

## Notes

- Default mode is **dry run**. You have to pass `--write` to actually mutate
  Supabase. This is intentional.
- All inserts run in batches of 100 with per-batch error logging.
- Money fields strip `$` and `,`. Percent fields handle both `2.5%` and `0.025`
  forms (any value > 1 is treated as percent points and divided by 100).
- Dates parse MM/DD/YYYY (sheet format) and ISO YYYY-MM-DD.
- Quote Stage value `#REF!` is coerced to null.
- Warnings/errors go to stderr; the structured report goes to stdout.
- Exit code 0 on success; 1 if validation fails.
