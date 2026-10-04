import { describe, expect, it } from "vitest";
import { config } from "./proxy";

// Next compiles the matcher with path-to-regexp; anchoring the same source by hand is close enough to check which paths skip the session check.
const runs = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

describe("proxy matcher", () => {
  it.each(["/sw.js", "/api/cron/reminders", "/manifest.webmanifest", "/icon/192", "/_next/static/chunk.js", "/logo.png"])(
    "lets %s through without a session",
    (path) => expect(runs(path)).toBe(false),
  );

  it.each([
    "/",
    "/login",
    "/more",
    "/more/reminders",
    "/more/backup/export",
    "/api/cron/reminders/extra",
    "/api/cron/reminders2",
    "/api/cron",
    "/api/other",
    "/sw.json",
    "/sw.js/x",
    "/x/sw.js",
  ])("keeps %s behind sign-in", (path) => expect(runs(path)).toBe(true));
});
