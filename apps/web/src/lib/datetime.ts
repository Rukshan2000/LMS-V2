// Class times are always shown in Sri Lanka time (UTC+05:30, no DST), whatever the
// device's time zone. Day/month names come from our dictionaries: browsers' Intl data
// for Sinhala/Tamil is inconsistent (some fall back to English).
export interface Calendar {
  weekdays: string[];
  months: string[];
}

const shift = (iso?: string) => new Date(new Date(iso ?? Date.now()).getTime() + 5.5 * 3600_000);

/** YYYY-MM-DD in Sri Lanka for an ISO timestamp (default: now). */
export const colomboDate = (iso?: string) => shift(iso).toISOString().slice(0, 10);

/** HH:MM (24h) in Sri Lanka for an ISO timestamp. */
export const colomboTime = (iso: string) => shift(iso).toISOString().slice(11, 16);
export const fmtTime = colomboTime;

/** ISO weekday (1 = Monday) → localized name. */
export const weekdayName = (weekday: number, cal: Calendar) => cal.weekdays[weekday - 1] ?? '';

/** e.g. "Saturday 17 Oct" / "සෙනසුරාදා 17 ඔක්". */
export function fmtDay(iso: string, cal: Calendar) {
  const d = shift(iso);
  const isoWeekday = ((d.getUTCDay() + 6) % 7) + 1;
  return `${weekdayName(isoWeekday, cal)} ${d.getUTCDate()} ${cal.months[d.getUTCMonth()]}`;
}

export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Monday of the week containing `date`. */
export const mondayOf = (date: string) =>
  addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

/** Sri Lanka local date + time → ISO string with offset, for the API. */
export const toIso = (date: string, time: string) => `${date}T${time}:00+05:30`;

/** ISO timestamp → "YYYY-MM-DDTHH:MM" in Sri Lanka time, for <input type="datetime-local">. */
export const toLocalInput = (iso: string) => `${colomboDate(iso)}T${colomboTime(iso)}`;
/** <input type="datetime-local"> value (Sri Lanka time) → ISO string for the API. */
export const fromLocalInput = (value: string) => toIso(value.slice(0, 10), value.slice(11, 16));
