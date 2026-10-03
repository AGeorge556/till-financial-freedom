"use client";

import Link from "next/link";
import { useState } from "react";
import { setAllocation, setHoldingShare } from "@/app/actions/allocations";
import { archiveGoal, createGoal, unarchiveGoal, updateGoal } from "@/app/actions/goals";
import { Amount } from "./Amount";
import { Form } from "./Form";
import { egpText, ratePercentText, sharePercentText } from "./GoalFormat";
import { KIND_LABEL } from "./HoldingFormat";
import { GoalSheet } from "./GoalSheet";
import { Field, field, primaryBtn, secondaryBtn } from "./ui";

export type GoalFormValues = {
  id: string;
  name: string;
  targetAmount: number;
  targetDate: string;
  startDate: string;
  priority: number;
  plannedMonthly: number | null;
  expectedReturnOverride: number | null;
  manualCurrent: number | null;
  notes: string | null;
  color: string | null;
  icon: string | null;
};

function GoalFields({ initial, priority, allowManual }: { initial?: GoalFormValues; priority: number; allowManual: boolean }) {
  return (
    <>
      {initial && (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="startDate" value={initial.startDate} />
          <input type="hidden" name="color" value={initial.color ?? ""} />
          <input type="hidden" name="icon" value={initial.icon ?? ""} />
        </>
      )}
      <Field label="Name">
        <input
          name="name"
          required
          maxLength={80}
          autoComplete="off"
          defaultValue={initial?.name}
          data-autofocus=""
          className={field}
        />
      </Field>
      <Field label="Target amount (EGP)" className="mt-4">
        <input
          name="targetAmount"
          inputMode="decimal"
          autoComplete="off"
          required
          placeholder="50,000"
          defaultValue={initial ? egpText(initial.targetAmount) : undefined}
          className={field}
        />
      </Field>
      <Field label="Target date" className="mt-4">
        <input name="targetDate" type="date" required defaultValue={initial?.targetDate} className={field} />
      </Field>
      <Field label="Priority (1 is the most important)" className="mt-4">
        <input
          name="priority"
          inputMode="numeric"
          autoComplete="off"
          required
          defaultValue={initial?.priority ?? priority}
          className={field}
        />
      </Field>
      <Field label="Your own monthly plan (EGP, optional)" className="mt-4">
        <input
          name="plannedMonthly"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={initial?.plannedMonthly != null ? egpText(initial.plannedMonthly) : undefined}
          className={field}
        />
      </Field>
      <p className="mt-1 text-sm text-muted">Used only when no allocation rule is aimed at this goal.</p>
      <Field label="Expected yearly return in % (optional)" className="mt-4">
        <input
          name="expectedReturn"
          inputMode="decimal"
          autoComplete="off"
          placeholder="Blank = use your linked accounts"
          defaultValue={ratePercentText(initial?.expectedReturnOverride ?? null)}
          className={field}
        />
      </Field>
      {allowManual && (
        <>
          <Field label="Amount saved so far (EGP, optional)" className="mt-4">
            <input
              name="manualCurrent"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={initial?.manualCurrent != null ? egpText(initial.manualCurrent) : undefined}
              className={field}
            />
          </Field>
          <p className="mt-1 text-sm text-muted">Shown as manual. Setting money aside from an account replaces it.</p>
        </>
      )}
      <Field label="Notes (optional)" className="mt-4">
        <input name="notes" maxLength={1000} autoComplete="off" defaultValue={initial?.notes ?? ""} className={field} />
      </Field>
    </>
  );
}

export function NewGoalButton({ nextPriority }: { nextPriority: number }) {
  return (
    <GoalSheet
      trigger="New goal"
      title="New goal"
      className="min-h-11 rounded-xl bg-foreground px-4 font-semibold text-background"
    >
      {(close) => (
        <Form action={createGoal} onSuccess={close}>
          {({ pending }) => (
            <>
              <GoalFields priority={nextPriority} allowManual />
              <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
                {pending ? "Adding…" : "Add goal"}
              </button>
            </>
          )}
        </Form>
      )}
    </GoalSheet>
  );
}

export function EditGoalButton({ goal, hasAllocations }: { goal: GoalFormValues; hasAllocations: boolean }) {
  return (
    <GoalSheet trigger="Edit goal" title="Edit goal" className={`w-full ${secondaryBtn}`}>
      {(close) => (
        <Form action={updateGoal} onSuccess={close}>
          {({ pending }) => (
            <>
              <GoalFields initial={goal} priority={goal.priority} allowManual={!hasAllocations} />
              <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
                {pending ? "Saving…" : "Save changes"}
              </button>
            </>
          )}
        </Form>
      )}
    </GoalSheet>
  );
}

export function ArchiveGoalButton({ id, archived }: { id: string; archived: boolean }) {
  return (
    <Form action={archived ? unarchiveGoal : archiveGoal}>
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <button type="submit" disabled={pending} className={`w-full ${secondaryBtn}`}>
            {archived ? "Restore goal" : "Archive goal"}
          </button>
        </>
      )}
    </Form>
  );
}

export type AllocationAccount = { id: string; name: string; archived: boolean; current: number; free: number };

/** Earmarks money on an account for the goal. setAllocation takes the NEW TOTAL for the pair; 0 releases it. */
export function AllocationForm({ goalId, accounts }: { goalId: string; accounts: AllocationAccount[] }) {
  const [accountId, setAccountId] = useState(accounts.find((a) => !a.archived)?.id ?? accounts[0]?.id ?? "");
  // Remounts the amount box after a save, without resetting the chosen account.
  const [saves, setSaves] = useState(0);
  const selected = accounts.find((a) => a.id === accountId);

  if (accounts.length === 0) {
    return (
      <p className="text-muted">
        You have no cash accounts to set money aside from.{" "}
        <Link href="/more/accounts" className="underline">
          Add an account
        </Link>
        .
      </p>
    );
  }

  return (
    <Form action={setAllocation} onSuccess={() => setSaves((n) => n + 1)}>
      {({ pending, saved }) => (
        <>
          <input type="hidden" name="goalId" value={goalId} />
          <p className="mb-4 text-sm text-muted">
            This earmarks money for the goal. It does not move it: your account balance and net worth stay the same.
          </p>
          <Field label="Account">
            <select name="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={field}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </Field>
          {selected && (
            <p className="mt-2 text-sm text-muted">
              Earmarked for this goal: <Amount value={selected.current} />. Free on this account:{" "}
              <Amount value={selected.free} />.
            </p>
          )}
          <Field label="New total to earmark from this account (EGP, 0 to release it)" className="mt-4">
            <input
              key={saves}
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              required
              className={field}
            />
          </Field>
          <button type="submit" disabled={pending} className={`mt-4 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save allocation"}
          </button>
          {saved && (
            <p role="status" className="mt-3 text-positive">
              Saved.
            </p>
          )}
        </>
      )}
    </Form>
  );
}

export type ShareHolding = {
  id: string;
  name: string;
  kind: keyof typeof KIND_LABEL;
  archived: boolean;
  value: number;
  /** This goal's share now, a decimal fraction string ("0" = none). */
  current: string;
  /** The part of the holding no goal has claimed, a decimal fraction string. */
  freeShare: string;
};

/** Earmarks a percentage of a holding for the goal. setHoldingShare takes the NEW share for the pair; 0 releases it. */
export function HoldingShareForm({ goalId, holdings }: { goalId: string; holdings: ShareHolding[] }) {
  const [holdingId, setHoldingId] = useState(holdings.find((h) => !h.archived)?.id ?? holdings[0]?.id ?? "");
  const [saves, setSaves] = useState(0);
  const selected = holdings.find((h) => h.id === holdingId);

  if (holdings.length === 0) {
    return (
      <p className="text-muted">
        You have no holdings to fund this goal from.{" "}
        <Link href="/investments" className="underline">
          Add one in Investments
        </Link>
        .
      </p>
    );
  }

  return (
    <Form action={setHoldingShare} onSuccess={() => setSaves((n) => n + 1)}>
      {({ pending, saved }) => (
        <>
          <input type="hidden" name="goalId" value={goalId} />
          <p className="mb-4 text-sm text-muted">
            This earmarks a share of a holding for the goal. It does not move money: your balances and net worth stay the
            same. The goal&apos;s value follows the holding&apos;s value, up and down.
          </p>
          <Field label="Holding">
            <select name="holdingId" value={holdingId} onChange={(e) => setHoldingId(e.target.value)} className={field}>
              {holdings.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({KIND_LABEL[h.kind].toLowerCase()}){h.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </Field>
          {selected && (
            <p className="mt-2 text-sm text-muted">
              Worth <Amount value={selected.value} /> now. This goal has {sharePercentText(selected.current)}%. Not claimed by
              any goal: {sharePercentText(selected.freeShare)}%.
            </p>
          )}
          <Field label="New share of this holding for the goal (%, 0 to release it)" className="mt-4">
            <input key={saves} name="percent" inputMode="decimal" autoComplete="off" placeholder="0" required className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-4 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save share"}
          </button>
          {saved && (
            <p role="status" className="mt-3 text-positive">
              Saved.
            </p>
          )}
        </>
      )}
    </Form>
  );
}
