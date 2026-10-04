import { RegisterForm } from "@/components/auth/register-form";

export default function RegisterPage() {
  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[1.05fr_0.95fr]">
      <section className="hidden flex-col justify-between bg-slate-950 p-12 text-white lg:flex">
        <div className="flex items-center gap-3 text-lg font-semibold">
          <span className="grid size-10 place-items-center rounded-xl bg-blue-600 font-bold">E</span>
          ERP System
        </div>
        <div className="max-w-xl pb-10">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-blue-300">Business workspace</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">Create your secure ERP workspace.</h1>
          <p className="mt-5 max-w-md leading-7 text-slate-300">Start with a secure account and choose whether to create a company or join an existing one.</p>
        </div>
        <p className="text-sm text-slate-400">Built for Indian businesses · English and हिंदी</p>
      </section>
      <section className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-lg">
          <div className="mb-8">
            <p className="text-sm font-medium text-blue-700">Create account</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Register for ERP</h2>
          </div>
          <RegisterForm />
          <p className="mt-6 text-center text-sm text-slate-500">Already have an account? <a href="/login" className="font-medium text-blue-700 hover:underline">Sign in</a></p>
        </div>
      </section>
    </main>
  );
}
