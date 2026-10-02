import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { LocaleForm } from "@/components/preferences/locale-form";
import { PasswordForm } from "@/components/preferences/password-form";
import { getDictionary } from "@/lib/i18n";

export const metadata: Metadata = { title: "Preferences" };

export default async function PreferencesPage() {
  const session = await auth();
  if (!session?.user.id) return null;
  const copy = getDictionary(session.locale);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{copy.preferencesTitle}</h1>
        <p className="mt-2 text-sm text-slate-600">{copy.preferencesDescription}</p>
      </div>
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-950">{copy.languageTitle}</h2>
          <p className="mt-1 text-sm text-slate-600">{copy.languageDescription}</p>
        </CardHeader>
        <CardContent><LocaleForm locale={session.locale} /></CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-950">{copy.passwordTitle}</h2>
          <p className="mt-1 text-sm text-slate-600">{copy.passwordDescription}</p>
        </CardHeader>
        <CardContent><PasswordForm locale={session.locale} /></CardContent>
      </Card>
    </div>
  );
}
