import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { updateVoucherDraft } from "@/lib/accounting/voucher-platform";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { voucherDraftSchema } from "@/lib/validation/vouchers";

type RouteContext = { params: Promise<{ voucherId: string }> };

export async function GET(_request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("vouchers", "read");
    await enforceRateLimit(rateLimitKey("voucher-read", context.userId), 120, 60_000);
    const { voucherId } = await route.params;
    const voucher = await prisma.accountingVoucher.findFirst({
      where: { id: voucherId, companyId: context.companyId },
      include: {
        financialYear: { select: { id: true, name: true } },
        numberSeries: { select: { id: true, prefix: true, suffix: true, requiresApproval: true } },
        lines: {
          orderBy: { lineNumber: "asc" },
          include: {
            ledger: { select: { id: true, name: true, code: true, type: true } },
            billEntries: true,
            taxDetails: { include: { taxLedger: { select: { id: true, name: true, code: true } } } },
            costAllocations: { include: { costCentre: { select: { id: true, name: true, code: true } } } },
            inventoryDetails: {
              include: {
                item: { select: { id: true, name: true, code: true } },
                warehouse: { select: { id: true, name: true, code: true } },
              },
            },
          },
        },
        attachments: { orderBy: { createdAt: "asc" } },
        approvals: { orderBy: { createdAt: "asc" } },
        auditEvents: { orderBy: { createdAt: "asc" } },
        reversalOf: { select: { id: true, voucherNumber: true } },
        reversals: { select: { id: true, voucherNumber: true } },
      },
    });
    if (!voucher) throw new NotFoundError("Voucher not found in the current company");
    return successResponse({ voucher });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("vouchers", "update");
    await enforceRateLimit(rateLimitKey("voucher-draft-write", context.userId), 30, 60_000);
    const { voucherId } = await route.params;
    const input = voucherDraftSchema.parse(await readJson(request));
    const voucher = await updateVoucherDraft(context, voucherId, input, {
      ipAddress: requestIp(request),
      ...(requestUserAgent(request) ? { userAgent: requestUserAgent(request) } : {}),
    });
    return successResponse({ voucher });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("Voucher metadata conflicts with an existing number, payment reference or attachment"));
    }
    return errorResponse(error);
  }
}
