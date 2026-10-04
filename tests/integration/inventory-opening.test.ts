import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureDefaultInventoryMasters } from "@/lib/inventory/defaults";
import { createStockItemWithOpening } from "@/lib/inventory/stock-item-service";
import { stockItemCreateSchema } from "@/lib/validation/inventory";

const databaseTest = process.env.RUN_DB_TESTS === "1" ? test : test.skip;

databaseTest("opening stock is idempotent, balanced and isolated to its company", async () => {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `inventory-${suffix}@example.test`,
      normalizedEmail: `inventory-${suffix}@example.test`,
      passwordHash: "not-used-in-this-database-test",
    },
  });
  const [company, otherCompany] = await Promise.all([
    prisma.company.create({
      data: { name: `Inventory ${suffix}`, booksBeginningDate: new Date("2026-04-01T00:00:00.000Z") },
    }),
    prisma.company.create({ data: { name: `Other inventory ${suffix}` } }),
  ]);
  const context = { companyId: company.id, userId: user.id };

  try {
    const defaults = await prisma.$transaction(
      (tx) => ensureDefaultInventoryMasters(tx, company.id),
      { timeout: 30_000 },
    );
    const input = stockItemCreateSchema.parse({
      name: "Opening Stock Test",
      code: `OPEN-${suffix.slice(0, 8).toUpperCase()}`,
      groupId: defaults.groups.get("GENERAL"),
      baseUnitId: defaults.units.get("pcs"),
      gstRate: "5",
      purchaseRate: "10",
      salesRate: "15",
      openingDate: "2026-04-01",
      openingStock: [{
        warehouseId: defaults.warehouseId,
        quantity: "2",
        unitCost: "10.1234",
      }],
    });
    const first = await createStockItemWithOpening(context, input, `opening-${suffix}`, {});
    const replay = await createStockItemWithOpening(context, input, `opening-${suffix}`, {});
    const [balances, movements, vouchers, otherTenantItem] = await Promise.all([
      prisma.stockBalance.findMany({ where: { companyId: company.id, itemId: first.item.id } }),
      prisma.inventoryMovement.findMany({ where: { companyId: company.id, itemId: first.item.id } }),
      prisma.accountingVoucher.findMany({ where: { companyId: company.id, type: "OPENING_BALANCE" }, include: { lines: true } }),
      prisma.stockItem.findFirst({ where: { companyId: otherCompany.id, id: first.item.id } }),
    ]);
    const balance = balances[0];
    const voucher = vouchers[0];
    if (!balance || !voucher) throw new Error("Opening stock must create a stock balance and an accounting voucher");
    const debit = voucher.lines.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0));
    const credit = voucher.lines.reduce((sum, line) => sum.plus(line.credit), new Prisma.Decimal(0));

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.item.id).toBe(first.item.id);
    expect(balances).toHaveLength(1);
    expect(balance.quantity.toString()).toBe("2");
    expect(balance.value.toString()).toBe("20.25");
    expect(movements).toHaveLength(1);
    expect(vouchers).toHaveLength(1);
    expect(debit.equals(credit)).toBe(true);
    expect(debit.toString()).toBe(balance.value.toString());
    expect(otherTenantItem).toBeNull();
  } finally {
    const tenant = { companyId: company.id };

    await prisma.auditLog.deleteMany({ where: tenant });
    await prisma.inventoryMovement.deleteMany({ where: tenant });
    await prisma.stockBalance.deleteMany({ where: tenant });
    await prisma.billWiseEntry.deleteMany({ where: tenant });
    await prisma.billWiseOpening.deleteMany({ where: tenant });
    await prisma.ledgerTransaction.deleteMany({ where: tenant });
    await prisma.taxTransaction.deleteMany({ where: tenant });
    await prisma.voucherTaxDetail.deleteMany({ where: tenant });
    await prisma.costAllocation.deleteMany({ where: tenant });
    await prisma.voucherStockDetail.deleteMany({ where: tenant });
    await prisma.voucherAttachment.deleteMany({ where: tenant });
    await prisma.voucherApprovalAction.deleteMany({ where: tenant });
    await prisma.voucherAuditEvent.deleteMany({ where: tenant });
    await prisma.dayBookEntry.deleteMany({ where: tenant });

    await prisma.itemUnitConversion.deleteMany({ where: tenant });
    await prisma.inventoryBatch.deleteMany({ where: tenant });
    await prisma.stockItem.deleteMany({ where: tenant });
    await prisma.voucherLine.deleteMany({ where: tenant });
    await prisma.accountingVoucher.deleteMany({ where: tenant });
    await prisma.ledger.deleteMany({ where: tenant });
    await prisma.ledgerGroup.updateMany({ where: tenant, data: { parentId: null } });
    await prisma.ledgerGroup.deleteMany({ where: tenant });
    await prisma.stockGroup.updateMany({ where: tenant, data: { parentId: null } });
    await prisma.stockGroup.deleteMany({ where: tenant });
    await prisma.unitConversion.deleteMany({ where: tenant });
    await prisma.unitOfMeasure.deleteMany({ where: tenant });
    await prisma.warehouse.updateMany({ where: tenant, data: { parentId: null } });
    await prisma.warehouse.deleteMany({ where: tenant });
    await prisma.company.deleteMany({ where: { id: { in: [company.id, otherCompany.id] } } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
});
