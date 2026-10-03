import Link from "next/link";
import { formatMonthYear, formatRange } from "@/components/dates";
import { shiftMonth } from "@/components/GoalFormat";
import { financialMonth } from "@/lib/finance-core/time";

const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;

/** The month a financial month starts in, from ?m=; anything else (or a missing value) is the current month. */
export function pickMonth(requested: string | string[] | undefined, current: string): string {
  return typeof requested === "string" && MONTH.test(requested) ? requested : current;
}

const arrow = "grid size-11 place-items-center rounded-full border border-border text-lg";

/** Previous / next financial month links. The URL carries only 'YYYY-MM'. */
export function MonthNav({
  base,
  month,
  current,
  monthStartDay,
}: {
  base: string;
  month: string;
  current: string;
  monthStartDay: number;
}) {
  const { start, end } = financialMonth(`${month}-${String(monthStartDay).padStart(2, "0")}`, monthStartDay);
  return (
    <nav aria-label="Month" className="mt-6 flex items-center justify-between gap-3">
      <Link href={`${base}?m=${shiftMonth(month, -1)}`} aria-label="Previous month" className={arrow}>
        ‹
      </Link>
      <div className="text-center">
        <p className="font-medium">{formatMonthYear(start)}</p>
        <p className="text-sm text-muted">{formatRange(start, end)}</p>
      </div>
      {month < current ? (
        <Link href={`${base}?m=${shiftMonth(month, 1)}`} aria-label="Next month" className={arrow}>
          ›
        </Link>
      ) : (
        <span aria-hidden="true" className="size-11" />
      )}
    </nav>
  );
}
