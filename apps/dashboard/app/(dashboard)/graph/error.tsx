"use client";
export default function GraphError({ reset }: { reset: () => void }) {
  return <div role="alert" className="text-gray-400">ERROR: Canonical graph could not be read. No governance conclusion is available.
    <button onClick={reset} className="ml-3 text-primary">Retry</button>
  </div>;
}
