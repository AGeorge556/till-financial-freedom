/** Pure helpers for passkey sign-in: no React, no browser, no network, so they can be tested. */

/** The auth settings endpoint reports `passkeys_enabled`; anything but a literal true counts as off. */
export function parsePasskeysEnabled(body: unknown): boolean {
  return typeof body === "object" && body !== null && (body as { passkeys_enabled?: unknown }).passkeys_enabled === true;
}

export type PasskeyFailure = { kind: "silent" } | { kind: "hint" | "error"; text: string };

/**
 * Turns an auth-js passkey error (a WebAuthnError from the browser step or an AuthError from the server step) into
 * words for the person. `silent` is for a prompt they dismissed: the page just goes back to how it was.
 */
export function passkeyFailure(error: { name?: string; code?: string }, action: "signIn" | "register"): PasskeyFailure {
  if (error.code === "ERROR_CEREMONY_ABORTED") return { kind: "silent" };
  // Safari (and others) report a dismissed prompt, a timeout and "no passkey on this device" all as NotAllowedError.
  if (error.name === "NotAllowedError") {
    return action === "register"
      ? { kind: "silent" }
      : {
          kind: "hint",
          text: "No passkey was used. If you have not added one on this device yet, sign in with your password and add it in Settings.",
        };
  }
  switch (error.code) {
    case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
      return { kind: "error", text: "This device already has a passkey for your account." };
    case "webauthn_challenge_expired":
      return { kind: "error", text: "That took too long. Please try again." };
    case "over_request_rate_limit":
      return { kind: "error", text: "Too many tries. Wait a minute and try again." };
    case "ERROR_INVALID_DOMAIN":
    case "ERROR_INVALID_RP_ID":
      return { kind: "error", text: "Passkeys are not set up for this web address." };
  }
  return {
    kind: "error",
    text: action === "signIn" ? "Could not sign in with a passkey. Use your password instead." : "Could not add the passkey. Please try again.",
  };
}

/** A recognisable default name for a new passkey, from the browser's user agent. */
export function deviceName(userAgent: string): string {
  if (/iPhone/i.test(userAgent)) return "iPhone";
  if (/iPad/i.test(userAgent)) return "iPad";
  if (/Android/i.test(userAgent)) return "Android phone";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "Mac";
  if (/Windows/i.test(userAgent)) return "Windows PC";
  return "This device";
}
