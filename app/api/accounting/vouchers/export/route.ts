import { Prisma } from "@prisma/client";
import { errorResponse } from "@/lib/api-response";
import { voucherListQuerySchema } from "@/lib/validation/vouchers";
import { requirePermission } from "@/lib/permissions";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

function csv(value: unknown) {
  const text = String(value ?? "");
  const safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  try {
    const context = await requirePermission("vouchers", "read");
    await enforceRateLimit(rateLimitKey("voucher-export", context.userId), 20, 60_000);
    const params = new URL(request.url).searchParams;
    const query = voucherListQuerySchema.parse({ page: params.get("page") ?? "1", pageSize: params.get("pageSize") ?? "100",
      search: params.get("search") ?? undefined, type: params.get("type") ?? undefined, status: params.get("status") ?? undefined,
      from: params.get("from") ?? undefined, to: params.get("to") ?? undefined });
    if (query.from && query.to && query.from > query.to) throw new ValidationError("Start date must not be after end date");
    const where: Prisma.AccountingVoucherWhereInput = {
      companyId: context.companyId,
      ...(query.type ? { type: query.type } : {}), ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to ? { voucherDate: {
        ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
        ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
      } } : {}),
      ...(query.search ? { OR: [
        { voucherNumber: { contains: query.search, mode: "insensitive" } },
        { narration: { contains: query.search, mode: "insensitive" } },
        { paymentReference: { contains: query.search, mode: "insensitive" } },
      ] } : {}),
    };
    const vouchers = await prisma.accountingVoucher.findMany({ where, orderBy: [{ voucherDate: "desc" }, { voucherNumber: "desc" }],
      skip: (query.page - 1) * query.pageSize, take: query.pageSize,
      include: { lines: { orderBy: { lineNumber: "asc" }, include: { ledger: { select: { name: true } } } } } });
    const rows: unknown[][] = [["Voucher", "Date", "Type", "Status", "Payment method", "Payment reference", "Payment date", "Bank", "Ledger", "Description", "Debit", "Credit"]];
    for (const voucher of vouchers) {
      for (const line of voucher.lines) rows.push([
        voucher.voucherNumber, voucher.voucherDate.toISOString().slice(0, 10), voucher.type, voucher.status,
        voucher.paymentMethod, voucher.paymentReference, voucher.paymentDate?.toISOString().slice(0, 10), voucher.paymentBank,
        line.ledger.name, line.description, line.debit.toString(), line.credit.toString(),
      ]);
    }
    return new Response(rows.map((row) => row.map(csv).join(",")).join("\r\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=accounting-vouchers.csv", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
