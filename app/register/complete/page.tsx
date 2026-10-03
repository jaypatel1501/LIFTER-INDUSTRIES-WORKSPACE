import Link from "next/link";

export default function RegistrationCompletePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium text-blue-700">Complete</p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-950">Registration is complete</h1>
        <p className="mt-3 text-slate-600">Your account has been verified and the onboarding path is ready. You can continue to the dashboard or sign in again.</p>
        <div className="mt-6 flex gap-3">
          <Link href="/dashboard" className="flex-1 rounded-lg bg-blue-700 px-4 py-3 text-center font-medium text-white">Open dashboard</Link>
          <Link href="/login" className="rounded-lg border border-slate-300 px-4 py-3 text-center font-medium text-slate-700">Sign in</Link>
        </div>
      </div>
    </main>
  );
}
