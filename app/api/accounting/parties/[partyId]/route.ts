import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { partyUpdateSchema } from "@/lib/validation/accounting";

type RouteContext = { params: Promise<{ partyId: string }> };

export async function GET(_request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("parties", "read");
    await enforceRateLimit(rateLimitKey("party-query", context.userId), 120, 60_000);
    const { partyId } = await route.params;
    const party = await prisma.party.findFirst({
      where: { id: partyId, companyId: context.companyId },
      include: {
        ledger: {
          include: {
            group: { select: { id: true, name: true, code: true } },
            voucherLines: {
              where: { voucher: { is: { companyId: context.companyId, status: { in: ["POSTED", "REVERSED"] } } } },
              orderBy: [{ voucher: { voucherDate: "desc" } }, { id: "desc" }],
              take: 20,
              include: {
                voucher: { select: { id: true, voucherNumber: true, type: true, voucherDate: true, narration: true } },
                billDetails: { select: { id: true, referenceNumber: true, dueDate: true, amount: true } },
              },
            },
          },
        },
      },
    });
    if (!party) throw new NotFoundError("Party not found");
    const totals = party.ledger
      ? await prisma.voucherLine.aggregate({
          where: { companyId: context.companyId, ledgerId: party.ledger.id, voucher: { is: { status: { in: ["POSTED", "REVERSED"] } } } },
          _sum: { debit: true, credit: true },
        })
      : null;
    const netBalance = new Prisma.Decimal(totals?._sum.debit?.toString() ?? "0")
      .minus(totals?._sum.credit?.toString() ?? "0");
    return successResponse({
      party: {
        ...party,
        creditLimit: party.creditLimit.toString(),
        ledger: party.ledger ? {
          ...party.ledger,
          interestRate: party.ledger.interestRate?.toString() ?? null,
          balanceDebit: netBalance.greaterThan(0) ? netBalance.toString() : "0",
          balanceCredit: netBalance.lessThan(0) ? netBalance.abs().toString() : "0",
          voucherLines: party.ledger.voucherLines.map((line) => ({
            ...line,
            debit: line.debit.toString(),
            credit: line.credit.toString(),
            billDetails: line.billDetails.map((bill) => ({ ...bill, amount: bill.amount.toString() })),
          })),
        } : null,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("parties", "update");
    await enforceRateLimit(rateLimitKey("party-write", context.userId), 40, 60_000);
    const { partyId } = await route.params;
    const input = partyUpdateSchema.parse(await readJson(request));
    const data: Prisma.PartyUpdateManyMutationInput = {
      ...(input.contactName !== undefined ? { contactName: input.contactName || null } : {}),
      ...(input.email !== undefined ? { email: input.email || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      ...(input.mobile !== undefined ? { mobile: input.mobile || null } : {}),
      ...(input.gstin !== undefined ? { gstin: input.gstin || null } : {}),
      ...(input.pan !== undefined ? { pan: input.pan || null } : {}),
      ...(input.addressLine1 !== undefined ? { addressLine1: input.addressLine1 || null } : {}),
      ...(input.addressLine2 !== undefined ? { addressLine2: input.addressLine2 || null } : {}),
      ...(input.city !== undefined ? { city: input.city || null } : {}),
      ...(input.state !== undefined ? { state: input.state || null } : {}),
      ...(input.stateCode !== undefined ? { stateCode: input.stateCode || null } : {}),
      ...(input.postalCode !== undefined ? { postalCode: input.postalCode || null } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.creditPeriodDays !== undefined ? { creditPeriodDays: input.creditPeriodDays } : {}),
      ...(input.creditLimit !== undefined ? { creditLimit: new Prisma.Decimal(input.creditLimit) } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.party.findFirst({
        where: { id: partyId, companyId: context.companyId },
        select: { id: true, type: true, name: true, isActive: true, gstin: true, pan: true, stateCode: true },
      });
      if (!current) throw new NotFoundError("Party not found");
      const nextGstin = input.gstin === undefined ? current.gstin : input.gstin || null;
      const nextPan = input.pan === undefined ? current.pan : input.pan || null;
      const nextStateCode = input.stateCode === undefined ? current.stateCode : input.stateCode || null;
      if (nextGstin && nextPan && nextGstin.slice(2, 12) !== nextPan) {
        throw new ValidationError("GSTIN and PAN must match");
      }
      if (nextGstin && nextStateCode && nextGstin.slice(0, 2) !== nextStateCode) {
        throw new ValidationError("GSTIN and state code must match");
      }
      const result = await tx.party.updateMany({ where: { id: partyId, companyId: context.companyId }, data });
      if (result.count !== 1) throw new NotFoundError("Party not found");
      const party = await tx.party.findUniqueOrThrow({
        where: { id: partyId },
        include: { ledger: { select: { id: true, name: true } } },
      });
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "PARTY_UPDATED",
        entityType: "Party",
        entityId: partyId,
        changes: { before: current, after: input },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return party;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return successResponse({ party: { ...updated, creditLimit: updated.creditLimit.toString() } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("Another party already uses this GSTIN"));
    }
    return errorResponse(error);
  }
}
