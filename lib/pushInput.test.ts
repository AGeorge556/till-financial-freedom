import { describe, expect, it } from "vitest";
import { bearerMatches, parseSubscription } from "./pushInput";

const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);
const sub = (over: Record<string, unknown> = {}, keys: Record<string, unknown> = {}) => ({
  endpoint: "https://web.push.apple.com/QAbc123",
  expirationTime: null,
  keys: { p256dh: P256DH, auth: AUTH, ...keys },
  ...over,
});

describe("parseSubscription", () => {
  it("accepts what a browser gives and returns only the three stored parts", () => {
    expect(parseSubscription(sub())).toEqual({ endpoint: "https://web.push.apple.com/QAbc123", p256dh: P256DH, auth: AUTH });
  });

  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("accepts the endpoint %s", (endpoint) => {
    expect(parseSubscription(sub({ endpoint }))).not.toBeNull();
  });

  it.each([
    ["http, not https", "http://web.push.apple.com/x"],
    ["a host that only ends the same", "https://evilpush.apple.com.example.com/x"],
    ["a look-alike without the dot", "https://notpush.apple.com.evil.test/x"],
    ["an unknown host", "https://example.com/push"],
    ["a local address", "https://127.0.0.1/x"],
    ["a port", "https://web.push.apple.com:8443/x"],
    ["credentials in the URL", "https://user:pw@web.push.apple.com/x"],
    ["not a URL", "web.push.apple.com"],
    ["too long", `https://web.push.apple.com/${"a".repeat(2100)}`],
  ])("rejects %s", (_name, endpoint) => {
    expect(parseSubscription(sub({ endpoint }))).toBeNull();
  });

  it.each([
    ["a missing key", { auth: undefined }],
    ["a p256dh that is too short", { p256dh: "B".repeat(20) }],
    ["a p256dh that is too long", { p256dh: "B".repeat(200) }],
    ["an auth that is too short", { auth: "a".repeat(5) }],
    ["standard base64 instead of base64url", { auth: `${"a".repeat(20)}+/` }],
    ["padding", { auth: `${"a".repeat(22)}==` }],
    ["a number", { auth: 12345678901234567890 }],
  ])("rejects %s", (_name, keys) => {
    expect(parseSubscription(sub({}, keys))).toBeNull();
  });

  it.each([null, undefined, "x", 5, [], {}, { endpoint: "https://web.push.apple.com/x" }, { endpoint: 5, keys: {} }, sub({ keys: null })])(
    "rejects the wrong shape %#",
    (input) => {
      expect(parseSubscription(input)).toBeNull();
    },
  );
});

describe("bearerMatches", () => {
  it("matches only the exact header", () => {
    expect(bearerMatches("Bearer s3cret-value", "s3cret-value")).toBe(true);
    expect(bearerMatches("Bearer s3cret-valuf", "s3cret-value")).toBe(false);
    expect(bearerMatches("Bearer s3cret-value ", "s3cret-value")).toBe(false);
    expect(bearerMatches("bearer s3cret-value", "s3cret-value")).toBe(false);
    expect(bearerMatches("s3cret-value", "s3cret-value")).toBe(false);
    expect(bearerMatches("Bearer s3cret", "s3cret-value")).toBe(false);
  });

  it("never matches when the header or the secret is missing", () => {
    expect(bearerMatches(null, "s3cret-value")).toBe(false);
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer undefined", undefined)).toBe(false);
    expect(bearerMatches("Bearer ", undefined)).toBe(false);
  });
});
