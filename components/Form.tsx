"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
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
  // Every action result is a new object, so a repeat success still re-fires the effect.
  const saved = state !== IDLE && !state.error;

  useEffect(() => {
    if (!saved) return;
    if (reset) ref.current?.reset();
    onSuccess?.();
  }, [state]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || (confirm && !window.confirm(confirm))) return;
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  }

  return (
    <form ref={ref} onSubmit={submit} className={className}>
      {children({ pending, saved: saved && !pending })}
      {state.error && (
        <p role="alert" className="mt-3 text-negative">
          {state.error}
        </p>
      )}
    </form>
  );
}
