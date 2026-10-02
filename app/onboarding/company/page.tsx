import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { CompanyForm } from "@/components/onboarding/company-form";
import { getDictionary } from "@/lib/i18n";

export default async function CompanyOnboardingPage() {
  const session = await auth();
  if (!session?.user.id) redirect("/login");
  if (session.activeCompanyId) redirect("/dashboard");
  const copy = getDictionary(session.locale);
  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
        <div className="mb-7 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-blue-700 font-bold text-white">E</span>
          <span className="font-semibold text-slate-950">ERP System</span>
        </div>
        <h1 className="text-2xl font-semibold text-slate-950">{copy.setupTitle}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{copy.setupDescription}</p>
        <div className="mt-7"><CompanyForm locale={session.locale} /></div>
      </section>
    </main>
  );
}
