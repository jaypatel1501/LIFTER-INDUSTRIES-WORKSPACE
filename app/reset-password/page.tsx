import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
        <h1 className="text-2xl font-semibold text-slate-950">Choose a new password</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Reset links expire after 30 minutes and can only be used once.</p>
        <div className="mt-7">
          {token ? <ResetPasswordForm token={token} /> : <p className="text-sm text-red-700">This reset link is missing its token.</p>}
        </div>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-blue-700 hover:underline">Back to sign in</Link>
      </section>
    </main>
  );
}
