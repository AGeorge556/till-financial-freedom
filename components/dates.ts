// Fixed locale and UTC so server and client render the same text for a YYYY-MM-DD date.
const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export const formatDay = (iso: string) => day.format(at(iso));
export const formatWeekday = (iso: string) => weekday.format(at(iso));
export const formatMonthYear = (iso: string) => monthYear.format(at(iso));
export const formatRange = (start: string, end: string) => `${formatDay(start)} – ${formatDay(end)}`;
