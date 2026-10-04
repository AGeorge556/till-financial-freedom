// A failed query makes Drizzle throw "Failed query: <sql>" followed by a "params: <values>" line, and Next logs server
// errors with console.error, so amounts, notes and ids would land in the server logs. This strips the values and keeps
// the SQL.
// ponytail: a console.error wrapper, not a logging pipeline; replace with a real logger if one is ever added.
const redactText = (text: string) => text.replace(/params: [^\n]*/g, "params: [redacted]");

function redact(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (value instanceof Error) {
    // A copy without `cause`: the driver error under it can quote row values in its detail text.
    const copy = new Error(redactText(value.message));
    copy.name = value.name;
    copy.stack = value.stack ? redactText(value.stack) : undefined;
    const digest = (value as { digest?: unknown }).digest;
    if (digest !== undefined) (copy as { digest?: unknown }).digest = digest;
    return copy;
  }
  return value;
}

export function register() {
  const original = console.error;
  console.error = (...args: unknown[]) => original(...args.map(redact));
}
