import assert from 'node:assert/strict';
import type { L14Cluster } from './m16-l14-fixtures';

/** Real backends; completion is gated by pg_blocking_pids(), never elapsed sleep. */
export function residualRace(c: L14Cluster) {
  return async (first:string,second:string,role:'service_role'|'postgres'='service_role') => {
    const a = c.session(role), b = c.session('service_role'), monitor = c.session('m16_bootstrap');
    try {
      await a.run('begin;'); const result = await a.run(first); assert.equal(result.err,'',result.err);
      const apid = (await a.run('select pg_backend_pid();')).out.trim(), bpid = (await b.run('select pg_backend_pid();')).out.trim();
      assert.match(apid,/^\d+$/); assert.match(bpid,/^\d+$/);
      const pending = b.run(second); let blocked = false;
      const deadline = Date.now()+4000;
      while (Date.now()<deadline) {
        const observed = await monitor.run(`select pg_blocking_pids(${bpid}) @> array[${apid}];`);
        assert.equal(observed.err,'',observed.err);
        if (observed.out.trim()==='t') { blocked=true; break; }
      }
      const commit = await a.run('commit;'); assert.equal(commit.err,'',commit.err);
      const loser = await pending;
      assert.ok(blocked,'PostgreSQL reported the exact blocking backend');
      return { first:result,second:loser };
    } finally { await Promise.all([a.close(),b.close(),monitor.close()]); }
  };
}
