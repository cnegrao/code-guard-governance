import { LoginForm } from "@/components/auth/LoginForm";
import Link from "next/link";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-widest text-white">GOVERNYX</h1>
          <p className="text-gray-400 mt-2 text-sm">AI Governance Intelligence</p>
        </div>
        <div className="bg-surface-dark/70 backdrop-blur border border-border-dark/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-6">Sign In</h2>
          <LoginForm />
          <p className="mt-4 text-center text-sm text-gray-400">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-primary hover:underline">
              Sign Up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
