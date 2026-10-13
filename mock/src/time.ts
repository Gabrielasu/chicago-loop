/** Chicago local time, which is what Train Tracker uses for every timestamp. */

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
});

export interface ChicagoTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday */
  weekday: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function chicagoTime(date: Date): ChicagoTime {
  const parts: Record<string, string> = {};
  for (const p of formatter.formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday ?? "Sun"),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** yyyy-MM-ddTHH:mm:ss in Chicago time, as in Train Tracker JSON output. */
export function ctaTimestamp(date: Date): string {
  const t = chicagoTime(date);
  return `${t.year}-${pad(t.month)}-${pad(t.day)}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`;
}

/**
 * The service day a moment belongs to and the seconds since its start.
 *
 * Service days run from 03:00 to 03:00 Chicago time, so a train at 00:40 is still
 * on the previous day's timetable (hours 24 to 27).
 */
export function serviceClock(date: Date): { seconds: number; weekend: boolean; dayKey: string } {
  const t = chicagoTime(date);
  let seconds = t.hour * 3600 + t.minute * 60 + t.second + date.getUTCMilliseconds() / 1000;
  let weekday = t.weekday;
  let dayKey = `${t.year}-${pad(t.month)}-${pad(t.day)}`;
  if (t.hour < 3) {
    seconds += 24 * 3600;
    weekday = (weekday + 6) % 7;
    const prev = new Date(date.getTime() - 24 * 3600 * 1000);
    const p = chicagoTime(prev);
    dayKey = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  }
  return { seconds, weekend: weekday === 0 || weekday === 6, dayKey };
}
