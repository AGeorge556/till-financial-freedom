"use client";

import { useEffect, useState } from "react";
import type { PasskeyListItem } from "@supabase/supabase-js";
import { deviceName, passkeyFailure } from "@/lib/passkeys";
import { createClient } from "@/lib/supabase/client";
import { field, primaryBtn, secondaryBtn } from "./ui";
import { usePasskeySupport } from "./usePasskeySupport";

const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Cairo" });
const smallBtn = `${secondaryBtn} px-3 text-sm`;

/** Add, rename and remove this account's passkeys. Supabase holds the credentials; this only calls its auth API. */
export function PasskeySettings() {
  const supported = usePasskeySupport();
  const [passkeys, setPasskeys] = useState<PasskeyListItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  async function load() {
    const { data, error } = await createClient().auth.passkey.list();
    if (error || !data) setError("Could not load your passkeys.");
    else setPasskeys(data);
  }

  useEffect(() => {
    if (supported) load().catch(() => setError("Could not load your passkeys."));
  }, [supported]);

  // Runs one change: clears old messages, shows the outcome, refreshes the list.
  async function run(task: () => Promise<string | null>) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const failed = await task();
      if (failed) setError(failed);
      else await load();
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setBusy(false);
  }

  const add = () =>
    run(async () => {
      const supabase = createClient();
      const { data, error } = await supabase.auth.registerPasskey();
      if (error) {
        const f = passkeyFailure(error, "register");
        return f.kind === "silent" ? "" : f.text;
      }
      // A recognisable name instead of an anonymous entry; if renaming fails the passkey still works.
      if (data && !data.friendly_name) {
        await supabase.auth.passkey.update({ passkeyId: data.id, friendlyName: deviceName(navigator.userAgent) });
      }
      setStatus("Passkey added. Next time, sign in with Face ID.");
      return null;
    });

  const rename = (id: string, name: string) =>
    run(async () => {
      const { error } = await createClient().auth.passkey.update({ passkeyId: id, friendlyName: name });
      if (error) return "Could not rename the passkey.";
      setEditing(null);
      setStatus("Renamed.");
      return null;
    });

  const remove = (id: string) =>
    run(async () => {
      if (!window.confirm("Remove this passkey? You can still sign in with your password.")) return "";
      const { error } = await createClient().auth.passkey.delete({ passkeyId: id });
      if (error) return "Could not remove the passkey.";
      setStatus("Passkey removed.");
      return null;
    });

  if (!supported) return <p className="text-sm text-muted">This browser cannot use passkeys.</p>;

  return (
    <>
      <p className="mb-4 text-sm text-muted">
        A passkey lets you sign in with Face ID instead of typing your password; it stays on your devices and cannot be
        guessed. Your password still works, so you can never be locked out. On iPhone, add the passkey on the phone you
        will sign in with, from the TFF app or Safari.
      </p>

      {passkeys && passkeys.length === 0 && <p className="mb-4 text-sm">No passkeys yet.</p>}
      {passkeys && passkeys.length > 0 && (
        <ul className="mb-4 divide-y divide-border">
          {passkeys.map((p) => (
            <li key={p.id} className="py-3">
              {editing?.id === p.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (editing.name.trim()) rename(p.id, editing.name.trim());
                  }}
                >
                  <label className="text-sm text-muted" htmlFor={`name-${p.id}`}>
                    Name
                  </label>
                  <input
                    id={`name-${p.id}`}
                    value={editing.name}
                    onChange={(e) => setEditing({ id: p.id, name: e.target.value })}
                    maxLength={120}
                    required
                    className={field}
                  />
                  <div className="mt-3 flex gap-2">
                    <button type="submit" disabled={busy} className={smallBtn}>
                      Save
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className={smallBtn}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.friendly_name?.trim() || "Passkey"}</p>
                    <p className="text-sm text-muted">
                      Added {date.format(new Date(p.created_at))}
                      {p.last_used_at ? ` · Last used ${date.format(new Date(p.last_used_at))}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setEditing({ id: p.id, name: p.friendly_name ?? "" })}
                      className={smallBtn}
                    >
                      Rename
                    </button>
                    <button type="button" disabled={busy} onClick={() => remove(p.id)} className={smallBtn}>
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <button type="button" disabled={busy} onClick={add} className={primaryBtn}>
        {busy ? "Working…" : "Add a passkey on this device"}
      </button>
      <p role="alert" className={error ? "mt-3 text-negative" : "sr-only"}>
        {error}
      </p>
      <p role="status" className={status ? "mt-3 text-positive" : "sr-only"}>
        {status}
      </p>
    </>
  );
}
