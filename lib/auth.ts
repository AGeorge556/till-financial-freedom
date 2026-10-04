import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user's id, or a redirect to /login. getUser() verifies the token with Supabase, a network call, so it
 * runs once per page render however many layouts and pages ask (cache() does nothing in server actions: each checks itself).
 */
export const requireUserId = cache(async (): Promise<string> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
});
