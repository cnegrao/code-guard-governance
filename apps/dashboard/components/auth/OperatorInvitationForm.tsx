"use client";
import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

type Invitation = { email: string; fullName: string; organisationCode: string; roleCode: string; expiresAt: string };
export function OperatorInvitationForm() {
  const [token, setToken] = useState("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (invitation && password !== confirmation) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/operator-invitation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invitation ? { token, password } : { token }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to activate account.");
      if (invitation) { setPassword(""); setConfirmation(""); setToken(""); setDone(true); }
      else setInvitation(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to activate account."); }
    finally { setBusy(false); }
  }
  if (done) return <div role="status" className="space-y-4"><p>Your account is ready. Sign in with your email and the password you just defined.</p><Link href="/login" className="text-primary underline">Continue to Sign In</Link></div>;
  return <form onSubmit={submit} className="space-y-4">
    {error && <p role="alert" className="text-danger">{error}</p>}
    {!invitation ? <>
      <label htmlFor="invitation-code" className="block text-sm">Invitation code</label>
      <Input id="invitation-code" name="invitation-code" type="password" autoComplete="off" spellCheck={false} required minLength={43} maxLength={43} value={token} onChange={e => setToken(e.target.value.trim())} />
      <p className="text-sm text-gray-400">Use the code provided privately by your administrator.</p>
    </> : <>
      <dl className="text-sm space-y-2"><dt>Operator</dt><dd>{invitation.fullName} · {invitation.email}</dd><dt>Organisation</dt><dd>{invitation.organisationCode}</dd><dt>Role</dt><dd>{invitation.roleCode}</dd><dt>Invitation expires</dt><dd>{new Date(invitation.expiresAt).toLocaleString()}</dd></dl>
      <label htmlFor="operator-password" className="block text-sm">Choose your password</label>
      <Input id="operator-password" name="new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={72} value={password} onChange={e => setPassword(e.target.value)} />
      <label htmlFor="operator-password-confirmation" className="block text-sm">Confirm your password</label>
      <Input id="operator-password-confirmation" name="confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={72} value={confirmation} onChange={e => setConfirmation(e.target.value)} />
      <p className="text-sm text-gray-400">Use at least 12 characters, up to 72 UTF-8 bytes. Your administrator does not need your password.</p>
    </>}
    <Button type="submit" className="w-full" loading={busy}>{invitation ? "Set password and activate account" : "Check invitation"}</Button>
  </form>;
}
