import type { Metadata } from "next";
import { OperatorInvitationForm } from "@/components/auth/OperatorInvitationForm";
export const metadata: Metadata = { title: "Activate invited operator", referrer: "no-referrer", robots: { index: false, follow: false } };
export default function AcceptInvitationPage() {
  return <main className="min-h-screen flex items-center justify-center p-4"><section className="w-full max-w-md rounded-xl p-6 bg-surface-dark border border-border-dark">
    <h1 className="text-xl font-semibold mb-4">Activate your operator account</h1>
    <p className="text-sm text-gray-400 mb-6">Your administrator has assigned your organisation and role. Define your own password to activate access.</p>
    <OperatorInvitationForm />
  </section></main>;
}
