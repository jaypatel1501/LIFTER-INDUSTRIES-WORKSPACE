import { errorResponse, successResponse } from "@/lib/api-response";
import { getAuditLogs } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { z } from "zod";

const querySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().cuid().optional(),
});

export async function GET(request: Request) {
  try {
    const context = await requirePermission("audit", "read");
    const url = new URL(request.url);
    const query = querySchema.parse({
      take: url.searchParams.get("take") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    const entries = await getAuditLogs(context.companyId, query.take, query.cursor);
    return successResponse({
      entries,
      nextCursor: entries.at(-1)?.id ?? null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
