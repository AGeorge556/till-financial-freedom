import { createHash, timingSafeEqual } from "node:crypto";

/** Pure checks for the push server code: no React, Next.js or database imports, so they can be tested. */

export type PushKeys = { endpoint: string; p256dh: string; auth: string };

// The push services the major browsers use. An endpoint is a URL this server will POST to, so it must not be any address.
const PUSH_HOSTS = ["push.apple.com", "fcm.googleapis.com", "push.services.mozilla.com", "notify.windows.com"];

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Checks the JSON a browser gives for a push subscription (PushSubscription.toJSON()) and returns the parts to store, or
 * null. The keys are unpadded base64url: p256dh is a 65-byte point (87 characters), auth is 16 bytes (22 characters).
 */
export function parseSubscription(input: unknown): PushKeys | null {
  if (typeof input !== "object" || input === null) return null;
  const { endpoint, keys } = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } | null };
  if (typeof endpoint !== "string" || endpoint.length > 2048) return null;
  if (typeof keys !== "object" || keys === null) return null;
  const { p256dh, auth } = keys;
  if (typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (!BASE64URL.test(p256dh) || p256dh.length < 80 || p256dh.length > 100) return null;
  if (!BASE64URL.test(auth) || auth.length < 16 || auth.length > 32) return null;

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (!PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) return null;
  return { endpoint: url.href, p256dh, auth };
}

/** True when the Authorization header is exactly "Bearer <secret>". A missing secret never matches. Constant-time. */
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  // Hashing first gives both sides the same length, so neither the content nor the length of the secret leaks.
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
