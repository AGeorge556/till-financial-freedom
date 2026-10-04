import "server-only";
import { parsePasskeysEnabled } from "@/lib/passkeys";

/**
 * Whether the Supabase project has passkeys switched on (public auth settings endpoint). Cached for a minute; any
 * failure counts as off, so the passkey UI simply stays hidden.
 */
export async function passkeysEnabled(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok && parsePasskeysEnabled(await res.json());
  } catch {
    return false;
  }
}
