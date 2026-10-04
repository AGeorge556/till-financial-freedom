"use client";

import { startTransition, useActionState, useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import type { ActionState } from "@/app/actions/shared";

const IDLE: ActionState = {};

/**
 * A form wired to a server action. Submits through onSubmit rather than the form's `action` prop because
 * React resets every uncontrolled field after an `action` finishes, even on a validation error, which would
 * wipe what the person typed. Here fields are only cleared on success, and only when `reset` is set.
 */
export function Form({
  action,
  onSuccess,
  reset,
  confirm,
  className,
  children,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  onSuccess?: () => void;
  reset?: boolean;
  confirm?: string;
  className?: string;
  children: (state: { pending: boolean; saved: boolean }) => ReactNode;
}) {
  const [state, dispatch, pending] = useActionState(action, IDLE);
  const ref = useRef<HTMLFormElement>(null);
  const errorId = useId();
  // Every action result is a new object, so a repeat success still re-fires the effect.
  const saved = state !== IDLE && !state.error;

  useEffect(() => {
    if (!saved) return;
    if (reset) ref.current?.reset();
    onSuccess?.();
  }, [state]);

  // The browser's own checks (required, date, max) mark the field invalid for screen readers; typing clears it.
  useEffect(() => {
    const form = ref.current;
    if (!form) return;
    const mark = (e: Event) => (e.target as Element).setAttribute("aria-invalid", "true");
    const clear = (e: Event) => (e.target as Element).removeAttribute("aria-invalid");
    form.addEventListener("invalid", mark, true);
    form.addEventListener("input", clear);
    form.addEventListener("change", clear);
    return () => {
      form.removeEventListener("invalid", mark, true);
      form.removeEventListener("input", clear);
      form.removeEventListener("change", clear);
    };
  }, []);

  // A server error names no field, so it is linked to every text field and select of the form.
  useEffect(() => {
    const fields = ref.current?.querySelectorAll("input:not([type=hidden], [type=radio], [type=checkbox]), select, textarea");
    fields?.forEach((el) => {
      const ids = (el.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id && id !== errorId);
      if (state.error) ids.push(errorId);
      if (ids.length > 0) el.setAttribute("aria-describedby", ids.join(" "));
      else el.removeAttribute("aria-describedby");
    });
  }, [state.error, errorId]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || (confirm && !window.confirm(confirm))) return;
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  }

  return (
    <form ref={ref} onSubmit={submit} className={className} aria-busy={pending || undefined}>
      {children({ pending, saved: saved && !pending })}
      {/* Both regions stay mounted so a screen reader announces the text when it appears. */}
      <p id={errorId} role="alert" className={state.error ? "mt-3 text-negative" : "sr-only"}>
        {state.error}
      </p>
      <span role="status" className="sr-only">
        {pending ? "Working, please wait." : ""}
      </span>
    </form>
  );
}
