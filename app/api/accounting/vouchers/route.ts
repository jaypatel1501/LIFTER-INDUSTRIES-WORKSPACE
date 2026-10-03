import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError, ValidationError } from "@/lib/errors";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { createVoucherDraft } from "@/lib/accounting/voucher-platform";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { voucherDraftSchema, voucherListQuerySchema } from "@/lib/validation/vouchers";

export async function GET(request: Request) {
  try {
    const context = await requirePermission("vouchers", "read");
    await enforceRateLimit(rateLimitKey("voucher-list", context.userId), 90, 60_000);
    const url = new URL(request.url);
    const query = voucherListQuerySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    if (query.from && query.to && query.from > query.to) throw new ValidationError("Start date must not be after end date");
    const where: Prisma.AccountingVoucherWhereInput = {
      companyId: context.companyId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to ? {
        voucherDate: {
          ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
          ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
        },
      } : {}),
      ...(query.search ? {
        OR: [
          { voucherNumber: { contains: query.search, mode: "insensitive" } },
          { narration: { contains: query.search, mode: "insensitive" } },
          { paymentReference: { contains: query.search, mode: "insensitive" } },
        ],
      } : {}),
    };
    const [vouchers, total] = await Promise.all([
      prisma.accountingVoucher.findMany({
        where,
        orderBy: [{ voucherDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          _count: { select: { lines: true, attachments: true, auditEvents: true } },
          lines: { select: { debit: true, credit: true } },
          reversalOf: { select: { id: true, voucherNumber: true } },
          reversals: { select: { id: true, voucherNumber: true } },
        },
      }),
      prisma.accountingVoucher.count({ where }),
    ]);
    return successResponse({
      vouchers: vouchers.map((voucher) => ({
        id: voucher.id,
        voucherNumber: voucher.voucherNumber,
        type: voucher.type,
        status: voucher.status,
        approvalStatus: voucher.approvalStatus,
        voucherDate: voucher.voucherDate.toISOString().slice(0, 10),
        narration: voucher.narration,
        paymentMethod: voucher.paymentMethod,
        paymentReference: voucher.paymentReference,
        debitTotal: voucher.lines.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0)).toString(),
        creditTotal: voucher.lines.reduce((sum, line) => sum.plus(line.credit), new Prisma.Decimal(0)).toString(),
        lineCount: voucher._count.lines,
        attachmentCount: voucher._count.attachments,
        reversalOf: voucher.reversalOf,
        reversals: voucher.reversals,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission("vouchers", "create");
    await enforceRateLimit(rateLimitKey("voucher-draft-write", context.userId), 30, 60_000);
    const input = voucherDraftSchema.parse(await readJson(request));
    const result = await createVoucherDraft(
      context,
      input,
      request.headers.get("Idempotency-Key"),
      {
        ipAddress: requestIp(request),
        ...(requestUserAgent(request) ? { userAgent: requestUserAgent(request) } : {}),
      },
    );
    return successResponse({ voucher: result.voucher, replayed: result.replayed }, result.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("Voucher number, payment reference, or idempotency key already exists"));
    }
    return errorResponse(error);
  }
}
