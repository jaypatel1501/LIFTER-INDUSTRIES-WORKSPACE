import type { Prisma } from "@prisma/client";
import { ConflictError } from "@/lib/errors";

export async function assertGSTPeriodOpen(
  tx: Prisma.TransactionClient,
  companyId: string,
  date: Date,
) {
  const periodKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  const period = await tx.gSTPeriod.findUnique({
    where: { companyId_periodKey: { companyId, periodKey } },
    select: { isLocked: true },
  });
  if (period?.isLocked) throw new ConflictError(`GST period ${periodKey} is locked`);
}
