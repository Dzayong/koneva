/**
 * Audit filters are picked as calendar days in Asia/Jakarta (WIB, UTC+7, no daylight saving). The API wants explicit UTC
 * instants: a WIB day is [00:00 WIB, 00:00 WIB next day), i.e. start inclusive and end EXCLUSIVE, never 23:59:59.
 */
const WIB_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

function wibMidnightUtc(isoDate: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error("invalid date");
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - WIB_OFFSET_MS;
}

/** First instant (inclusive) of the given WIB day, as a UTC ISO string. */
export const wibDayStartUtc = (isoDate: string): string => new Date(wibMidnightUtc(isoDate)).toISOString();

/** First instant of the day AFTER the given WIB day (exclusive end of that day), as a UTC ISO string. */
export const wibDayEndExclusiveUtc = (isoDate: string): string => new Date(wibMidnightUtc(isoDate) + DAY_MS).toISOString();
