"use client";

import { useState } from "react";
import { addRule, clearOverride, deleteRule, setOverride, updateRule } from "@/app/actions/rules";
import { setExpectedMonthly, setSavingsTarget } from "@/app/actions/settings";
import { Form } from "./Form";
import { egpText, ratePercentText } from "./GoalFormat";
import { GoalSheet } from "./GoalSheet";
import { Field, field, primaryBtn, secondaryBtn } from "./ui";

const smallBtn = `${secondaryBtn} text-sm`;

type Mode = "fixed" | "percentage" | "flexible";

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "fixed", label: "A fixed amount each month", hint: "The rules share this amount." },
  { value: "percentage", label: "A percentage of my income", hint: "The rules share this part of your income." },
  { value: "flexible", label: "Flexible", hint: "The rules share whatever is left after spending." },
];

export function SavingsTargetButton({
  mode,
  amount,
  percent,
}: {
  mode: Mode;
  amount: number | null;
  percent: number | null;
}) {
  return (
    <GoalSheet trigger="Change savings target" title="Savings target" className={`w-full ${secondaryBtn}`}>
      {(close) => <SavingsTargetForm mode={mode} amount={amount} percent={percent} onDone={close} />}
    </GoalSheet>
  );
}

function SavingsTargetForm({
  mode,
  amount,
  percent,
  onDone,
}: {
  mode: Mode;
  amount: number | null;
  percent: number | null;
  onDone: () => void;
}) {
  const [choice, setChoice] = useState<Mode>(mode);
  return (
    <Form action={setSavingsTarget} onSuccess={onDone}>
      {({ pending }) => (
        <>
          <fieldset>
            <legend className="text-sm text-muted">How much do you want to save each month?</legend>
            {MODES.map((m) => (
              <label key={m.value} className="mt-2 flex min-h-11 items-start gap-3 py-1.5">
                <input
                  type="radio"
                  name="mode"
                  value={m.value}
                  checked={choice === m.value}
                  onChange={() => setChoice(m.value)}
                  className="mt-0.5 size-5"
                />
                <span>
                  {m.label}
                  <span className="block text-sm text-muted">{m.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {choice === "fixed" && (
            <Field label="Amount each month (EGP)" className="mt-4">
              <input
                name="amount"
                inputMode="decimal"
                autoComplete="off"
                required
                defaultValue={amount === null ? undefined : egpText(amount)}
                className={field}
              />
            </Field>
          )}
          {choice === "percentage" && (
            <Field label="Percent of income" className="mt-4">
              <input
                name="percent"
                inputMode="decimal"
                autoComplete="off"
                required
                placeholder="20"
                defaultValue={ratePercentText(percent)}
                className={field}
              />
            </Field>
          )}
          <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save"}
          </button>
        </>
      )}
    </Form>
  );
}

export function ExpectedMonthlyButton({ income, spending }: { income: number | null; spending: number | null }) {
  return (
    <GoalSheet
      trigger="Change expected income and spending"
      title="Expected income and spending"
      className={`w-full ${secondaryBtn}`}
    >
      {(close) => (
        <Form action={setExpectedMonthly} onSuccess={close}>
          {({ pending }) => (
            <>
              <p className="mb-4 text-sm text-muted">
                Your plan uses these until you have 3 full months of history. After that it uses the average of your
                actual months.
              </p>
              <Field label="Expected income each month (EGP)">
                <input
                  name="income"
                  inputMode="decimal"
                  autoComplete="off"
                  defaultValue={income === null ? undefined : egpText(income)}
                  className={field}
                />
              </Field>
              <Field label="Expected spending each month (EGP)" className="mt-4">
                <input
                  name="spending"
                  inputMode="decimal"
                  autoComplete="off"
                  defaultValue={spending === null ? undefined : egpText(spending)}
                  className={field}
                />
              </Field>
              <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
                {pending ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </Form>
      )}
    </GoalSheet>
  );
}

export type RuleFormValues = {
  id: string;
  kind: "fixed" | "percentage" | "remainder";
  targetKind: "goal" | "investments" | "cash";
  goalId: string | null;
  amount: number | null;
  percent: number | null;
};

export type GoalOption = { id: string; name: string; archived: boolean };

/** `name` (what the rule funds) lets a screen reader tell the Edit buttons of a list apart. */
export function RuleButton({ rule, goals, name }: { rule?: RuleFormValues; goals: GoalOption[]; name?: string }) {
  return (
    <GoalSheet
      trigger={rule ? <>Edit<span className="sr-only"> rule for {name}</span></> : "Add a rule"}
      title={rule ? "Edit rule" : "New rule"}
      className={rule ? smallBtn : "min-h-11 rounded-xl bg-foreground px-4 font-semibold text-background"}
    >
      {(close) => <RuleForm rule={rule} goals={goals} onDone={close} />}
    </GoalSheet>
  );
}

function RuleForm({ rule, goals, onDone }: { rule?: RuleFormValues; goals: GoalOption[]; onDone: () => void }) {
  const [targetKind, setTargetKind] = useState(rule?.targetKind ?? (goals.length > 0 ? "goal" : "investments"));
  const [kind, setKind] = useState(rule?.kind ?? "fixed");
  return (
    <Form action={rule ? updateRule : addRule} onSuccess={onDone}>
      {({ pending }) => (
        <>
          {rule && <input type="hidden" name="id" value={rule.id} />}
          <Field label="Where should the money go?">
            <select
              name="targetKind"
              value={targetKind}
              onChange={(e) => setTargetKind(e.target.value as typeof targetKind)}
              className={field}
              data-autofocus=""
            >
              {goals.length > 0 && <option value="goal">A goal</option>}
              <option value="investments">Investments (not tied to a goal)</option>
              <option value="cash">Cash savings (not tied to a goal)</option>
            </select>
          </Field>
          {targetKind === "goal" && (
            <Field label="Goal" className="mt-4">
              <select name="goalId" defaultValue={rule?.goalId ?? goals.find((g) => !g.archived)?.id} className={field}>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                    {g.archived ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="How much?" className="mt-4">
            <select
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              className={field}
            >
              <option value="fixed">A fixed amount</option>
              <option value="percentage">A percentage of what is left after fixed amounts</option>
              <option value="remainder">Whatever is left (only one rule can do this)</option>
            </select>
          </Field>
          {kind === "fixed" && (
            <Field label="Amount each month (EGP)" className="mt-4">
              <input
                name="amount"
                inputMode="decimal"
                autoComplete="off"
                required
                defaultValue={rule?.amount != null ? egpText(rule.amount) : undefined}
                className={field}
              />
            </Field>
          )}
          {kind === "percentage" && (
            <Field label="Percent" className="mt-4">
              <input
                name="percent"
                inputMode="decimal"
                autoComplete="off"
                required
                placeholder="20"
                defaultValue={ratePercentText(rule?.percent ?? null)}
                className={field}
              />
            </Field>
          )}
          <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save rule"}
          </button>
        </>
      )}
    </Form>
  );
}

export function DeleteRuleButton({ id, name }: { id: string; name: string }) {
  return (
    <Form action={deleteRule} confirm="Delete this rule? Any change you made for a month goes with it.">
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <button type="submit" disabled={pending} className={`${smallBtn} text-negative`}>
            {pending ? "Deleting…" : "Delete"}
            <span className="sr-only"> rule for {name}</span>
          </button>
        </>
      )}
    </Form>
  );
}

export function OverrideButton({ ruleId, month, planned, name }: { ruleId: string; month: string; planned: number; name: string }) {
  return (
    <GoalSheet
      trigger={<>Change this month<span className="sr-only">: {name}</span></>}
      title="Change this month's amount"
      className={smallBtn}
    >
      {(close) => (
        <Form action={setOverride} onSuccess={close}>
          {({ pending }) => (
            <>
              <input type="hidden" name="ruleId" value={ruleId} />
              <input type="hidden" name="month" value={month} />
              <p className="mb-4 text-sm text-muted">
                This applies to this month only. The rule itself stays as it is, and nothing is moved.
              </p>
              <Field label="Amount for this month (EGP)">
                <input
                  name="amount"
                  inputMode="decimal"
                  autoComplete="off"
                  required
                  defaultValue={egpText(planned)}
                  className={field}
                />
              </Field>
              <button type="submit" disabled={pending} className={`mt-4 ${primaryBtn}`}>
                {pending ? "Saving…" : "Save for this month"}
              </button>
            </>
          )}
        </Form>
      )}
    </GoalSheet>
  );
}

export function ClearOverrideButton({ ruleId, month, name }: { ruleId: string; month: string; name: string }) {
  return (
    <Form action={clearOverride}>
      {({ pending }) => (
        <>
          <input type="hidden" name="ruleId" value={ruleId} />
          <input type="hidden" name="month" value={month} />
          <button type="submit" disabled={pending} className={smallBtn}>
            {pending ? "Saving…" : "Back to the rule"}
            <span className="sr-only">: {name}</span>
          </button>
        </>
      )}
    </Form>
  );
}
