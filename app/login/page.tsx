import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const session = await auth();
  if (session?.user.id) redirect(session.activeCompanyId ? "/dashboard" : "/onboarding/company");
  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[1.05fr_0.95fr]">
      <section className="hidden flex-col justify-between bg-slate-950 p-12 text-white lg:flex">
        <div className="flex items-center gap-3 text-lg font-semibold">
          <span className="grid size-10 place-items-center rounded-xl bg-blue-600 font-bold">E</span>
          ERP System
        </div>
        <div className="max-w-xl pb-10">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-blue-300">Business workspace</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">One secure foundation for every company.</h1>
          <p className="mt-5 max-w-md leading-7 text-slate-300">Manage access to your company workspaces with a secure, bilingual platform.</p>
        </div>
        <p className="text-sm text-slate-400">Built for Indian businesses · English and हिंदी</p>
      </section>
      <section className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <p className="font-semibold text-slate-950">ERP System</p>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Welcome back</h2>
          <p className="mt-2 text-sm text-slate-600">Sign in to continue to your company workspace.</p>
          <div className="mt-8"><LoginForm /></div>
          <div className="mt-6 flex flex-col gap-2 text-center text-sm">
            <Link href="/register" className="font-medium text-blue-700 hover:underline">Create a new account</Link>
            <Link href="/register" className="font-medium text-blue-700 hover:underline">Register</Link>
            <Link href="/register/join-company" className="font-medium text-blue-700 hover:underline">Join Company</Link>
            <p className="text-slate-500">Already have an account? <Link href="/login" className="font-medium text-blue-700 hover:underline">Sign in</Link></p>
          </div>
          <p className="mt-8 text-center text-xs leading-5 text-slate-500">Access is provisioned by your organization administrator.</p>
        </div>
      </section>
    </main>
  );
}
