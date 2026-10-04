"use client";

import { useState, type ReactNode } from "react";
import { archiveHolding, createHolding, unarchiveHolding, updateHolding } from "@/app/actions/holdings";
import {
  addCorporateAction,
  addPriceUpdate,
  buyHolding,
  recordDividend,
  sellHolding,
  voidInvestmentTransaction,
} from "@/app/actions/investments";
import { KARATS } from "@/lib/finance-core/gold";
import { parseEGP, type Piasters } from "@/lib/finance-core/money";
import { dividendCash, purchaseCash, saleCash } from "@/lib/finance-core/portfolio";
import { Amount } from "./Amount";
import { Form } from "./Form";
import { GOLD_FORM_LABEL, KIND_LABEL } from "./HoldingFormat";
import type { AccountOption } from "./TransactionForm";
import { Field, field, primaryBtn, secondaryBtn } from "./ui";

/** `kind` is optional so older callers keep working; without it a holding is treated as unit-based. */
export type HoldingOption = { id: string; name: string; ticker: string | null; accountId: string; kind?: keyof typeof KIND_LABEL };

const holdingLabel = (h: HoldingOption) => (h.ticker ? `${h.name} (${h.ticker})` : h.name);

export const Saved = ({ show, children }: { show: boolean; children: ReactNode }) =>
  show && (
    <p role="status" className="mt-3 text-positive">
      {children}
    </p>
  );

/** A fixed holding travels as a hidden field; with several to choose from it is a select. */
function HoldingPicker({
  holdings,
  value,
  onChange,
}: {
  holdings: HoldingOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (holdings.length === 1) return <input type="hidden" name="holdingId" value={holdings[0].id} />;
  return (
    <Field label="Holding">
      <select name="holdingId" value={value} onChange={(e) => onChange(e.target.value)} required className={field}>
        {holdings.map((h) => (
          <option key={h.id} value={h.id}>
            {holdingLabel(h)}
          </option>
        ))}
      </select>
    </Field>
  );
}

export const decimalInput = { inputMode: "decimal", autoComplete: "off" } as const;

/** Piasters from a typed amount: blank is 0, not an amount is null. Same parser the server action uses. */
const optionalMoney = (text: string): Piasters | null => (text.trim() === "" ? 0 : parseEGP(text));

/** What the cash will be, from the engine, or null while the fields are not a valid trade yet. */
function tradeCash(buy: boolean, quantity: string, price: string, fee: string, tax: string): Piasters | null {
  const f = optionalMoney(fee);
  const t = optionalMoney(tax);
  if (f === null || t === null) return null;
  try {
    return buy ? purchaseCash(quantity.trim(), price.trim(), f) : saleCash(quantity.trim(), price.trim(), f, t);
  } catch {
    return null;
  }
}

/** Buy or sell. With one holding it is fixed (holding page); with several it is picked (Quick Add). */
export function TradeForm({
  side,
  holdings,
  accounts,
  today,
  autoFocus,
  onDone,
}: {
  side: "buy" | "sell";
  holdings: HoldingOption[];
  accounts: AccountOption[];
  today: string;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const buy = side === "buy";
  const [holdingId, setHoldingId] = useState(holdings[0].id);
  const holding = holdings.find((h) => h.id === holdingId) ?? holdings[0];
  const gold = holding.kind === "gold";
  // Cash defaults to the holding's own account (Thndr); picking another account sticks until the holding changes.
  const [pickedAccount, setPickedAccount] = useState<string | null>(null);
  const wanted = pickedAccount ?? holding.accountId;
  const accountId = accounts.some((a) => a.id === wanted) ? wanted : (accounts[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [tax, setTax] = useState("");
  const [note, setNote] = useState("");
  const cash = tradeCash(buy, quantity, price, fee, tax);

  const clear = () => {
    setQuantity("");
    setPrice("");
    setFee("");
    setTax("");
    setNote("");
  };

  return (
    <Form
      action={buy ? buyHolding : sellHolding}
      onSuccess={() => {
        clear();
        onDone?.();
      }}
    >
      {({ pending, saved }) => (
        <>
          <HoldingPicker
            holdings={holdings}
            value={holding.id}
            onChange={(id) => {
              setHoldingId(id);
              setPickedAccount(null);
            }}
          />
          <Field label={gold ? "Weight (grams)" : "Quantity"} className={holdings.length > 1 ? "mt-4" : ""}>
            <input
              name="quantity"
              {...decimalInput}
              required
              autoFocus={autoFocus}
              data-autofocus={autoFocus ? "" : undefined}
              placeholder="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={field}
            />
          </Field>
          <Field label={gold ? (buy ? "Metal price per gram (EGP)" : "Price per gram (EGP)") : "Price per unit (EGP)"} className="mt-4">
            <input
              name="unitPrice"
              {...decimalInput}
              required
              placeholder="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={field}
            />
          </Field>
          <Field label={gold && buy ? "Workmanship fee (EGP, optional)" : "Fee (EGP, optional)"} className="mt-4">
            <input name="fee" {...decimalInput} placeholder="0" value={fee} onChange={(e) => setFee(e.target.value)} className={field} />
          </Field>
          {gold && buy && (
            <p className="mt-2 text-sm text-muted">
              Workmanship is part of what the piece cost you. It is not spending, and the piece is valued at the buy-back
              price, so it shows that much as a loss at first.
            </p>
          )}
          {!buy && (
            <Field label="Tax withheld (EGP, optional)" className="mt-4">
              <input
                name="taxWithheld"
                {...decimalInput}
                placeholder="0"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
                className={field}
              />
            </Field>
          )}
          <p aria-live="polite" className="mt-4 min-h-6">
            {cash !== null && (
              <>
                <span className="text-muted">{buy ? "You will pay " : "You will receive "}</span>
                <Amount value={cash} showPiasters className="font-semibold" />
                <span className="text-sm text-muted">
                  {buy ? ` (${gold ? "workmanship" : "the fee"} is added to your cost, it is not spending)` : " (after fee and tax)"}
                </span>
              </>
            )}
          </p>
          <Field label={buy ? "Paid from" : "Cash goes to"} className="mt-2">
            <select name="accountId" value={accountId} onChange={(e) => setPickedAccount(e.target.value)} required className={field}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date" className="mt-4">
            <input type="date" name="date" required defaultValue={today} className={field} />
          </Field>
          <Field label="Note (optional, no amounts)" className="mt-4">
            <input name="note" autoComplete="off" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
            {pending ? "Saving…" : buy ? "Record purchase" : "Record sale"}
          </button>
          <Saved show={saved}>{buy ? "Purchase recorded." : "Sale recorded."}</Saved>
        </>
      )}
    </Form>
  );
}

export function DividendForm({ holdingId, accountId, accounts, today }: { holdingId: string; accountId: string; accounts: AccountOption[]; today: string }) {
  const [gross, setGross] = useState("");
  const [tax, setTax] = useState("");
  const [note, setNote] = useState("");
  const g = parseEGP(gross);
  const t = optionalMoney(tax);
  let net: Piasters | null = null;
  if (g !== null && t !== null) {
    try {
      net = dividendCash(g, t);
    } catch {}
  }

  return (
    <Form
      action={recordDividend}
      onSuccess={() => {
        setGross("");
        setTax("");
        setNote("");
      }}
    >
      {({ pending, saved }) => (
        <>
          <input type="hidden" name="holdingId" value={holdingId} />
          <Field label="Dividend before tax (EGP)">
            <input name="gross" {...decimalInput} required placeholder="0" value={gross} onChange={(e) => setGross(e.target.value)} className={field} />
          </Field>
          <Field label="Tax withheld (EGP, optional)" className="mt-4">
            <input name="taxWithheld" {...decimalInput} placeholder="0" value={tax} onChange={(e) => setTax(e.target.value)} className={field} />
          </Field>
          <p aria-live="polite" className="mt-4 min-h-6">
            {net !== null && (
              <>
                <span className="text-muted">You will receive </span>
                <Amount value={net} showPiasters className="font-semibold" />
              </>
            )}
          </p>
          <Field label="Cash goes to" className="mt-2">
            <select name="accountId" defaultValue={accountId} required className={field}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date" className="mt-4">
            <input type="date" name="date" required defaultValue={today} className={field} />
          </Field>
          <Field label="Note (optional, no amounts)" className="mt-4">
            <input name="note" autoComplete="off" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
            {pending ? "Saving…" : "Record dividend"}
          </button>
          <Saved show={saved}>Dividend recorded.</Saved>
        </>
      )}
    </Form>
  );
}

/** A new price for the holding. Prices are only ever added, so fixing a wrong one means adding a newer one. */
export function PriceForm({
  holdings,
  today,
  autoFocus,
  onDone,
}: {
  holdings: HoldingOption[];
  today: string;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const [holdingId, setHoldingId] = useState(holdings[0].id);
  return (
    <Form action={addPriceUpdate} reset onSuccess={onDone}>
      {({ pending, saved }) => (
        <>
          <HoldingPicker holdings={holdings} value={holdingId} onChange={setHoldingId} />
          <Field label="Price per unit now (EGP)" className={holdings.length > 1 ? "mt-4" : ""}>
            <input
              name="price"
              {...decimalInput}
              required
              autoFocus={autoFocus}
              data-autofocus={autoFocus ? "" : undefined}
              placeholder="0"
              className={field}
            />
          </Field>
          <Field label="Price date" className="mt-4">
            <input type="date" name="date" required max={today} defaultValue={today} className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save price"}
          </button>
          <Saved show={saved}>Price saved.</Saved>
        </>
      )}
    </Form>
  );
}

const ACTION_HINT = {
  BONUS: "Free extra units. Your total cost stays the same, so your average cost per unit goes down.",
  SPLIT: "Each unit becomes several (or fewer, for a reverse split). Your total cost stays the same.",
  WRITE_OFF: "The holding is worth nothing. Units and cost go to zero, and the remaining cost is recorded as a loss.",
} as const;
type ActionKind = keyof typeof ACTION_HINT;

export function CorporateActionForm({ holdingId, today, writeOffOnly }: { holdingId: string; today: string; writeOffOnly?: boolean }) {
  // BONUS is first, so it is what a form reset returns the select to (a write-off-only form has no select).
  const first: ActionKind = writeOffOnly ? "WRITE_OFF" : "BONUS";
  const [kind, setKind] = useState<ActionKind>(first);
  return (
    <Form
      action={addCorporateAction}
      reset
      onSuccess={() => setKind(first)}
      confirm={kind === "WRITE_OFF" ? "Write this holding off? It cannot be undone, but you can record a purchase later." : undefined}
    >
      {({ pending, saved }) => (
        <>
          <input type="hidden" name="holdingId" value={holdingId} />
          {writeOffOnly ? (
            <input type="hidden" name="kind" value="WRITE_OFF" />
          ) : (
            <Field label="What happened">
              <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as ActionKind)} className={field}>
                <option value="BONUS">Bonus units</option>
                <option value="SPLIT">Split</option>
                <option value="WRITE_OFF">Write-off</option>
              </select>
            </Field>
          )}
          <p className="mt-2 text-sm text-muted">{writeOffOnly ? "Lost or worthless. Grams and cost go to zero, and the remaining cost is recorded as a loss." : ACTION_HINT[kind]}</p>
          {kind === "BONUS" && (
            <Field label="Bonus units received" className="mt-4">
              <input name="quantity" {...decimalInput} required placeholder="0" className={field} />
            </Field>
          )}
          {kind === "SPLIT" && (
            <Field label="Split ratio (2 for 2-for-1, 0.5 for a reverse split)" className="mt-4">
              <input name="ratio" {...decimalInput} required placeholder="2" className={field} />
            </Field>
          )}
          <Field label="Date" className="mt-4">
            <input type="date" name="date" required defaultValue={today} className={field} />
          </Field>
          <Field label="Note (optional, no amounts)" className="mt-4">
            <input name="note" autoComplete="off" maxLength={500} className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
            {pending ? "Saving…" : "Record"}
          </button>
          <Saved show={saved}>Recorded.</Saved>
        </>
      )}
    </Form>
  );
}

export function AddHoldingForm({ accounts, today }: { accounts: { id: string; name: string }[]; today: string }) {
  const [kind, setKind] = useState<keyof typeof KIND_LABEL>("stock");
  const gold = kind === "gold";
  const cloud = kind === "cloud";
  return (
    <Form action={createHolding} reset onSuccess={() => setKind("stock")}>
      {({ pending, saved }) => (
        <>
          <Field label="Type">
            <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as keyof typeof KIND_LABEL)} className={field}>
              <option value="stock">{KIND_LABEL.stock}</option>
              <option value="fund">{KIND_LABEL.fund} (a gold fund bought on a broker is a fund)</option>
              <option value="gold">Gold you hold (bars, coins, jewelry)</option>
              <option value="cloud">{KIND_LABEL.cloud}</option>
              <option value="other">{KIND_LABEL.other}</option>
            </select>
          </Field>
          <Field label="Name" className="mt-4">
            <input name="name" required maxLength={80} autoComplete="off" className={field} />
          </Field>
          {!gold && !cloud && (
            <Field label="Ticker (optional)" className="mt-4">
              <input name="ticker" maxLength={20} autoComplete="off" autoCapitalize="characters" className={field} />
            </Field>
          )}
          {gold && (
            <>
              <Field label="Karat" className="mt-4">
                <select name="karat" defaultValue="21" className={field}>
                  {KARATS.map((k) => (
                    <option key={k} value={k}>
                      {k}K
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Form" className="mt-4">
                <select name="form" defaultValue="bar" className={field}>
                  {Object.entries(GOLD_FORM_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="mt-2 text-sm text-muted">The karat cannot be changed later. Add one holding per karat.</p>
            </>
          )}
          {cloud && (
            <>
              <Field label="Start date" className="mt-4">
                <input type="date" name="startDate" required defaultValue={today} className={field} />
              </Field>
              <Field label="Maturity date (optional)" className="mt-4">
                <input type="date" name="maturityDate" className={field} />
              </Field>
              <Field label="Planned contribution (EGP, optional)" className="mt-4">
                <input name="contributionAmount" {...decimalInput} placeholder="0" className={field} />
              </Field>
              <Field label="How often" className="mt-4">
                <select name="contributionFrequency" defaultValue="" className={field}>
                  <option value="">Not set</option>
                  <option value="weekly">Every week</option>
                  <option value="monthly">Every month</option>
                </select>
              </Field>
              <p className="mt-2 text-sm text-muted">
                The contribution is only used for the expected value. It does not record any money moving: record each
                deposit yourself.
              </p>
            </>
          )}
          <Field label="Held in" className="mt-4">
            <select name="accountId" required className={field}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes (optional, no amounts)" className="mt-4">
            <input name="notes" autoComplete="off" maxLength={1000} className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
            {pending ? "Adding…" : "Add holding"}
          </button>
          <Saved show={saved}>Holding added. Open it to record your first purchase or deposit.</Saved>
        </>
      )}
    </Form>
  );
}

/** `ticker` undefined hides the ticker field (gold and Savings Clouds have none). */
export function HoldingEditForm({ id, name, ticker, notes }: { id: string; name: string; ticker?: string | null; notes: string | null }) {
  return (
    <Form action={updateHolding}>
      {({ pending, saved }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <Field label="Name">
            <input name="name" autoComplete="off" required maxLength={80} defaultValue={name} className={field} />
          </Field>
          {ticker !== undefined && (
            <Field label="Ticker (optional)" className="mt-4">
              <input name="ticker" autoComplete="off" maxLength={20} defaultValue={ticker ?? ""} className={field} />
            </Field>
          )}
          <Field label="Notes (optional, no amounts)" className="mt-4">
            <input name="notes" autoComplete="off" maxLength={1000} defaultValue={notes ?? ""} className={field} />
          </Field>
          <p className="mt-2 text-sm text-muted">Notes show even when amounts are hidden, so keep numbers out of them.</p>
          <button type="submit" disabled={pending} className={`mt-5 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save changes"}
          </button>
          <Saved show={saved}>Saved.</Saved>
        </>
      )}
    </Form>
  );
}

export function HoldingArchiveButton({ id, archived, canArchive }: { id: string; archived: boolean; canArchive: boolean }) {
  return (
    <Form action={archived ? unarchiveHolding : archiveHolding}>
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <button type="submit" disabled={pending || (!archived && !canArchive)} className={`w-full ${secondaryBtn}`}>
            {pending ? "Saving…" : archived ? "Restore holding" : "Archive holding"}
          </button>
        </>
      )}
    </Form>
  );
}

/** `what` names the entry ("buy of 3 Jan") so the Void buttons of a history list can be told apart. */
export function HoldingVoidButton({ id, what }: { id: string; what: string }) {
  return (
    <Form action={voidInvestmentTransaction} confirm="Void this? It stays in your history but stops counting, and your cash balance is corrected.">
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <button type="submit" disabled={pending} className="min-h-11 rounded-xl px-3 text-sm font-medium text-negative disabled:opacity-60">
            {pending ? "Voiding…" : "Void"}
            <span className="sr-only"> {what}</span>
          </button>
        </>
      )}
    </Form>
  );
}
