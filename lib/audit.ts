import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type AuditInput = {
  companyId: string;
  actorId?: string | undefined;
  action: string;
  entityType: string;
  entityId?: string | undefined;
  changes?: Prisma.InputJsonValue | undefined;
  reason?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
};

export async function writeAuditLog(
  input: AuditInput,
  tx: Prisma.TransactionClient = prisma,
) {
  return tx.auditLog.create({
    data: {
      companyId: input.companyId,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      ...(input.changes !== undefined ? { changes: input.changes } : {}),
      reason: input.reason ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

export async function getAuditLogs(companyId: string, take = 50, cursor?: string) {
  return prisma.auditLog.findMany({
    where: { companyId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(take, 1), 100),
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });
}
