# Schema, phase 2

Phase 2 changed no tables. `db/schema.ts` was not modified and there is no migration after `0001`. See `docs/schema-phase-1.md` for the schema.

## What phase 2 uses

| Table | Used by |
|---|---|
| `accounts` | `app/actions/accounts.ts`, `db/queries.ts`, backup |
| `categories` | `app/actions/categories.ts`, `app/actions/transactions.ts`, backup |
| `transactions` | `app/actions/transactions.ts`, `db/queries.ts`, backup |
| `user_settings` | `getSettings` in `db/queries.ts` (`month_start_day`), backup |

`financial_assumptions` is not read or written in phase 2 and is not part of the backup.

Every query filters by the signed-in user's id, because the Drizzle connection bypasses row-level security.

## Backup format, version 1

`/more/backup/export?format=json` returns `{ version, exportedAt, settings, accounts, categories, transactions }` (`lib/backup.ts`).

- `settings`: `{ monthStartDay }`. Rows carry the table columns in camelCase, with timestamps as ISO-8601 UTC strings and amounts as integer piasters.
- `user_id` is not in the file; a restore stamps the signed-in user's id.
- Row ids are kept, so `fromAccountId`, `toAccountId`, `categoryId` and `replacesId` still point at the right rows after a restore.
- Void rows are included.
- Timestamps are kept to the millisecond (JavaScript `Date` precision).

`parseBackup` rejects a file before anything is written if the version is not 1, a shape, enum, date or integer amount is wrong, an id is duplicated, a referenced account, category or replaced transaction is missing from the file, `replacesId` links loop, or a transaction breaks the amount-sign or account-by-type rules from `transactions_amount_check`, `transactions_fee_tax_non_negative_check` and `transactions_accounts_by_type_check`.

`importBackup` (`app/actions/backup.ts`) restores in one database transaction, and only when the user has no accounts, categories or transactions. Any failure rolls everything back.

`/more/backup/export?format=csv` returns the transactions as `date,type,amount,from_account,to_account,category,note,status` (amount in EGP with two decimals, negative only for ADJUSTMENT). It is for reading in a spreadsheet, not for restoring.
