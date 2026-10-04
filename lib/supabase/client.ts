import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for the browser, for passkey sign-in and management ONLY. Never use it for table access: financial
 * data goes through server actions and Drizzle, filtered by requireUserId().
 *
 * It stores the session in cookies (the same ones proxy.ts and lib/supabase/server.ts read), never in localStorage.
 * No background token refresh and no session from the URL: proxy.ts refreshes the session on every navigation, and two
 * refreshers using the same refresh token would fight.
 */
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });
}
