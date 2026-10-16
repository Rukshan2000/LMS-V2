// All class times are Sri Lanka local time (UTC+05:30, no daylight saving).
export const TIME_ZONE = 'Asia/Colombo';

/** Today's date in Sri Lanka as YYYY-MM-DD. */
export const colomboToday = (now = new Date()) =>
  new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
