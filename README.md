# Till Financial Freedom

Personal wealth, savings, investment and goal tracker. EGP only, single user, installable on the iPhone home screen (PWA).

Status: feature complete. Phase 6 was polish: loading and error screens, a Settings page, auto-lock, security headers, fewer database reads per page, and the Vercel region. Every page except `/login` requires a session (`proxy.ts`). Per-phase schema changes are in `docs/schema-phase-*.md`; phase 6 added one column (`docs/schema-phase-6.md`).

## Layout

- `lib/finance-core/` - pure TypeScript calculation engine (no React, Next.js or database imports) and its tests. The only place financial formulas live.
- `db/schema.ts`, `db/migrations/` - Drizzle schema and generated SQL. `db/queries.ts` - read loaders (shared per page render).
- `app/`, `components/` - Next.js App Router. Money is integer piasters and is shown through the `Amount` component, so privacy mode hides it everywhere.
- `app/actions/` - server actions: the only writes, each in a database transaction and filtered by the signed-in user's id.

## Routes

Tabs: `/` (Home), `/spending`, `/goals`, `/investments`, `/more`. Also `/login`.

Under Goals: `/goals/plan`, `/goals/rules`, `/goals/[id]`. Under Investments: `/investments/[id]`.

Under More (`/more`):

| Route | What it is |
|---|---|
| `/more/review` | Monthly review |
| `/more/history` | Net worth history |
| `/more/scenarios` | What if calculator |
| `/more/reports` | Index of reports |
| `/more/budgets` | Budgets and warning levels |
| `/more/recurring` | Recurring bills and income |
| `/more/accounts`, `/more/accounts/[id]` | Accounts and balances |
| `/more/liabilities`, `/more/liabilities/[id]` | Loans and payments |
| `/more/categories` | Categories |
| `/more/settings` | Day your month starts, auto-lock, links to the three below |
| `/more/assumptions` | Expected returns, gold price mode, stale-value limits |
| `/more/reminders` | Reminder switches and insight thresholds |
| `/more/backup` | JSON backup, transactions CSV, restore into an empty account |
| `/more/backup/export` | The download itself (`?format=json` or `?format=csv`) |

## Commands

```bash
npm run dev          # local app on http://localhost:3000
npm test             # unit tests: calculation engine and backup (Vitest)
npm run typecheck
npm run build
npm start            # serve the production build
npm run db:generate  # generate a migration from db/schema.ts
npm run db:migrate   # apply migrations (needs DIRECT_URL or DATABASE_URL)
npm run db:seed      # starter data (needs DATABASE_URL and SEED_USER_ID)
```

CI (`.github/workflows/ci.yml`) runs tests, `next typegen`, typecheck and build on every pull request and on pushes to `main`.

## Environment

Copy `.env.example` to `.env.local` and fill in the values. Never commit real values.

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sign-in and session refresh (`proxy.ts`, `lib/supabase/server.ts`). Public values. |
| `DATABASE_URL` | The app's database connection: the Supabase transaction-mode pooler string, port 6543 (`db/index.ts`). Also the fallback for migrations and the seed. |
| `DIRECT_URL` | Direct connection (port 5432) that `drizzle-kit` prefers for migrations (`drizzle.config.ts`). |
| `SEED_USER_ID` | The `auth.users` id that `npm run db:seed` fills with starter data. |
| `SUPABASE_SERVICE_ROLE_KEY` | Listed in `.env.example` but not read by any code today. Keep it out of Vercel unless something needs it. |

## Database migrations

The database is changed only by `drizzle-kit`. Never edit the database by hand and never edit an applied migration.

1. Change `db/schema.ts`.
2. `npm run db:generate` writes the next `db/migrations/NNNN_*.sql` and its snapshot.
3. Dry run: `drizzle-kit migrate` has no dry-run flag, so read the generated SQL file and check that it does only what you meant. Run `npx drizzle-kit check` to confirm the migration history is consistent.
4. `npm run db:migrate` applies it. The migrate step opens a connection to the live database.

## Deployment (Vercel)

- Functions run in Dublin (`dub1`, set in `vercel.json`) next to the Supabase database in eu-west-1 (Ireland).
- Set the environment variables above in the Vercel project: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `DATABASE_URL` (the port 6543 pooler string). Apply migrations from your own machine, not from Vercel.
- In Supabase, disable public sign-ups (Authentication settings) so only the one account you created can sign in.
- `next.config.ts` sends `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` and `Strict-Transport-Security`. There is no script Content-Security-Policy: it would need a nonce on every page.
- The database client keeps at most 5 connections per server instance (`db/index.ts`).

## Behaviour worth knowing

- Auto-lock (Settings): after N minutes without a touch, key or scroll, and when you reopen the app after being away longer than N, the app signs you out. Default 5 minutes; Never turns it off.
- Privacy mode (eye icon in the header) hides every amount and is remembered on the device.
- An error screen never shows the error message or any figures, only "Try again" and a link Home.
