# Till Financial Freedom

Personal wealth, savings, investment and goal tracker. EGP only, single user, installable on the iPhone home screen (PWA).

Status: Phase 2 (core finance) in progress. Phase 1 gave the calculation engine, ledger schema, five-tab shell and email + password sign-in; every page except `/login` requires a session (`proxy.ts`). Phase 2 adds server actions for accounts, categories and transactions, and `/more/backup`: a JSON backup, a transactions CSV, and restore into an empty account. Phase 2 changed no tables (`docs/schema-phase-2.md`).

## Layout

- `lib/finance-core/` - pure TypeScript calculation engine (no React, Next.js or database imports) and its tests.
- `db/schema.ts`, `db/migrations/` - Drizzle schema and generated SQL. See `docs/schema-phase-1.md`.
- `app/`, `components/` - Next.js App Router shell.

## Commands

```bash
npm run dev          # local app on http://localhost:3000
npm test             # unit tests: calculation engine and backup (Vitest)
npm run typecheck
npm run build
npm run db:generate  # generate a migration from db/schema.ts
npm run db:migrate   # apply migrations (needs DIRECT_URL or DATABASE_URL)
npm run db:seed      # starter data (needs DATABASE_URL and SEED_USER_ID)
```

## Environment

Copy `.env.example` to `.env.local` and fill in the Supabase values. Never commit real values.
