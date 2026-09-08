# Graph Route Release Fix V1 — Validation Evidence

## Starting state

- Starting SHA (authoritative main): `d0c218f3b5b532ed10338b0aa58e5488dbea2b27`
- Branch: `fix/graph-route-release-v1`
- Local main == origin/main == starting SHA, no tracked changes prior to this work. Only allowed untracked item present: `codex-recovery-6101-6240.txt` (never touched).

## Original failure (one base reproduction)

Command: `npm run build` from `apps/dashboard`.

Result: compile succeeded, typecheck/lint passed, static generation reached page 27/37 then failed prerendering `/graph`:

```
Error occurred prerendering page "/graph". Read more: https://nextjs.org/docs/messages/prerender-error
Error: Seems like you have not used zustand provider as an ancestor. Help: https://reactflow.dev/error#001
    at cV (...\.next\server\app\(dashboard)\graph\page.js:2:70209)
    ...
Export encountered an error on /(dashboard)/graph/page: /graph, exiting the build.
```

Failure stage: static page generation / prerendering (not compile, not typecheck, not page-data collection).

## Component/provider render map (before fix)

```
/graph page (Server Component, app/(dashboard)/graph/page.tsx)
→ ReactFlowGraph ("use client", components/graph/ReactFlowGraph.tsx)
   → useReactFlow()  [called at top of the component body]
   → <ReactFlow> ... </ReactFlow>  [rendered later, in the same component's JSX]
   → no <ReactFlowProvider> anywhere in the file, or anywhere in the app
     (confirmed via repo-wide search — zero matches for `ReactFlowProvider`)
```

## Root cause

`@xyflow/react`'s `useReactFlow()` hook internally calls `useStoreApi()`, which does `useContext(StoreContext)` and throws the observed error if the context is `null` (`node_modules/@xyflow/react/dist/esm/index.js`, `useStoreApi`). `StoreContext.Provider` is created only by `<ReactFlowProvider>`, or internally for `<ReactFlow>`'s own children — never for the component that instantiates `<ReactFlow>` itself.

`ReactFlowGraph` called `useReactFlow()` directly in its own function body and *also* rendered `<ReactFlow>` later in the same function's JSX. Because the hook executes during that component's own render (before its returned JSX creates any provider descendant), the call site has no `StoreContext.Provider` ancestor anywhere in the tree. This is a genuine React hook-contract violation, not an SSR-only artifact — it fails identically on the server during prerendering and would fail on the client at runtime. No `<ReactFlowProvider>` existed anywhere in the codebase to close this gap.

## Correction (fix boundary)

Applied "Provider Ownership" (Pattern B): `ReactFlowGraph` (the exported symbol imported by `page.tsx`) is now a thin wrapper that renders `<ReactFlowProvider>` around a new inner component, `GraphCanvas`, which owns all prior state, effects, the `useReactFlow()` call, and the `<ReactFlow>` JSX — unchanged otherwise.

```tsx
export default function ReactFlowGraph() {
  return (
    <ReactFlowProvider>
      <GraphCanvas />
    </ReactFlowProvider>
  );
}

function GraphCanvas() {
  // ...unchanged body: all existing state, effects, useReactFlow(), <ReactFlow>...
}
```

`GraphCanvas` now renders strictly beneath `<ReactFlowProvider>`, so `useReactFlow()` resolves a valid `StoreContext`.

### Why this is architectural, not suppressive

- No error is caught/swallowed, no route is disabled, no `ssr: false`, no `force-dynamic`, no TypeScript/ESLint disabling.
- The fix closes the actual missing-ancestor gap in the React component tree that the hook's contract requires — it does not work around the symptom during build.
- Zero behavior change: all state, filters, effects, event handlers, and rendered graph UI are unchanged; only the ownership boundary of the provider moved to correctly wrap the existing hook usage.

## Files changed

- `apps/dashboard/components/graph/ReactFlowGraph.tsx` — added `ReactFlowProvider` import; split the default export into a provider-wrapping shell (`ReactFlowGraph`) and an inner component (`GraphCanvas`) that retains 100% of the prior logic and JSX.
- `apps/dashboard/tests/graph-provider-boundary.test.ts` (new) — source-structure regression tests (see Tests below).

No other file was touched. `apps/dashboard/app/(dashboard)/graph/page.tsx` required no change (it already only imports the default export).

## Server / Client boundary

Unchanged and preserved: `page.tsx` remains a Server Component; `ReactFlowGraph.tsx` remains entirely `"use client"`. No functions, class instances, non-serializable stores, database clients, or privileged objects cross the Server → Client boundary — none did before, none do now. React Flow state/context lives only on the client, inside `GraphCanvas`, as before.

## React Flow provider boundary

- `<ReactFlowProvider>` wraps `<GraphCanvas />` unconditionally — no conditional path removes it, no loading/error/empty-graph path renders `GraphCanvas` outside the provider.
- Every store-reading hook (`useReactFlow`) call site is inside `GraphCanvas`, strictly below the provider.
- Exactly one `<ReactFlowProvider>` tree exists; no duplicate/competing providers.

## GraphOS non-regression

No files under `packages/graphos/**` were read or modified. No graph node/edge/lineage semantics, query contracts, or governance domain behavior were touched. The change is a pure component-composition split with no logic edits inside the moved code.

## UX non-regression

All previously rendered capabilities are preserved unchanged in `GraphCanvas`: nodes, edges, zoom/pan (via `<ReactFlow>` defaults), `<Controls>`, `<MiniMap>`, `<Background>`, node selection/detail panel, search/risk/type/status/system filters, mode switching (`estate`/`dependency`/`risk`/`compliance`), and the risk-propagation panel. No UI redesign was performed.

## Tests

Added `apps/dashboard/tests/graph-provider-boundary.test.ts`, following this repo's existing source-structure boundary-test convention (`readFileSync` + regex/structural assertions, no new test dependencies):

1. `ReactFlowGraph.tsx` imports `ReactFlowProvider` from `@xyflow/react`.
2. The default-exported wrapper component renders `<ReactFlowProvider>` and does **not** itself call any React Flow store hook (`useReactFlow`/`useStore`/`useStoreApi`) or render `<ReactFlow>` directly.
3. Every store-hook call site in the file falls outside the wrapper's function body (i.e., lives in the inner component).
4. The wrapper renders `<GraphCanvas />` as `ReactFlowProvider`'s child, and `GraphCanvas` is the component that both owns a store hook call and renders `<ReactFlow>`.

These tests fail if the provider is ever removed, if a store hook is moved back into the wrapper, or if `<ReactFlow>` is ever rendered outside the provider's child component — directly preventing recurrence of this defect. No dependency (e.g. jsdom/React Testing Library) was added; the dashboard's test runner (`node --test` via `tsx`) has no browser-DOM rendering setup, so full component-mount tests were out of scope and source-structure tests were the correct fit per this repo's established pattern.

Full dashboard suite: **307/307 tests passing** (including the 4 new tests), 0 failures.

## Typecheck

`npx tsc --noEmit` from `apps/dashboard`: clean, no errors.

`next build`'s own "Linting and checking validity of types" step: passed with no errors on every build run.

## Adversarial review (single pass)

Checked and cleared, no local defects found:

1. Provider mounted below a consumer — no, provider wraps the consumer.
2. Nested components using `useReactFlow` outside provider — no, single call site inside `GraphCanvas`.
3. Server component importing browser-only store hook — no, `page.tsx` only imports the default export.
4. Provider conditionally absent — no, unconditional wrap.
5. Loading/error path bypasses provider — no, those early returns happen inside `GraphCanvas`, which is already mounted under the provider by its parent.
6. Empty graph path bypasses provider — no, same component tree regardless of data.
7. Mobile/alternate graph layout bypasses provider — n/a, no alternate layout exists.
8. Direct Zustand store consumption from wrong context — no, single correctly-placed hook call.
9. Duplicate/competing `ReactFlowProvider` trees — no, exactly one.
10. Loss of controls/minimap/interactions — no, all preserved verbatim.
11. Global `force-dynamic` workaround — not introduced.
12. Blanket `ssr: false` workaround — not introduced.
13. GraphOS semantic changes — none.
14. Unrelated governance changes — none; diff is limited to the two files listed above.
15. Unnecessary dependency upgrade — none; `ReactFlowProvider` was already exported by the already-installed `@xyflow/react` version.

## Final production build

Command: `npm run build` from `apps/dashboard` (run after tests and typecheck, on the final code state).

Result: **complete success.**

```
✓ Compiled successfully in 11.3s
   Linting and checking validity of types ...
   Collecting page data ...
 ✓ Generating static pages (37/37)
   Finalizing page optimization ...
   Collecting build traces ...

├ ○ /graph                                              87.7 kB         191 kB
```

`/graph` is now statically prerendered (`○`) alongside the rest of the dashboard. No other route regressed. No new, different production-build error appeared.

## Dependency status

**Unchanged.** No `package.json` or lockfile edits. `@xyflow/react` and `zustand` versions are exactly as they were on `main`.

## Database / Supabase status

**Unchanged / untouched.** No migrations created or applied, no RLS changes, no hosted Supabase access, no `C:\Temp\govia-controlled.env` access, no database runtime tests run.

## Production deployment status

**NOT DEPLOYED.** This milestone only produced a local production build validation; no deployment action was taken.

## Build artifact housekeeping

- `apps/dashboard/tsconfig.tsbuildinfo`: regenerated by typecheck/build; restored to its `origin/main` committed content (no generated noise committed).
- `apps/dashboard/next-env.d.ts`: auto-generated by `next build`; removed after each build (was untracked on `main`, stays untracked).
- `.claude/` and `codex-recovery-6101-6240.txt`: never read, staged, or modified.
