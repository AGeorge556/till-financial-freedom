// Plain module (not "use server"): helpers shared by the action files. Actions return this to useActionState.
export type ActionState = { error?: string };

export const NAME_ERROR = "Enter a name (up to 80 characters).";

export const validName = (name: string) => name.length > 0 && name.length <= 80;

export function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function flag(formData: FormData, key: string): boolean {
  const v = formData.get(key);
  return v === "on" || v === "true";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id from the client; null unless it is a well-formed uuid (Postgres would throw on anything else). */
export function id(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return UUID.test(v) ? v : null;
}

/** True for a real YYYY-MM-DD calendar date; rejects 2026-02-30. */
export function isRealDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d;
}
