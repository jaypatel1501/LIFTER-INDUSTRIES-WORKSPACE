import { auth } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { DayBookManager } from "@/components/accounting/day-book-manager";

export const metadata = { title: "Day Book" };
export const dynamic = "force-dynamic";

export default async function DayBookPage() {
  const session = await auth();
  await requirePermission("vouchers", "read");
  return <DayBookManager locale={session!.locale} />;
}
