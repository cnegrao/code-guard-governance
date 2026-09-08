import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// React Flow's useReactFlow/useStore/useStoreApi hooks read a Zustand store
// from React context that only <ReactFlowProvider> (or <ReactFlow> for its
// own children) creates. Calling one of those hooks in the same component
// function that instantiates <ReactFlow> throws "Seems like you have not
// used zustand provider as an ancestor" during both client rendering and
// Next.js static prerendering, since the hook call site is not a descendant
// of any provider. These tests pin the fix: the exported /graph component is
// a thin wrapper that renders <ReactFlowProvider> around a separate inner
// component, and every store-reading hook lives inside that inner component.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_PATH = path.join(ROOT, "components/graph/ReactFlowGraph.tsx");

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

function extractFunctionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `expected to find "${signature}" in ${SOURCE_PATH}`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  throw new Error(`unterminated function body for "${signature}"`);
}

const STORE_HOOK_PATTERN = /\buse(ReactFlow|Store|StoreApi)\s*\(/;

test("boundary: components/graph/ReactFlowGraph.tsx imports ReactFlowProvider from @xyflow/react", () => {
  const source = readSource();
  assert.match(source, /import\s*\{[^}]*\bReactFlowProvider\b[^}]*\}\s*from\s*"@xyflow\/react"/);
});

test("boundary: the default-exported /graph component only wraps ReactFlowProvider around an inner component — it does not itself call React Flow store hooks or render <ReactFlow>", () => {
  const source = readSource();
  const wrapperBody = extractFunctionBody(source, "export default function ReactFlowGraph()");

  assert.match(wrapperBody, /<ReactFlowProvider>/, "wrapper must render <ReactFlowProvider>");
  assert.doesNotMatch(
    wrapperBody,
    STORE_HOOK_PATTERN,
    "the component that owns <ReactFlowProvider> must not itself call a React Flow store hook — that hook has no provider ancestor at its own call site"
  );
  assert.doesNotMatch(
    wrapperBody,
    /<ReactFlow[\s>]/,
    "the <ReactFlow> canvas must render inside the provider's child component, not alongside the provider itself"
  );
});

test("boundary: every React Flow store hook (useReactFlow/useStore/useStoreApi) call site sits inside a component distinct from the ReactFlowProvider wrapper", () => {
  const source = readSource();
  const wrapperBody = extractFunctionBody(source, "export default function ReactFlowGraph()");
  const wrapperStart = source.indexOf(wrapperBody);
  const wrapperEnd = wrapperStart + wrapperBody.length;

  const hookCalls = [...source.matchAll(new RegExp(STORE_HOOK_PATTERN.source, "g"))];
  assert.ok(hookCalls.length > 0, "expected at least one React Flow store hook call in this file");

  for (const call of hookCalls) {
    const index = call.index ?? -1;
    assert.ok(
      index < wrapperStart || index >= wrapperEnd,
      `store hook call at offset ${index} must not be inside the ReactFlowProvider wrapper component`
    );
  }
});

test("boundary: the inner canvas component renders <ReactFlow> beneath the provider", () => {
  const source = readSource();
  const wrapperBody = extractFunctionBody(source, "export default function ReactFlowGraph()");
  assert.match(wrapperBody, /<GraphCanvas\s*\/>/, "wrapper must render the inner canvas component as ReactFlowProvider's child");

  const canvasBody = extractFunctionBody(source, "function GraphCanvas()");
  assert.match(canvasBody, /<ReactFlow[\s>]/, "inner component must render <ReactFlow>");
  assert.match(canvasBody, STORE_HOOK_PATTERN, "inner component must own the React Flow store hook usage");
});
