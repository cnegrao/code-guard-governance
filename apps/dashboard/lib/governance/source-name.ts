/** Presentation only: source declarations never become governed display names. */
export const SOURCE_NAME_LABEL = 'source name (not governed)';

const NAME_FIELDS: Record<string, readonly string[]> = {
  AGENT: ['agentCode', 'displayName'], AGENT_VERSION: ['versionCode', 'displayName'],
  MODEL: ['modelReference', 'displayName'], TOOL: ['declarationKey', 'displayName'],
  PROMPT: ['declarationKey', 'displayName'], API: ['apiReference', 'displayName'],
  MCP_SERVER: ['serverReference', 'displayName'], KNOWLEDGE_BASE: ['sourceReference', 'displayName'],
  DATA_ASSET: ['sourceReference', 'displayName'], DATA_ELEMENT: ['elementPath', 'displayName'],
  SKILL: ['declarationReference', 'displayName'],
};

export function sourceName(kind: string, identity: unknown): string | null {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return null;
  const fields = identity as Record<string, unknown>;
  for (const field of NAME_FIELDS[kind] ?? []) {
    const value = fields[field];
    if (typeof value === 'string' && value.trim() && !['UNKNOWN', 'NOT_EVIDENCED'].includes(value.trim())) return value.trim();
  }
  // A version without a declared version name is identified by its source file,
  // never by an invented versionCode or an assumed current version.
  if (kind === 'AGENT_VERSION') {
    const agent = fields.agent as { referenceKind?: unknown; sourceObject?: { externalId?: unknown } } | undefined;
    const path = agent?.referenceKind === 'SOURCE_OBJECT' ? agent.sourceObject?.externalId : undefined;
    if (typeof path === 'string' && path.trim()) return path;
  }
  return null;
}

export function combineSourceNames(names: readonly (string | null)[]): string | null {
  const values = [...new Set(names.filter((name): name is string => name !== null))].sort();
  return values.length ? values.join(' · ') : null;
}
