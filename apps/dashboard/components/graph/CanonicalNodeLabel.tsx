import Link from 'next/link';
import type { CanonicalObjectKind } from '@council/canonical-contracts';
import { SOURCE_NAME_LABEL } from '@/lib/governance/source-name';

const MARKERS: Record<CanonicalObjectKind, string> = {
  AGENT: 'A', AGENT_VERSION: 'V', MODEL: 'M', TOOL: 'T', PROMPT: 'P', API: 'API',
  MCP_SERVER: 'MCP', KNOWLEDGE_BASE: 'KB', DATA_ASSET: 'DS', DATA_ELEMENT: 'DE', SKILL: 'S',
};

export function CanonicalNodeLabel({ kind, objectId, sourceName }: {
  kind: CanonicalObjectKind; objectId: string; sourceName?: string | null;
}) {
  return <div className="flex items-start gap-3 p-1">
    <span aria-hidden="true" className="flex h-9 min-w-9 items-center justify-center rounded-md border border-[#6B9BFF]/50 bg-[#6B9BFF]/10 px-1 text-xs font-bold text-[#A7C4FF]">{MARKERS[kind]}</span>
    <div className="min-w-0">
      <strong className="block break-words text-sm leading-5">{sourceName ?? 'UNKNOWN'}</strong>
      {sourceName && <p className="text-[11px] text-[#B3BAC5]">{SOURCE_NAME_LABEL}</p>}
      <p className="mt-1 text-xs text-[#B3BAC5]">{kind}</p>
      <details className="nodrag nopan mt-1 text-xs text-[#B3BAC5]">
        <summary className="cursor-pointer">Canonical identity</summary>
        <p className="mt-1 break-all">{objectId}</p><p>Canonical name: UNKNOWN</p>
      </details>
      {kind === 'AGENT' && <Link className="nodrag nopan mt-2 inline-block text-xs text-[#91B5FF] underline" href={`/agents/canonical/${encodeURIComponent(objectId)}`}>Open Passport</Link>}
    </div>
  </div>;
}
