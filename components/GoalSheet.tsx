"use client";

import { useState, type ReactNode } from "react";
import { Sheet } from "./Sheet";

/** A button that opens a sheet. Only client components can use it: the children are a function of `close`. */
export function GoalSheet({
  trigger,
  title,
  className,
  children,
}: {
  trigger: ReactNode;
  title: string;
  className: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {trigger}
      </button>
      <Sheet open={open} onClose={close} label={title}>
        <h2 className="mr-11 mb-5 text-lg font-semibold tracking-tight">{title}</h2>
        {children(close)}
      </Sheet>
    </>
  );
}
