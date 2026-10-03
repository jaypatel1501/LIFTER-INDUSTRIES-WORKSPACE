import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function SalesDocumentPage({ params }: { params: Promise<{ documentId: string }> }) {
  const context = await requirePermission("sales", "read");
  const { documentId } = await params;
  const document = await prisma.salesDocument.findFirst({
    where: { id: documentId, companyId: context.companyId },
    include: {
      party: { select: { name: true, gstin: true, email: true, mobile: true } },
      sourceDocument: { select: { id: true, documentNumber: true, documentType: true } },
      voucher: { select: { id: true, voucherNumber: true, status: true } },
      lines: { orderBy: { lineNumber: "asc" } },
      events: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!document) notFound();
  const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/dashboard/sales" className="text-sm text-blue-700 hover:underline">← Sales</Link>
          <h1 className="mt-2 text-2xl font-semibold">{document.documentNumber}</h1>
          <p className="text-sm text-slate-600">{document.documentType.replaceAll("_", " ")} · {document.status}</p>
        </div>
        {document.documentType === "SALES_INVOICE" && <Button asChild variant="secondary"><Link href={`/dashboard/sales/${document.id}/print`}>Print invoice · प्रिंट</Link></Button>}
      </header>
      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-3">
        <div><p className="text-xs uppercase text-slate-500">Customer · ग्राहक</p><p className="mt-1 font-semibold">{document.party.name}</p><p className="text-sm text-slate-600">{document.party.gstin ?? "—"}</p></div>
        <div><p className="text-xs uppercase text-slate-500">Document date · तारीख</p><p className="mt-1">{document.documentDate.toISOString().slice(0, 10)}</p><p className="text-sm text-slate-600">Due: {document.dueDate?.toISOString().slice(0, 10) ?? "—"}</p></div>
        <div><p className="text-xs uppercase text-slate-500">Amount · राशि</p><p className="mt-1 text-xl font-semibold">{currency.format(Number(document.totalAmount))}</p><p className="text-sm text-slate-600">Voucher: {document.voucher?.voucherNumber ?? "Not posted"}</p></div>
      </section>
      {document.sourceDocument && <section className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm">
        Converted from <Link className="font-medium text-blue-800 hover:underline" href={`/dashboard/sales/${document.sourceDocument.id}`}>{document.sourceDocument.documentNumber} · {document.sourceDocument.documentType.replaceAll("_", " ")}</Link>
      </section>}
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-semibold">Lines · पंक्तियाँ</h2>
        <table className="w-full min-w-[650px] text-left text-sm">
          <thead><tr className="border-b text-slate-500"><th className="py-2">Item</th><th>HSN/SAC</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Taxable</th><th className="text-right">GST</th></tr></thead>
          <tbody>{document.lines.map((line) => <tr key={line.id} className="border-b border-slate-100"><td className="py-3">{line.description}</td><td>{line.hsnSac ?? "—"}</td><td className="text-right">{line.quantity.toString()} {line.unit}</td><td className="text-right">{currency.format(Number(line.unitRate))}</td><td className="text-right">{currency.format(Number(line.taxableAmount))}</td><td className="text-right">{currency.format(Number(line.cgstAmount.plus(line.sgstAmount).plus(line.utgstAmount).plus(line.igstAmount)))}</td></tr>)}</tbody>
        </table>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-semibold">History · इतिहास</h2>
        {!document.events.length ? <p className="text-sm text-slate-600">No events recorded.</p> : <ol className="space-y-3">{document.events.map((event) => <li key={event.id} className="border-l-2 border-blue-200 pl-3"><p className="text-sm font-medium">{event.eventType.replaceAll("_", " ")}</p><time className="text-xs text-slate-500">{event.createdAt.toLocaleString()}</time></li>)}</ol>}
      </section>
    </div>
  );
}
