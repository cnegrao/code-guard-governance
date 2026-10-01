import assert from 'node:assert/strict';

export type AuditRole = 'anon' | 'service_role';
export type AuditSql = (query: string, role: AuditRole) => Promise<string>;
const lit = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;

// Matches supabase/config.toml. Counts describe the entire filtered set, not the capped response.
export const AUDIT_API_MAX_ROWS = 1000;

/** Parse only the audit OR-of-ILIKE surface, including PostgREST quoted/escaped values.
 * Mirrors v14.1 pLogicSingleVal/pQuotedValue for this subset: comma separates predicates;
 * ')' closes the logic tree early, while '(' inside an unquoted value is ordinary text.
 * https://github.com/PostgREST/postgrest/blob/v14.1/src/PostgREST/ApiRequest/QueryParams.hs
 * https://postgrest.org/en/stable/references/api/url_grammar.html#reserved-characters
 */
function searchAlternatives(expression: string): string[] {
  const alternatives: string[] = [];
  let rest = expression;
  while (rest) {
    const field = /^(event_description|event_type)\.ilike\./.exec(rest);
    assert.ok(field, `invalid PostgREST audit search: ${rest}`);
    rest = rest.slice(field[0].length);
    let value = '';
    if (rest.startsWith('"')) {
      let index = 1, closed = false;
      for (; index < rest.length; index++) {
        const char = rest[index];
        if (char === '\\') {
          assert.ok(index + 1 < rest.length, 'unterminated PostgREST escape');
          value += rest[++index];
        } else if (char === '"') { index++; closed = true; break; }
        else value += char;
      }
      assert.ok(closed, 'unterminated PostgREST quoted value');
      rest = rest.slice(index);
    } else {
      const match = /^[^,)]*/.exec(rest)!;
      value = match[0];
      rest = rest.slice(value.length);
    }
    alternatives.push(`${field[1]} ilike ${lit(value.replace(/\*/g, '%'))}`);
    if (!rest || rest.startsWith(')')) break;
    assert.ok(rest.startsWith(',') && rest.length > 1, `invalid PostgREST separator: ${rest}`);
    rest = rest.slice(1);
  }
  assert.ok(alternatives.length > 0);
  return alternatives;
}

/** Test transport: real PostgreSQL roles/data with the configured PostgREST row cap simulated in SQL. */
export function auditPostgresClient(sql: AuditSql, role: AuditRole) {
  const run = async (query: string) => {
    try {
      return { data: JSON.parse(await sql(query, role)), error: null };
    } catch (error) {
      return { data: null, error: { message: (String(error).match(/ERROR: +([^\n]*)/) ?? ['', String(error)])[1].trim() } };
    }
  };
  return {
    from(table: string) {
      let columns = '*', head = false, counted = false, limit: number | null = null, offset = 0, order = '';
      let singular: 'single' | 'maybeSingle' | null = null;
      const where: string[] = [];
      const builder = {
        select(cols: string, options?: { count?: string; head?: boolean }) { columns = cols; counted = options?.count === 'exact'; head = options?.head === true; return builder; },
        eq(column: string, value: unknown) { where.push(`${column} = ${lit(value)}`); return builder; },
        gte(column: string, value: unknown) { where.push(`${column} >= ${lit(value)}`); return builder; },
        lte(column: string, value: unknown) { where.push(`${column} <= ${lit(value)}`); return builder; },
        or(expression: string) {
          const alternatives = searchAlternatives(expression);
          where.push(`(${alternatives.join(' or ')})`);
          return builder;
        },
        order(column: string, options?: { ascending?: boolean }) { order = ` order by ${column} ${options?.ascending === false ? 'desc' : 'asc'}`; return builder; },
        limit(n: number) { limit = n; return builder; },
        range(from: number, to: number) { offset = from; limit = to - from + 1; return builder; },
        single() { singular = 'single'; return builder; },
        maybeSingle() { singular = 'maybeSingle'; return builder; },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          const filter = `from gov_repo.${table}${where.length ? ` where ${where.join(' and ')}` : ''}`;
          const rows = `select coalesce(json_agg(r), '[]') from (select ${columns} ${filter}${order} limit ${Math.min(limit ?? AUDIT_API_MAX_ROWS, AUDIT_API_MAX_ROWS)} offset ${offset}) r`;
          const query = head ? `select count(*) ${filter}` : counted ? `select json_build_object('rows', (${rows}), 'count', (select count(*) ${filter}))` : rows;
          return run(query).then(result => {
            if (result.error) return { data: null, count: null, error: result.error };
            if (head) return { data: null, count: Number(result.data), error: null };
            if (counted) return { data: result.data.rows, count: result.data.count, error: null };
            if (singular) {
              const rows = result.data as unknown[];
              if (rows.length === 1) return { data: rows[0], count: null, error: null };
              if (!rows.length && singular === 'maybeSingle') return { data: null, count: null, error: null };
              return { data: null, count: null, error: { code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' } };
            }
            return { data: result.data, count: null, error: null };
          }).then(resolve, reject);
        },
      };
      return builder;
    },
    rpc(name: string, args: { p_from_sequence: number; p_to_sequence: number | null }) {
      assert.equal(name, 'ledger_verify');
      return run(`select coalesce(json_agg(v), '[]') from gov_repo.ledger_verify(${args.p_from_sequence}, ${args.p_to_sequence ?? 'null'}) v`);
    },
  };
}
