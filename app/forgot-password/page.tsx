import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
        <h1 className="text-2xl font-semibold text-slate-950">Forgot your password?</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Enter your account email and we’ll send a secure password reset link.</p>
        <div className="mt-7"><ForgotPasswordForm /></div>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-blue-700 hover:underline">Back to sign in</Link>
      </section>
    </main>
  );
}
