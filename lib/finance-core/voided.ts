/**
 * A correction never deletes a record: it sets voided_at and, for an edit, inserts a replacement in the same
 * transaction. Every calculation and normal list reads through this, so a voided row counts exactly as if it had never
 * been entered. Only the backup and a "show removed" view ask for `includeVoided`.
 */
export function visibleRows<T extends { voidedAt?: unknown }>(rows: T[], includeVoided = false): T[] {
  return includeVoided ? rows : rows.filter((r) => r.voidedAt === null || r.voidedAt === undefined);
}
