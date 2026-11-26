/** Visible copy only. Persisted organisation names and internal IDs are untouched. */
export function organisationDisplayName(name: string | undefined) {
  return name?.replace(/\b(?:CodeGuard(?: AI)?|Gov IA)\b/gi, 'GOVERNYX');
}
