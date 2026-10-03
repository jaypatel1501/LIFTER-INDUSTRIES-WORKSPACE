import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { createLedgerWithOpeningBalance } from "@/lib/accounting/opening-balance";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { accountingListQuerySchema, ledgerCreateSchema } from "@/lib/validation/accounting";

export async function GET(request: Request) {
  try {
    const context = await requirePermission("ledgers", "read");
    await enforceRateLimit(rateLimitKey("ledger-query", context.userId), 120, 60_000);
    const url = new URL(request.url);
    const query = accountingListQuerySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      groupId: url.searchParams.get("groupId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });
    const where: Prisma.LedgerWhereInput = {
      companyId: context.companyId,
      ...(query.groupId ? { groupId: query.groupId } : {}),
      ...(query.status ? { isActive: query.status === "ACTIVE" } : {}),
      ...(query.search ? {
        OR: [
          { name: { contains: query.search, mode: "insensitive" } },
          { code: { contains: query.search, mode: "insensitive" } },
          { party: { is: { name: { contains: query.search, mode: "insensitive" } } } },
        ],
      } : {}),
    };
    const [ledgers, total] = await Promise.all([
      prisma.ledger.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          group: { select: { id: true, name: true, code: true, nature: true } },
          party: { select: { id: true, type: true, gstin: true } },
        },
      }),
      prisma.ledger.count({ where }),
    ]);
    return successResponse({
      ledgers: ledgers.map((ledger) => ({ ...ledger, interestRate: ledger.interestRate?.toString() ?? null })),
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
    const context = await requirePermission("ledgers", "create");
    await enforceRateLimit(rateLimitKey("ledger-create", context.userId), 30, 60_000);
    const input = ledgerCreateSchema.parse(await readJson(request));
    const result = await createLedgerWithOpeningBalance(
      context,
      input,
      request.headers.get("Idempotency-Key"),
      {
        ipAddress: requestIp(request),
        ...(requestUserAgent(request) ? { userAgent: requestUserAgent(request) } : {}),
      },
    );
    return successResponse({
      ledger: { ...result.ledger, interestRate: result.ledger.interestRate?.toString() ?? null },
      replayed: result.replayed,
    }, result.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("A ledger with this name, code, or idempotency key already exists"));
    }
    return errorResponse(error);
  }
}
