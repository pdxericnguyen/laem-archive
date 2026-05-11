const DEFAULT_LAEM_TIME_ZONE = "America/Los_Angeles";

function getConfiguredTimeZone() {
  const env = typeof process !== "undefined" ? process.env : undefined;
  return env?.NEXT_PUBLIC_LAEM_TIME_ZONE || env?.LAEM_TIME_ZONE || DEFAULT_LAEM_TIME_ZONE;
}

function normalizeTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return value;
  } catch {
    return DEFAULT_LAEM_TIME_ZONE;
  }
}

export const LAEM_TIME_ZONE = normalizeTimeZone(getConfiguredTimeZone());

const LAEM_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: LAEM_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short"
};

type DateParts = {
  year: number;
  month: number;
  day: number;
};

function getZonedParts(date: Date): DateParts & { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LAEM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(lookup.get("year")),
    month: Number(lookup.get("month")),
    day: Number(lookup.get("day")),
    hour: Number(lookup.get("hour")),
    minute: Number(lookup.get("minute")),
    second: Number(lookup.get("second"))
  };
}

function getTimeZoneOffsetMs(date: Date) {
  const parts = getZonedParts(date);
  const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return zonedAsUtc - date.getTime();
}

function getUtcMsForLaemDateTime(parts: DateParts & { hour?: number; minute?: number; second?: number }) {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0
  );
  const firstOffset = getTimeZoneOffsetMs(new Date(utcGuess));
  const firstUtc = utcGuess - firstOffset;
  const correctedOffset = getTimeZoneOffsetMs(new Date(firstUtc));

  return correctedOffset === firstOffset ? firstUtc : utcGuess - correctedOffset;
}

function parseDateInput(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day));

  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() + 1 !== month ||
    normalized.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function addDays(parts: DateParts, days: number): DateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

export function formatDateTimeInLaemTime(date: Date | number) {
  const resolved = typeof date === "number" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", LAEM_DATE_TIME_OPTIONS).format(resolved);
}

export function formatUnixInLaemTime(unix: number) {
  return formatDateTimeInLaemTime(unix * 1000);
}

export function formatNowInLaemTime() {
  return formatDateTimeInLaemTime(new Date());
}

export function getLaemDateRangeUnix(dateInput: string) {
  const startParts = parseDateInput(dateInput);
  if (!startParts) {
    return null;
  }

  const endParts = addDays(startParts, 1);
  const startUnix = Math.floor(getUtcMsForLaemDateTime(startParts) / 1000);
  const endUnix = Math.floor(getUtcMsForLaemDateTime(endParts) / 1000) - 1;

  return {
    startUnix,
    endUnix
  };
}

export function getTodayLaemDateRangeUnix(now = new Date()) {
  const today = getZonedParts(now);
  const dateInput = [
    String(today.year).padStart(4, "0"),
    String(today.month).padStart(2, "0"),
    String(today.day).padStart(2, "0")
  ].join("-");
  return getLaemDateRangeUnix(dateInput);
}
