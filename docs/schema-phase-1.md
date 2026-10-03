# Schema, phase 1

Source of truth: `db/schema.ts`. Migrations: `db/migrations/` (drizzle-kit only). Money is integer piasters in `bigint` (mode `number`).

## Tables

Every table has `user_id uuid not null` referencing `auth.users(id)` on delete cascade, row-level security enabled, and one policy `<table>_owner_all` for the `authenticated` role: `user_id = (select auth.uid())` for both USING and WITH CHECK, all operations.

| Table | Notes |
|---|---|
| `user_settings` | `user_id` is the PK. `month_start_day` default 1, CHECK 1..28. |
| `accounts` | `type` enum: bank, cash, wallet, brokerage, savings, credit_card, receivable, other. `is_investment`, `opening_balance` (default 0), `archived_at`. No stored balance; derive it from `opening_balance` plus transactions. |
| `categories` | `kind` enum income/expense, `is_essential`, `archived_at`. UNIQUE (`user_id`, `kind`, `name`). |
| `transactions` | The single ledger. Income, expenses and transfers are queries of it. |
| `financial_assumptions` | `user_id` is the PK. `stock_return`, `gold_return`, `savings_cloud_apy`, `cash_return`, `inflation` as `numeric(8,6)`, nullable, no defaults. |

## transactions

- `type`: INCOME, EXPENSE, TRANSFER, INVESTMENT_PURCHASE, INVESTMENT_SALE, LIABILITY_PAYMENT, DIVIDEND, INTEREST, ADJUSTMENT.
- `date` is a `date` (Cairo calendar date, `'YYYY-MM-DD'` string in code). `status`: pending, posted (default), void.
- `fee` (default 0), `gross_amount`, `tax_withheld`, `realized_pl`: bigint piasters, last three nullable.
- Edits: void the old row (`status`, `voided_at`) and insert a new one with `replaces_id` pointing at it (self-FK). Posted rows are not hard-deleted or edited in place; this is a convention for the app layer, not enforced by the database.
- CHECK `transactions_amount_check`: `amount <> 0` and (`type = 'ADJUSTMENT'` or `amount > 0`).
- CHECK `transactions_fee_tax_non_negative_check` (migration 0001): `fee >= 0` and `tax_withheld` null or `>= 0`.
- CHECK `transactions_accounts_by_type_check`:
  - INCOME, DIVIDEND, INTEREST, INVESTMENT_SALE, ADJUSTMENT: `to_account_id` set, `from_account_id` null.
  - EXPENSE, INVESTMENT_PURCHASE, LIABILITY_PAYMENT: `from_account_id` set, `to_account_id` null.
  - TRANSFER: both set and different.
- Indexes: (`user_id`, `date`), `from_account_id`, `to_account_id`.

## Deliberately deferred

- Goals, investments/holdings, liabilities, recurring templates, and any foreign keys to them.
- Database-enforced immutability of posted transactions (no trigger).
- Cross-user integrity: an FK to `accounts`/`categories` does not itself check that the referenced row has the same `user_id`; RLS only checks the row's own `user_id`.
- Seeded `financial_assumptions` values (the seed leaves the table empty).
