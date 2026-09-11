import { createHash } from 'node:crypto';
import { TRUST_STATE } from '@council/canonical-contracts';
import type { DetectionMatch, DetectionSpecification } from '../detection-specification';
import type { SourceArtifactContent } from '../source-adapter';

/** Scanner-only declaration binding. Profile persistence requires governed IDs. */
export interface SqlDataDeclaration {
  readonly sourceReference: string;
  readonly statementFingerprint: string;
  readonly elementPath?: string;
}

interface Token { kind: 'word' | 'identifier' | 'string' | 'number' | 'symbol'; raw: string; line: number }
interface Column { name: Token; type: readonly Token[] }
interface Table { name: Token[]; columns: Column[]; header: Token[]; tokens: Token[] }
const invalid = (): never => { throw new Error('UNSUPPORTED_SQL_DECLARATION'); };
const keyword = (token: Token | undefined, word: string) => token?.kind === 'word' && token.raw.toUpperCase() === word;
// PostgreSQL 18 Appendix C: reserved table/column names (including the
// TYPE_FUNC_NAME class). Quoting is required; keyword spelling is not identity.
// https://www.postgresql.org/docs/18/sql-keywords-appendix.html
const RESERVED_NAMES = new Set(`ALL ANALYSE ANALYZE AND ANY ARRAY AS ASC ASYMMETRIC
  AUTHORIZATION BINARY BOTH CASE CAST CHECK COLLATE COLLATION COLUMN CONCURRENTLY
  CONSTRAINT CREATE CROSS CURRENT_CATALOG CURRENT_DATE CURRENT_ROLE CURRENT_SCHEMA
  CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER DEFAULT DEFERRABLE DESC DISTINCT DO
  ELSE END EXCEPT FALSE FETCH FOR FOREIGN FREEZE FROM FULL GRANT GROUP HAVING ILIKE
  IN INITIALLY INNER INTERSECT INTO IS ISNULL JOIN LATERAL LEADING LEFT LIKE LIMIT
  LOCALTIME LOCALTIMESTAMP NATURAL NOT NOTNULL NULL OFFSET ON ONLY OR ORDER OUTER
  OVERLAPS PLACING PRIMARY REFERENCES RETURNING RIGHT SELECT SESSION_USER SIMILAR
  SOME SYMMETRIC SYSTEM_USER TABLE TABLESAMPLE THEN TO TRAILING TRUE UNION UNIQUE
  USER USING VARIADIC VERBOSE WHEN WHERE WINDOW WITH`.split(/\s+/));
const identifier = (token: Token | undefined): token is Token => !!token &&
  (token.kind === 'identifier' || (token.kind === 'word' && !RESERVED_NAMES.has(token.raw.toUpperCase()))) &&
  Buffer.byteLength(token.raw, 'utf8') <= 63;
/** One physical-name rule for duplicate detection and proposed semantic identity.
 * Quote only when required to preserve the effective component's exact content;
 * dots/escaped quotes stay inside their component, never qualification syntax.
 * Raw spelling belongs to evidence, not to PostgreSQL physical identity.
 */
function canonicalIdentifier(token: Token): string {
  const effective = token.kind === 'identifier'
    ? token.raw.slice(1, -1).replaceAll('""', '"') : token.raw.toLowerCase();
  return /^[a-z_][a-z0-9_$]*$/.test(effective) && !RESERVED_NAMES.has(effective.toUpperCase())
    ? effective : `"${effective.replaceAll('"', '""')}"`;
}
const reference = (name: Token[]) => name.map(canonicalIdentifier).join('.');

/** Bounded lexer: comments and quoted bodies never become SQL tokens. */
function lex(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0, line = 1;
  const advance = () => { if (text[i] === '\n' || (text[i] === '\r' && text[i + 1] !== '\n')) line++; i++; };
  while (i < text.length) {
    if (/\s/.test(text[i])) { advance(); continue; }
    if (text.startsWith('--', i)) { while (i < text.length && text[i] !== '\n' && text[i] !== '\r') advance(); continue; }
    if (text.startsWith('/*', i)) {
      i += 2;
      let depth = 1;
      while (i < text.length && depth) {
        if (text.startsWith('/*', i)) { depth++; i += 2; if (depth > 64) invalid(); }
        else if (text.startsWith('*/', i)) { depth--; i += 2; }
        else advance();
      }
      if (depth) invalid();
      continue;
    }
    const start = i, startLine = line;
    let kind: Token['kind'] = 'symbol';
    const quote = text[i];
    if (quote === "'" || quote === '"') {
      kind = quote === "'" ? 'string' : 'identifier';
      advance();
      let closed = false;
      while (i < text.length) {
        // Escape-string/backslash modes are outside this subset.
        if (text[i] === '\\' || text[i] === '\0') invalid();
        if (text[i] === quote) {
          advance();
          if (text[i] === quote) { advance(); continue; }
          closed = true; break;
        }
        advance();
      }
      if (!closed || (kind === 'identifier' && i - start === 2)) invalid();
    } else if (text[i] === '$') {
      const delimiter = text.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (!delimiter) invalid();
      kind = 'string';
      i += delimiter!.length;
      const end = text.indexOf(delimiter!, i);
      if (end < 0) invalid();
      while (i < end + delimiter!.length) advance();
    } else if (/[A-Za-z_]/.test(text[i])) {
      kind = 'word';
      while (i < text.length && /[A-Za-z0-9_$]/.test(text[i])) advance();
    } else if (/[0-9]/.test(text[i])) {
      kind = 'number';
      while (i < text.length && /[0-9]/.test(text[i])) advance();
      if (text[i] === '.' && /[0-9]/.test(text[i + 1] ?? '')) {
        advance(); while (i < text.length && /[0-9]/.test(text[i])) advance();
      }
    } else if ('(),.;[]+-*/%=<>:'.includes(text[i])) advance();
    else invalid();
    tokens.push({ kind, raw: text.slice(start, i), line: startLine });
    if (tokens.length > 100_000) invalid();
  }
  return tokens;
}

class Cursor {
  i = 0;
  constructor(readonly tokens: readonly Token[]) {}
  peek() { return this.tokens[this.i]; }
  symbol(value: string) { if (this.peek()?.raw !== value || this.peek()?.kind !== 'symbol') return false; this.i++; return true; }
  word(value: string) { if (!keyword(this.peek(), value)) return false; this.i++; return true; }
  requireWord(value: string) { if (!this.word(value)) invalid(); }
  requireSymbol(value: string) { if (!this.symbol(value)) invalid(); }
  name(): Token { const token = this.peek(); if (!identifier(token)) return invalid(); this.i++; return token; }
  qualified(): Token[] { const name = [this.name()]; if (this.symbol('.')) name.push(this.name()); return name; }
  done() { return this.i === this.tokens.length; }
}

// Explicit built-in types only. User-defined/domain types, arrays, collations,
// generated/identity columns and dialect-specific clauses remain unsupported.
function dataType(c: Cursor): readonly Token[] {
  const start = c.i;
  const token = c.peek();
  if (token?.kind !== 'word') return invalid();
  const type = token.raw.toUpperCase();
  const scalar = new Set(['SMALLINT', 'INTEGER', 'INT', 'BIGINT', 'INT2', 'INT4', 'INT8',
    'TEXT', 'BOOLEAN', 'BOOL', 'DATE', 'UUID', 'JSON', 'JSONB', 'BYTEA', 'REAL',
    'SERIAL', 'BIGSERIAL', 'SMALLSERIAL', 'FLOAT4', 'FLOAT8']);
  c.i++;
  if (type === 'DOUBLE') c.requireWord('PRECISION');
  else if (['VARCHAR', 'CHAR', 'CHARACTER', 'NUMERIC', 'DECIMAL', 'TIMESTAMP', 'TIME'].includes(type)) {
    if (type === 'CHARACTER') c.word('VARYING');
    if (c.symbol('(')) {
      if (c.peek()?.kind !== 'number' || !/^\d+$/.test(c.peek().raw)) invalid();
      const size = Number(c.peek().raw);
      const temporal = ['TIME', 'TIMESTAMP'].includes(type);
      const decimal = ['NUMERIC', 'DECIMAL'].includes(type);
      if (!Number.isSafeInteger(size) || size < (temporal ? 0 : 1) ||
        size > (temporal ? 6 : decimal ? 1000 : 4096)) invalid();
      c.i++;
      if (c.symbol(',')) {
        if (!decimal || c.peek()?.kind !== 'number' || !/^\d+$/.test(c.peek().raw) || Number(c.peek().raw) > size) invalid();
        c.i++;
      }
      c.requireSymbol(')');
    }
    if (['TIME', 'TIMESTAMP'].includes(type) && (c.word('WITH') || c.word('WITHOUT'))) {
      c.requireWord('TIME'); c.requireWord('ZONE');
    }
  } else if (!scalar.has(type)) invalid();
  return c.tokens.slice(start, c.i);
}

/** Small expression grammar; never accepts arbitrary trailing words as a default. */
function expression(c: Cursor, depth = 0, allowColumnReference = false): void {
  if (depth > 64) invalid();
  if (c.symbol('+') || c.symbol('-') || c.word('NOT')) expression(c, depth + 1, allowColumnReference);
  else if (c.symbol('(')) { expression(c, depth + 1, allowColumnReference); c.requireSymbol(')'); }
  else if (c.peek()?.kind === 'number' || c.peek()?.kind === 'string' ||
    ['NULL', 'TRUE', 'FALSE', 'CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME'].some(k => keyword(c.peek(), k))) c.i++;
  else {
    c.qualified();
    if (c.symbol('(')) {
      if (!c.symbol(')')) {
        expression(c, depth + 1, allowColumnReference);
        while (c.symbol(',')) expression(c, depth + 1, allowColumnReference);
        c.requireSymbol(')');
      }
    } else if (!allowColumnReference) invalid();
  }
  while (c.symbol(':')) { c.requireSymbol(':'); dataType(c); }
  if (['+', '-', '*', '/', '%', '=', '<', '>'].some(op => c.peek()?.raw === op)) {
    c.i++;
    const op = c.tokens[c.i - 1].raw;
    if (op === '<') { c.symbol('=') || c.symbol('>'); }
    else if (op === '>') c.symbol('=');
    expression(c, depth + 1, allowColumnReference);
  } else if (c.word('AND') || c.word('OR')) expression(c, depth + 1, allowColumnReference);
  else if (c.word('IS')) { c.word('NOT'); c.requireWord('NULL'); }
}

function nameList(c: Cursor) {
  c.requireSymbol('('); c.name(); while (c.symbol(',')) c.name(); c.requireSymbol(')');
}
function check(c: Cursor) { c.requireSymbol('('); expression(c, 0, true); c.requireSymbol(')'); }
function columnOrConstraint(tokens: Token[]): Column | undefined {
  const c = new Cursor(tokens);
  const named = c.word('CONSTRAINT');
  if (named) c.name();
  let constraint = true;
  if (c.word('PRIMARY')) { c.requireWord('KEY'); nameList(c); }
  else if (c.word('UNIQUE')) nameList(c);
  else if (c.word('FOREIGN')) { c.requireWord('KEY'); nameList(c); c.requireWord('REFERENCES'); c.qualified(); nameList(c); }
  else if (c.word('CHECK')) check(c);
  else constraint = false;
  if (constraint) { if (!c.done()) invalid(); return undefined; }
  if (named) invalid();
  const name = c.name();
  const type = dataType(c);
  const seen = new Set<string>();
  while (!c.done()) {
    let key: string;
    if (c.word('NOT')) { c.requireWord('NULL'); key = 'null'; }
    else if (c.word('NULL')) key = 'null';
    else if (c.word('PRIMARY')) { c.requireWord('KEY'); key = 'primary'; }
    else if (c.word('UNIQUE')) key = 'unique';
    else if (c.word('DEFAULT')) { expression(c); key = 'default'; }
    else if (c.word('CHECK')) { check(c); key = 'check'; }
    else return invalid();
    if (seen.has(key)) invalid();
    seen.add(key);
  }
  return { name, type };
}

function header(c: Cursor): Token[] {
  c.requireWord('CREATE'); c.requireWord('TABLE');
  if (c.word('IF')) { c.requireWord('NOT'); c.requireWord('EXISTS'); }
  return c.qualified();
}
function parseTable(tokens: Token[]): Table {
  const c = new Cursor(tokens);
  const name = header(c), head = tokens.slice(0, c.i);
  c.requireSymbol('(');
  const columns: Column[] = [];
  let start = c.i, depth = 0;
  for (; c.i < tokens.length; c.i++) {
    const raw = c.peek().kind === 'symbol' ? c.peek().raw : '';
    if (raw === '(') depth++;
    if (raw === ')' && depth > 0) { depth--; continue; }
    if ((raw === ',' || raw === ')') && depth === 0) {
      if (start === c.i) invalid();
      const column = columnOrConstraint(tokens.slice(start, c.i));
      if (column) columns.push(column);
      start = c.i + 1;
      if (raw === ')') break;
    }
  }
  c.requireSymbol(')');
  if (!c.done() || !columns.length || new Set(columns.map(col => canonicalIdentifier(col.name))).size !== columns.length) invalid();
  return { name, columns, header: head, tokens };
}

/** Only semicolon-terminated, balanced statements. Invalid lexing fails the file. */
function tables(text: string): Table[] {
  const tokens = lex(text), statements: Token[][] = [];
  let start = 0, depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'symbol') continue;
    if (t.raw === '(' && ++depth > 64) invalid();
    if (t.raw === ')' && --depth < 0) invalid();
    if (t.raw === ';') {
      if (depth) invalid();
      statements.push(tokens.slice(start, i)); start = i + 1;
    }
  }
  if (depth || start !== tokens.length) invalid();
  const parsed: Table[] = [], counts = new Map<string, number>();
  for (const statement of statements) {
    if (!keyword(statement[0], 'CREATE') || !keyword(statement[1], 'TABLE')) continue;
    try {
      const key = reference(header(new Cursor(statement)));
      counts.set(key, (counts.get(key) ?? 0) + 1);
      parsed.push(parseTable(statement));
    } catch { /* Unsupported statement produces no candidate, including no columns. */ }
  }
  // Repeated physical declarations (even identical ones) are ambiguous: no
  // first/latest selection, and no candidate multiplication.
  return parsed.filter(table => counts.get(reference(table.name)) === 1);
}

export class SqlCreateTableSpecification implements DetectionSpecification {
  readonly code: string;
  readonly version = '1.0.0';
  constructor(readonly candidateKind: 'DATA_ASSET' | 'DATA_ELEMENT') {
    this.code = candidateKind === 'DATA_ASSET' ? 'sql-create-table-asset' : 'sql-create-table-element';
  }
  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    if (!artifact.locator.endsWith('.sql')) return [];
    let parsed: Table[];
    try { parsed = tables(artifact.text); } catch { return []; }
    return parsed.flatMap(table => {
      const sourceReference = reference(table.name);
      const statementFingerprint = createHash('sha256').update(JSON.stringify(table.tokens.map(t => [t.kind, t.raw]))).digest('hex');
      const base = { confidence: 1, trustState: TRUST_STATE.DECLARED };
      if (this.candidateKind === 'DATA_ASSET') return [{ ...base, displayValue: sourceReference,
        lineStart: table.header[0].line, lineEnd: table.header.at(-1)!.line,
        excerpt: table.header.map(t => t.raw).join(' '), dataDeclaration: { sourceReference, statementFingerprint } }];
      return table.columns.map(col => ({ ...base, displayValue: canonicalIdentifier(col.name),
        lineStart: col.name.line, lineEnd: col.type.at(-1)!.line,
        // Minimal token projection: excludes comments/default literals (secrets).
        excerpt: [col.name, ...col.type].map(t => t.raw).join(' '),
        dataDeclaration: { sourceReference, statementFingerprint, elementPath: canonicalIdentifier(col.name) } }));
    });
  }
}
