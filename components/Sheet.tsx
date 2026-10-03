"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Bottom sheet on a phone, centred dialog from 768px. Children mount only while open, so closing resets them. */
export function Sheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Same tick as the tap that opened it, so iOS still raises the keyboard.
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-surface p-0 text-foreground backdrop:bg-black/50 md:m-auto md:max-w-md md:rounded-2xl"
    >
      <div className="relative p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-2 right-2 grid size-11 place-items-center rounded-full text-muted hover:text-foreground"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        {open && children}
      </div>
    </dialog>
  );
}
