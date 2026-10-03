const TIME_ZONE = "Africa/Cairo";

/** Contributions land at the end of each financial month (ordinary annuity). The only place this is decided. */
export const CONTRIBUTION_TIMING = "end-of-month" as const;

const cairoDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function cairoToday(now: Date = new Date()): string {
  return cairoDate.format(now);
}

function checkStartDay(startDay: number): void {
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 28) {
    throw new RangeError(`Month start day must be 1-28, got ${startDay}`);
  }
}

function parse(date: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`Invalid date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isoFromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const [y, m, d] = parse(date);
  return isoFromUtc(Date.UTC(y, m - 1, d + days));
}

/** Absolute index of the financial month containing `date`: year*12 + month0 of its start. */
function periodIndex(date: string, startDay: number): number {
  const [y, m, d] = parse(date);
  return y * 12 + (m - 1) - (d < startDay ? 1 : 0);
}

function periodStart(index: number, startDay: number): string {
  return isoFromUtc(Date.UTC(Math.floor(index / 12), index % 12, startDay));
}

/** Inclusive start and end dates of the financial month containing `date`. */
export function financialMonth(date: string, startDay: number): { start: string; end: string } {
  checkStartDay(startDay);
  const index = periodIndex(date, startDay);
  return {
    start: periodStart(index, startDay),
    end: addDays(periodStart(index + 1, startDay), -1),
  };
}

/**
 * Number of end-of-financial-month contribution dates from now up to and including `targetDate`.
 * This month counts only if it has not been contributed to yet. Never negative.
 */
export function monthsRemaining(
  today: string,
  targetDate: string,
  startDay: number,
  contributedThisMonth: boolean,
): number {
  checkStartDay(startDay);
  const first = periodIndex(today, startDay) + (contributedThisMonth ? 1 : 0);
  // A period's end is on or before the target iff the next period starts on or before target + 1 day.
  const last = periodIndex(addDays(targetDate, 1), startDay) - 1;
  return Math.max(0, last - first + 1);
}
