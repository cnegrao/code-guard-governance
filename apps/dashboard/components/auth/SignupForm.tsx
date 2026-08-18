"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { INDUSTRY_LABELS, type IndustryProfile } from "@/lib/validation";

const INDUSTRIES = Object.entries(INDUSTRY_LABELS).map(([value, label]) => ({
  value: value as IndustryProfile,
  label,
}));

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [industry, setIndustry] = useState<IndustryProfile>("saas");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, fullName, orgName, industry }),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Signup failed");
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">
          {error}
        </div>
      )}
      <Input
        label="Full Name"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        placeholder="Jane Smith"
        required
      />
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        required
      />
      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Min 8 characters"
        required
      />
      <Input
        label="Organisation Name"
        value={orgName}
        onChange={(e) => setOrgName(e.target.value)}
        placeholder="Acme Corp"
        required
      />
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          Industry
        </label>
        <select
          value={industry}
          onChange={(e) => setIndustry(e.target.value as IndustryProfile)}
          className="w-full px-3 py-2 bg-surface-dark border border-border-dark rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          {INDUSTRIES.map((i) => (
            <option key={i.value} value={i.value}>
              {i.label}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" loading={loading} className="w-full">
        Create Account
      </Button>
    </form>
  );
}