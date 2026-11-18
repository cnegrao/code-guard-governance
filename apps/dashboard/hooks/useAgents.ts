"use client";

import { useState, useEffect, useCallback } from "react";
import type { AgentDetailAgent } from "@/types/agents";

export function useAgents() {
  const [agents, setAgents] = useState<AgentDetailAgent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchAgents = useCallback(async (params?: Record<string, string>) => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams(params).toString();
      const res = await fetch(`/api/agents?${query}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setAgents(data.agents ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return { agents, total, loading, error, refetch: fetchAgents };
}
