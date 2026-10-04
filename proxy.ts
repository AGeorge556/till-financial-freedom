import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Refreshes the Supabase session cookie and keeps every page except /login behind sign-in. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // getUser() checks the token with Supabase; a cookie alone is not proof of a session.
  // If Supabase cannot be reached the person counts as signed out: they land on /login, never on an error page.
  let user = null;
  try {
    ({
      data: { user },
    } = await supabase.auth.getUser());
  } catch {}

  // A server action is a POST that the browser sends with fetch. A redirect here would reach it as an unexpected
  // response and show an error, so with no session it goes through: every action calls requireUserId(), whose own
  // redirect("/login") the browser follows properly.
  const isAction = request.method === "POST" && request.headers.has("next-action");
  const onLogin = request.nextUrl.pathname === "/login";
  if (!user && !onLogin && !isAction) return NextResponse.redirect(new URL("/login", request.url));
  if (user && onLogin && !isAction) return NextResponse.redirect(new URL("/", request.url));
  return response;
}

export const config = {
  // Static assets, the manifest and the icons stay public so the app can be installed before signing in.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|icon/|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|woff2?)$).*)",
  ],
};
