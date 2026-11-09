import { auth } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { GSTManager } from "@/components/gst/gst-manager";

export const metadata = { title: "GST compliance" };
export const dynamic = "force-dynamic";

export default async function GSTPage() {
  const session = await auth();
  await requirePermission("company", "read");
  return <GSTManager locale={session!.locale} />;
}
