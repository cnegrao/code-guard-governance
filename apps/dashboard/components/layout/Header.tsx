"use client";

import { useAuth } from "@/hooks/useAuth";
import { INDUSTRY_LABELS, type IndustryProfile } from "@/lib/validation";
import { Brand } from './Brand';
import { organisationDisplayName } from '@/lib/brand';

function industryLabel(industry: string): string {
  return INDUSTRY_LABELS[industry as IndustryProfile] ?? industry;
}

export function Header() {
  const { session } = useAuth();

  return (
    <header className="h-16 border-b border-border-dark flex items-center justify-between px-6 bg-surface-dark/50">
      <h1><Brand /></h1>
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-300">{organisationDisplayName(session?.org?.name)}</span>
        <span className="text-xs text-gray-500 bg-surface-dark px-3 py-1 rounded-full border border-border-dark">
          {industryLabel(session?.org?.industry ?? "other")}
        </span>
        <span className="text-sm text-gray-400">{session?.user?.email}</span>
      </div>
    </header>
  );
}
