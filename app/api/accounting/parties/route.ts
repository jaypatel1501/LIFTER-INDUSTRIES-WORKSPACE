import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { createPartyWithOpeningBalance } from "@/lib/accounting/opening-balance";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { accountingListQuerySchema, partyCreateSchema } from "@/lib/validation/accounting";

export async function GET(request: Request) {
  try {
    const context = await requirePermission("parties", "read");
    await enforceRateLimit(rateLimitKey("party-query", context.userId), 120, 60_000);
    const url = new URL(request.url);
    const query = accountingListQuerySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });
    const where: Prisma.PartyWhereInput = {
      companyId: context.companyId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { isActive: query.status === "ACTIVE" } : {}),
      ...(query.search ? {
        OR: [
          { name: { contains: query.search, mode: "insensitive" } },
          { gstin: { contains: query.search, mode: "insensitive" } },
          { pan: { contains: query.search, mode: "insensitive" } },
          { email: { contains: query.search, mode: "insensitive" } },
          { phone: { contains: query.search, mode: "insensitive" } },
        ],
      } : {}),
    };
    const [parties, total] = await Promise.all([
      prisma.party.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { ledger: { select: { id: true, name: true, group: { select: { id: true, name: true } } } } },
      }),
      prisma.party.count({ where }),
    ]);
    return successResponse({
      parties: parties.map((party) => ({ ...party, creditLimit: party.creditLimit.toString() })),
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
    const context = await requirePermission("parties", "create");
    await enforceRateLimit(rateLimitKey("party-create", context.userId), 30, 60_000);
    const input = partyCreateSchema.parse(await readJson(request));
    const result = await createPartyWithOpeningBalance(
      context,
      input,
      request.headers.get("Idempotency-Key"),
      {
        ipAddress: requestIp(request),
        ...(requestUserAgent(request) ? { userAgent: requestUserAgent(request) } : {}),
      },
    );
    return successResponse({
      party: { ...result.party, creditLimit: result.party.creditLimit.toString() },
      replayed: result.replayed,
    }, result.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("A party or linked ledger with this GSTIN, name, or idempotency key already exists"));
    }
    return errorResponse(error);
  }
}
