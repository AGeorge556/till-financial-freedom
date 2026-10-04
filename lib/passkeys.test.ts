import { describe, expect, it } from "vitest";
import { deviceName, parsePasskeysEnabled, passkeyFailure } from "./passkeys";

describe("parsePasskeysEnabled", () => {
  it("is true only for a literal true", () => {
    expect(parsePasskeysEnabled({ passkeys_enabled: true })).toBe(true);
    expect(parsePasskeysEnabled({ passkeys_enabled: false })).toBe(false);
    expect(parsePasskeysEnabled({ passkeys_enabled: "true" })).toBe(false);
    expect(parsePasskeysEnabled({ external: {} })).toBe(false);
    expect(parsePasskeysEnabled(null)).toBe(false);
    expect(parsePasskeysEnabled("passkeys_enabled")).toBe(false);
  });
});

describe("passkeyFailure", () => {
  it("stays silent when the ceremony was aborted", () => {
    expect(passkeyFailure({ name: "WebAuthnError", code: "ERROR_CEREMONY_ABORTED" }, "signIn")).toEqual({ kind: "silent" });
  });

  it("treats NotAllowedError as a hint on sign-in and as a plain cancel on register", () => {
    const e = { name: "NotAllowedError", code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" };
    expect(passkeyFailure(e, "signIn").kind).toBe("hint");
    expect(passkeyFailure(e, "register")).toEqual({ kind: "silent" });
  });

  it("explains known failures and falls back to a generic message that points at the password", () => {
    expect(passkeyFailure({ code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" }, "register")).toMatchObject({ kind: "error" });
    expect(passkeyFailure({ code: "webauthn_challenge_expired" }, "signIn")).toMatchObject({ text: "That took too long. Please try again." });
    const generic = passkeyFailure({ name: "AuthApiError", code: "something_new" }, "signIn");
    expect(generic).toMatchObject({ kind: "error" });
    expect(generic.kind === "error" && generic.text).toMatch(/password/);
  });
});

describe("deviceName", () => {
  it("names the common devices", () => {
    expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15")).toBe("iPhone");
    expect(deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("Mac");
    expect(deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows PC");
    expect(deviceName("curl/8")).toBe("This device");
  });
});
