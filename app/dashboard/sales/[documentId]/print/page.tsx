import Link from "next/link";
import { notFound } from "next/navigation";
import { SalesPrintButton } from "@/components/sales/sales-print-button";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function address(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([, item]) =>
    typeof item === "string" && item.trim() ? [item] : [],
  );
}

function name(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const companyName = (value as Record<string, unknown>).name;
  return typeof companyName === "string" ? companyName : "";
}

export default async function PrintSalesInvoice({ params }: { params: Promise<{ documentId: string }> }) {
  const context = await requirePermission("sales", "read");
  const { documentId } = await params;
  const document = await prisma.salesDocument.findFirst({
    where: { id: documentId, companyId: context.companyId, documentType: "SALES_INVOICE" },
    include: { lines: { orderBy: { lineNumber: "asc" } }, voucher: { select: { voucherNumber: true } } },
  });
  if (!document) notFound();
  const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
  return (
    <main className="mx-auto max-w-5xl space-y-6 bg-white p-6 text-slate-950 print:max-w-none print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/dashboard/sales/${document.id}`} className="text-sm text-blue-700 hover:underline">← Back to document</Link>
        <SalesPrintButton />
      </div>
      <header className="border-b-2 border-slate-900 pb-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em]">Tax invoice · कर चालान</p>
        <h1 className="mt-2 text-3xl font-bold">{name(document.companySnapshot)}</h1>
        <p className="mt-1 text-sm">{address(document.companySnapshot).join(", ")}</p>
        <div className="mt-2 flex justify-center gap-6 text-sm">
          <span>GSTIN: {String((document.companySnapshot as Record<string, unknown>).gstin ?? "—")}</span>
          <span>PAN: {String((document.companySnapshot as Record<string, unknown>).pan ?? "—")}</span>
        </div>
      </header>
      <section className="grid gap-4 border-b border-slate-300 pb-4 sm:grid-cols-2">
        <div><h2 className="font-semibold">Bill to · बिल प्राप्तकर्ता</h2><p className="mt-1 font-medium">{name(document.partySnapshot)}</p><p className="text-sm">{address(document.billingAddress).join(", ")}</p><p className="text-sm">GSTIN: {String((document.partySnapshot as Record<string, unknown>).gstin ?? "—")}</p></div>
        <div className="sm:text-right"><h2 className="font-semibold">Invoice details · इनवॉइस विवरण</h2><p className="mt-1">Number: {document.documentNumber}</p><p>Date: {document.documentDate.toISOString().slice(0, 10)}</p><p>Due date: {document.dueDate?.toISOString().slice(0, 10) ?? "—"}</p><p>Accounting voucher: {document.voucher?.voucherNumber ?? "Not posted"}</p></div>
      </section>
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-y border-slate-800 text-left"><th className="p-2">#</th><th className="p-2">Description · विवरण</th><th className="p-2">HSN/SAC</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Rate</th><th className="p-2 text-right">Taxable</th><th className="p-2 text-right">Total</th></tr></thead>
        <tbody>{document.lines.map((line) => <tr key={line.id} className="border-b border-slate-200">
          <td className="p-2">{line.lineNumber}</td><td className="p-2">{line.description}</td><td className="p-2">{line.hsnSac ?? "—"}</td>
          <td className="p-2 text-right">{line.quantity.toString()} {line.unit}</td><td className="p-2 text-right">{currency.format(Number(line.unitRate))}</td>
          <td className="p-2 text-right">{currency.format(Number(line.taxableAmount))}</td>
          <td className="p-2 text-right">{currency.format(Number(line.taxableAmount.plus(line.cgstAmount).plus(line.sgstAmount).plus(line.utgstAmount).plus(line.igstAmount)))}</td>
        </tr>)}</tbody>
      </table>
      <section className="ml-auto max-w-sm space-y-1 border-t border-slate-400 pt-3 text-sm">
        <p className="flex justify-between"><span>Taxable amount · कर योग्य राशि</span><span>{currency.format(Number(document.taxableAmount))}</span></p>
        <p className="flex justify-between"><span>CGST</span><span>{currency.format(Number(document.cgstAmount))}</span></p>
        <p className="flex justify-between"><span>SGST</span><span>{currency.format(Number(document.sgstAmount))}</span></p>
        <p className="flex justify-between"><span>UTGST</span><span>{currency.format(Number(document.utgstAmount))}</span></p>
        <p className="flex justify-between"><span>IGST</span><span>{currency.format(Number(document.igstAmount))}</span></p>
        <p className="flex justify-between"><span>Freight / other charges</span><span>{currency.format(Number(document.freight.plus(document.otherCharges)))}</span></p>
        <p className="flex justify-between border-t border-slate-400 pt-2 text-base font-bold"><span>Total · कुल</span><span>{currency.format(Number(document.totalAmount))}</span></p>
      </section>
      <footer className="border-t border-slate-300 pt-4 text-xs text-slate-600">
        <p>Payment: {document.paymentMode ?? "—"} · Status: {document.status}</p>
        <p className="mt-2">This invoice is generated from the ERP accounting records. · यह इनवॉइस ERP लेखा रिकॉर्ड से बनाया गया है।</p>
      </footer>
    </main>
  );
}
