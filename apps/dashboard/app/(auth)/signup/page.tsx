import { SignupForm } from "@/components/auth/SignupForm";
import Link from "next/link";

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-widest text-white">GOVERNYX</h1>
          <p className="text-gray-400 mt-2 text-sm">AI Governance Intelligence</p>
          <p className="text-gray-400 mt-2 text-sm">Create your organisation</p>
        </div>
        <div className="bg-surface-dark/70 backdrop-blur border border-border-dark/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-6">Sign Up</h2>
          <SignupForm />
          <p className="mt-4 text-center text-sm text-gray-400">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
