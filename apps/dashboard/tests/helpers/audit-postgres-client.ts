import assert from 'node:assert/strict';

export type AuditRole = 'anon' | 'service_role';
export type AuditSql = (query: string, role: AuditRole) => Promise<string>;
const lit = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;

/** Test transport for audit.ts: execute its PostgREST query shapes on real PostgreSQL as each client's role. */
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
          const alternatives = expression.split(',').map(part => {
            const match = /^(event_description|event_type)\.ilike\.(.*)$/.exec(part);
            assert.ok(match, `supported audit search: ${part}`);
            return `${match[1]} ilike ${lit(match[2])}`;
          });
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
          const rows = `select coalesce(json_agg(r), '[]') from (select ${columns} ${filter}${order}${limit === null ? '' : ` limit ${limit}`} offset ${offset}) r`;
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
