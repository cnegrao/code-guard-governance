/** Private session claim: the exact DB-authored governance_users.password_changed_at. */
export const CREDENTIAL_EPOCH_CLAIM = "credential_epoch";

/** Strict zoned PostgreSQL timestamptz text (as returned by PostgREST). Returns
 * epoch milliseconds retaining sub-millisecond digits, or NaN when malformed.
 * Date.parse alone also accepts ambiguous inputs such as "123" and silently
 * normalizes invalid calendar days, so the shape and ranges are checked first. */
export function parseCredentialEpochMillis(value: unknown): number {
  const match = typeof value === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value) : null;
  if (!match) return NaN;
  const [, year, month, day, hour, minute, second, fraction = "", offsetHour, offsetMinute] = match;
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > daysInMonth ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      Number(offsetHour ?? 0) > 23 || Number(offsetMinute ?? 0) > 59) return NaN;
  // Retain sub-millisecond precision for the strict five-second skew ceiling.
  return Date.parse(value as string) + Number(`0.${fraction.slice(3) || "0"}`);
}
