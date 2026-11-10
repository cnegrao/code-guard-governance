/** Route segments may retain their URI escapes during client navigation.
 * Unwrap one transport layer before encoding the opaque ID for an API path.
 * Malformed input remains opaque and is handled by the ordinary not-found path. */
export function reviewSubjectIdFromRouteParam(value: string): string {
  try { return decodeURIComponent(value); }
  catch { return value; }
}
