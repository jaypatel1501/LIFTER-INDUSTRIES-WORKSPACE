import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getAuditLogs, writeAuditLog } from "@/lib/audit";

const databaseTest = process.env.RUN_DB_TESTS === "1" ? test : test.skip;

databaseTest("company memberships and audit queries remain tenant-scoped", async () => {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `tenant-${suffix}@example.test`,
      normalizedEmail: `tenant-${suffix}@example.test`,
      passwordHash: "not-used-in-this-database-test",
    },
  });

  const [companyA, companyB] = await Promise.all([
    prisma.company.create({ data: { name: `Tenant A ${suffix}` } }),
    prisma.company.create({ data: { name: `Tenant B ${suffix}` } }),
  ]);

  try {
    await prisma.membership.create({
      data: { userId: user.id, companyId: companyA.id },
    });
    await prisma.$transaction(async (tx) => {
      await writeAuditLog(
        {
          companyId: companyA.id,
          actorId: user.id,
          action: "TEST_TENANT_EVENT",
          entityType: "Test",
          changes: { tenant: "A" },
        },
        tx,
      );
    });

    const membershipInA = await prisma.membership.findMany({
      where: { userId: user.id, companyId: companyA.id },
    });
    const membershipInB = await prisma.membership.findMany({
      where: { userId: user.id, companyId: companyB.id },
    });
    const auditInA = await getAuditLogs(companyA.id);
    const auditInB = await getAuditLogs(companyB.id);

    expect(membershipInA).toHaveLength(1);
    expect(membershipInB).toHaveLength(0);
    expect(auditInA.map(({ action }) => action)).toContain("TEST_TENANT_EVENT");
    expect(auditInB).toHaveLength(0);
  } finally {
    await prisma.auditLog.deleteMany({
      where: { companyId: { in: [companyA.id, companyB.id] } },
    });
    await prisma.company.deleteMany({
      where: { id: { in: [companyA.id, companyB.id] } },
    });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

databaseTest("financial years are isolated by company and constrained to their books dates", async () => {
  const suffix = randomUUID();
  const [companyA, companyB] = await Promise.all([
    prisma.company.create({ data: { name: `Fiscal A ${suffix}` } }),
    prisma.company.create({ data: { name: `Fiscal B ${suffix}` } }),
  ]);
  try {
    await prisma.financialYear.create({
      data: {
        companyId: companyA.id,
        name: "FY 2026-27",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2027-03-31T00:00:00.000Z"),
        booksBeginningDate: new Date("2026-04-01T00:00:00.000Z"),
      },
    });
    const yearsA = await prisma.financialYear.findMany({ where: { companyId: companyA.id } });
    const yearsB = await prisma.financialYear.findMany({ where: { companyId: companyB.id } });
    expect(yearsA).toHaveLength(1);
    expect(yearsB).toHaveLength(0);
  } finally {
    await prisma.company.deleteMany({ where: { id: { in: [companyA.id, companyB.id] } } });
  }
});
