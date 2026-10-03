import { z } from "zod";
import { errorResponse, successResponse } from "@/lib/api-response";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { listOpenBills } from "@/lib/accounting/outstanding";

const querySchema = z.object({
  ledgerId: z.string().min(1).max(64).optional(),
  partyId: z.string().min(1).max(64).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(100).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(request: Request) {
  try {
    const context = await requirePermission("vouchers", "read");
    await enforceRateLimit(rateLimitKey("outstanding-bills", context.userId), 90, 60_000);
    const params = new URL(request.url).searchParams;
    const query = querySchema.parse({ ledgerId: params.get("ledgerId") ?? undefined, partyId: params.get("partyId") ?? undefined,
      search: params.get("search") ?? undefined, page: params.get("page") ?? undefined, pageSize: params.get("pageSize") ?? undefined });
    return successResponse(await listOpenBills(prisma, context.companyId, query));
  } catch (error) {
    return errorResponse(error);
  }
}
