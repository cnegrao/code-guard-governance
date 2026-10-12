"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";

const AGENT_TYPES = [
  { value: "assistive", label: "Assistive" },
  { value: "autonomous", label: "Autonomous" },
  { value: "supervisory", label: "Supervisory" },
  { value: "gateway", label: "Gateway" },
  { value: "orchestrator", label: "Orchestrator" },
  { value: "retrieval", label: "Retrieval (RAG)" },
  { value: "classifier", label: "Classifier" },
];

const RISK_LEVELS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const AI_ACT_CLASSES = [
  { value: "minimal", label: "Minimal" },
  { value: "limited", label: "Limited" },
  { value: "high", label: "High" },
  { value: "unacceptable", label: "Unacceptable" },
];

const OVERSIGHT_LEVELS = [
  { value: "l1_automated", label: "L1 — Automated" },
  { value: "l2_human_review", label: "L2 — Human Review" },
  { value: "l3_human_approval", label: "L3 — Human Approval" },
  { value: "l4_human_in_loop", label: "L4 — Human in the Loop" },
];

const DEPLOY_ENVS = [
  { value: "development", label: "Development" },
  { value: "staging", label: "Staging" },
  { value: "production", label: "Production" },
];

export function AgentForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    agent_code: "",
    name: "",
    description: "",
    version: "1.0.0",
    agent_type: "assistive",
    risk_level: "medium",
    ai_act_risk_class: "minimal",
    oversight_level: "l2_human_review",
    model_name: "",
    model_provider: "",
    model_version: "1.0",
    model_is_local: false,
    deployment_env: "development",
    deployment_region: "",
    business_domain: "",
    department: "",
  });

  function set(key: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to create agent");
      }

      const data = await res.json();
      router.push(`/agents/${data.agent.agent_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      {error && (
        <div className="p-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">
          {error}
        </div>
      )}

      <div className="border-b border-border-dark pb-4">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">
          Identity
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Agent Code"
            value={form.agent_code}
            onChange={(e) => set("agent_code", e.target.value)}
            placeholder="CREDIT-001"
            required
          />
          <Input
            label="Version"
            value={form.version}
            onChange={(e) => set("version", e.target.value)}
            placeholder="1.0.0"
          />
        </div>
        <div className="mt-4">
          <Input
            label="Name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Credit Scoring Agent"
            required
          />
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            Description
          </label>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="What does this agent do?"
            className="w-full px-3 py-2 bg-surface-dark border border-border-dark rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[80px]"
            required
          />
        </div>
      </div>

      <div className="border-b border-border-dark pb-4">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">
          Classification
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Agent Type"
            options={AGENT_TYPES}
            value={form.agent_type}
            onChange={(e) => set("agent_type", e.target.value)}
          />
          <Select
            label="Legacy risk label (LEGACY / NON-AUTHORITATIVE)"
            options={RISK_LEVELS}
            value={form.risk_level}
            onChange={(e) => set("risk_level", e.target.value)}
          />
          <Select
            label="Legacy AI Act risk class (LEGACY / NON-AUTHORITATIVE)"
            options={AI_ACT_CLASSES}
            value={form.ai_act_risk_class}
            onChange={(e) => set("ai_act_risk_class", e.target.value)}
          />
          <Select
            label="Oversight Level"
            options={OVERSIGHT_LEVELS}
            value={form.oversight_level}
            onChange={(e) => set("oversight_level", e.target.value)}
          />
        </div>
      </div>

      <div className="border-b border-border-dark pb-4">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">
          Model
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Model Name"
            value={form.model_name}
            onChange={(e) => set("model_name", e.target.value)}
            placeholder="gpt-4o"
          />
          <Input
            label="Model Provider"
            value={form.model_provider}
            onChange={(e) => set("model_provider", e.target.value)}
            placeholder="OpenAI"
          />
          <Input
            label="Model Version"
            value={form.model_version}
            onChange={(e) => set("model_version", e.target.value)}
            placeholder="1.0"
          />
          <label className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              checked={form.model_is_local}
              onChange={(e) => set("model_is_local", e.target.checked)}
              className="rounded bg-surface-dark border-border-dark"
            />
            <span className="text-sm text-gray-300">Local model (on-premises)</span>
          </label>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">
          Deployment
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Environment"
            options={DEPLOY_ENVS}
            value={form.deployment_env}
            onChange={(e) => set("deployment_env", e.target.value)}
          />
          <Input
            label="Region"
            value={form.deployment_region}
            onChange={(e) => set("deployment_region", e.target.value)}
            placeholder="eu-west-1"
          />
          <Input
            label="Business Domain"
            value={form.business_domain}
            onChange={(e) => set("business_domain", e.target.value)}
            placeholder="Credit Risk"
          />
          <Input
            label="Department"
            value={form.department}
            onChange={(e) => set("department", e.target.value)}
            placeholder="Risk Management"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <Button type="submit" loading={loading}>
          Create Agent
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}