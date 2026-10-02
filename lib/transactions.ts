import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export function withTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(operation, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5_000,
    timeout: 10_000,
  });
}
