import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertGSTPeriodOpen } from "@/lib/gst/period";
import { withTransaction } from "@/lib/transactions";

const databaseTest = process.env.RUN_DB_TESTS === "1" ? test : test.skip;

databaseTest("GST periods enforce company isolation and reject postings after lock", async () => {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `gst-period-${suffix}@example.test`,
      normalizedEmail: `gst-period-${suffix}@example.test`,
      passwordHash: "not-used-in-this-database-test",
    },
  });
  const [companyA, companyB] = await Promise.all([
    prisma.company.create({ data: { name: `GST period A ${suffix}` } }),
    prisma.company.create({ data: { name: `GST period B ${suffix}` } }),
  ]);
  try {
    await prisma.gSTPeriod.create({
      data: {
        companyId: companyA.id,
        periodKey: "2026-04",
        isLocked: true,
        lockedAt: new Date("2026-05-01T00:00:00.000Z"),
        lockedById: user.id,
        lockReason: "Return finalized",
      },
    });

    await expect(withTransaction((tx) =>
      assertGSTPeriodOpen(tx, companyA.id, new Date("2026-04-15T00:00:00.000Z")),
    )).rejects.toThrow("GST period 2026-04 is locked");
    await expect(withTransaction((tx) =>
      assertGSTPeriodOpen(tx, companyB.id, new Date("2026-04-15T00:00:00.000Z")),
    )).resolves.toBeUndefined();
    await expect(prisma.gSTPeriodEvent.create({
      data: {
        companyId: companyB.id,
        periodId: (await prisma.gSTPeriod.findUniqueOrThrow({
          where: { companyId_periodKey: { companyId: companyA.id, periodKey: "2026-04" } },
        })).id,
        actorId: user.id,
        action: "LOCK",
        reason: "Cross-company event",
        idempotencyKey: `cross-company-${suffix}`,
        requestHash: "test",
      },
    })).rejects.toMatchObject({ code: "P2003" });
  } finally {
    await prisma.company.deleteMany({ where: { id: { in: [companyA.id, companyB.id] } } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
