import { createExecutionFact, type ExecutionFact, type ExecutionProtocol } from '@council/canonical-contracts';
import type { SourceArtifactContent } from './source-adapter';

const referenceTag = Symbol('source-identifier');
type Value = string | number | { readonly [referenceTag]: string } | Value[] | { [key: string]: Value };
interface Span { start: number; end: number; value: Value }
export interface DirectExecutionProperty { readonly fact: ExecutionFact; readonly lineStart: number; readonly lineEnd: number }
export interface DirectExecutionSource {
  readonly declarationKey: string;
  readonly maskedText: string;
  readonly properties: readonly DirectExecutionProperty[];
}
const extensions = ['executionPrincipal', 'connectivity', 'requestedScopes'];
const forbidden = ['grantedScopes', 'roles', 'permissions', 'authorization', 'authorizationState'];
const fail = (): never => { throw new TypeError('INVALID_DIRECT_EXECUTION_SOURCE'); };
function object(v: Value): { [key: string]: Value } {
  if (!v || typeof v !== 'object' || Array.isArray(v) || referenceTag in v) return fail();
  return v;
}
function shape(v: Value, names: string[]): { [key: string]: Value } {
  const o = object(v);
  if (Object.keys(o).length !== names.length || names.some(k => !Object.hasOwn(o, k))) fail();
  return o;
}
function literal(v: Value): string { return typeof v === 'string' ? v : fail(); }

/** Bounded literal grammar, never evaluation. No calls, spreads, computed keys or expressions. */
class Literals {
  position: number;
  readonly fields = new Map<string, Span>();
  constructor(readonly text: string, position: number) { this.position = position; }
  space() {
    while (this.position < this.text.length) {
      if (/\s/.test(this.text[this.position])) { this.position++; continue; }
      if (this.text.startsWith('//', this.position)) {
        const end = this.text.indexOf('\n', this.position); this.position = end < 0 ? this.text.length : end; continue;
      }
      break;
    }
  }
  take(c: string) { this.space(); if (this.text[this.position++] !== c) fail(); }
  word(): string {
    this.space(); const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(this.text.slice(this.position));
    if (!m) return fail(); this.position += m[0].length; return m[0];
  }
  string(): string {
    this.space(); const quote = this.text[this.position++]; let result = '';
    while (this.position < this.text.length) {
      const c = this.text[this.position++]; if (c === quote) return result;
      // Keep source references literal and auditable; escaped/continued strings are outside V1.
      if (c === '\\' || c === '\n' || c === '\r') fail(); result += c;
      if (result.length > 512) fail();
    }
    return fail();
  }
  value(depth = 0): Value {
    if (depth > 5) return fail(); this.space(); const c = this.text[this.position];
    if (c === '"' || c === "'") return this.string();
    if (c === '{') {
      this.position++; const result: { [key: string]: Value } = Object.create(null);
      this.space();
      while (this.text[this.position] !== '}') {
        const start = this.position;
        const key = /['"]/.test(this.text[this.position]) ? this.string() : this.word();
        if (Object.hasOwn(result, key) || ['__proto__', 'constructor', 'prototype'].includes(key)) fail();
        this.take(':'); const value = this.value(depth + 1); result[key] = value; this.space();
        if (this.text[this.position] === ',') this.position++;
        else if (this.text[this.position] !== '}') fail();
        if (depth === 0) this.fields.set(key, { start, end: this.position, value });
        this.space(); if (Object.keys(result).length > 64) fail();
      }
      this.position++; return result;
    }
    if (c === '[') {
      this.position++; const result: Value[] = []; this.space();
      while (this.text[this.position] !== ']') {
        result.push(this.value(depth + 1)); this.space(); if (result.length > 64) fail();
        if (this.text[this.position] === ',') this.position++;
        else if (this.text[this.position] !== ']') fail();
        this.space();
      }
      this.position++; return result;
    }
    if (/\d/.test(c ?? '')) { const n = /^\d+/.exec(this.text.slice(this.position))![0]; this.position += n.length; return Number(n); }
    return { [referenceTag]: this.word() };
  }
}

/** Source protocol is the existing closed ExecutionProtocol object, not a new string enum. */
export function validateDeclaredProtocol(endpoint: string, protocol: ExecutionProtocol): void {
  const scheme = new URL(endpoint).protocol;
  if (protocol.kind === 'API') {
    if (protocol.family === 'WEBSOCKET' ? !['ws:', 'wss:'].includes(scheme)
      : ['HTTP', 'GRPC', 'GRAPHQL'].includes(protocol.family) && !['http:', 'https:'].includes(scheme)) fail();
  } else if (protocol.transport === 'STDIO' ||
    ['STREAMABLE_HTTP', 'SERVER_SENT_EVENTS'].includes(protocol.transport) && !['http:', 'https:'].includes(scheme)) fail();
}

/** TS/JS extension only. Existing Python/flat declarations retain their original binding path. */
export function directExecutionSources(artifact: SourceArtifactContent): readonly DirectExecutionSource[] {
  if (!/\.(?:ts|js)$/.test(artifact.locator) || /'''|"""|`|\/\*|\*\/|\\\s*$/m.test(artifact.text)) return [];
  const results: DirectExecutionSource[] = [];
  for (const match of artifact.text.matchAll(/^(?:export\s+)?const ([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\{/gm)) {
    try {
      const parser = new Literals(artifact.text, match.index! + match[0].lastIndexOf('{'));
      const root = object(parser.value());
      if (root.kind !== 'agent' || forbidden.some(k => Object.hasOwn(root, k))) continue;
      // Match the existing direct declaration terminator; no casts, concatenation or property access.
      if (!/^;?[ \t]*(?:\r?\n|$)/.test(artifact.text.slice(parser.position))) continue;
      const properties: DirectExecutionProperty[] = [];
      for (const key of extensions) {
        const span = parser.fields.get(key); if (!span) continue;
        const lineStart = artifact.text.slice(0, span.start).split('\n').length;
        const lineEnd = artifact.text.slice(0, span.end).split('\n').length;
        const add = (value: ExecutionFact) => properties.push({ fact: createExecutionFact(value), lineStart, lineEnd });
        if (key === 'executionPrincipal') {
          const p = shape(span.value, ['kind', 'provider', 'authority', 'principal']);
          add({ field: 'PRINCIPAL', principal: { kind: literal(p.kind) as never, providerCode: literal(p.provider),
            authorityReference: literal(p.authority), principalReference: literal(p.principal) } });
        } else {
          if (!Array.isArray(span.value)) fail();
          for (const item of span.value as Value[]) {
            if (key === 'requestedScopes') {
              const s = shape(item, ['scope', 'resource']);
              add({ field: 'REQUESTED_SCOPE', scopeReference: literal(s.scope), resourceReference: literal(s.resource) });
            } else {
              const c = shape(item, ['endpoint', 'protocol']);
              const p = object(c.protocol); const protocol = p.kind === 'API'
                ? { kind: 'API' as const, family: literal(shape(c.protocol, ['kind', 'family']).family) as never }
                : { kind: literal(shape(c.protocol, ['kind', 'transport']).kind) as 'MCP', transport: literal(p.transport) as never };
              const fact = createExecutionFact({ field: 'DECLARED_CONNECTIVITY', endpoint: literal(c.endpoint) as never, protocol });
              if (fact.field !== 'DECLARED_CONNECTIVITY') throw new TypeError('INVALID_DIRECT_EXECUTION_SOURCE');
              validateDeclaredProtocol(fact.endpoint, fact.protocol); add(fact);
            }
          }
        }
      }
      let maskedText = artifact.text;
      for (const key of extensions) {
        const s = parser.fields.get(key); if (!s) continue;
        maskedText = maskedText.slice(0, s.start) + maskedText.slice(s.start, s.end).replace(/[^\r\n]/g, ' ') + maskedText.slice(s.end);
      }
      results.push({ declarationKey: match[1], maskedText, properties });
    } catch { /* Value-free fail closed; never expose a rejected source value. */ }
  }
  return results;
}
