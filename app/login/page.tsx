import { connection } from "next/server";
import { passkeysEnabled } from "@/lib/supabase/settings";
import { LoginForm } from "./LoginForm";

export default async function Page() {
  // Per request, so a freshly switched-on passkey setting is not stuck behind a prerendered page.
  await connection();
  return <LoginForm passkeys={await passkeysEnabled()} />;
}
