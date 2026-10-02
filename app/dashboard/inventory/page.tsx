import { auth } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { getOpeningBooksDate } from "@/lib/accounting/opening-date";
import { prisma } from "@/lib/prisma";
import { StockItemsManager } from "@/components/inventory/stock-items-manager";

export const metadata = { title: "Stock items" };
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const session = await auth();
  const context = await requirePermission("inventory", "read");
  const canCreate = await hasPermission(context, "inventory", "create");
  const booksBeginningDate = await getOpeningBooksDate(context.companyId, context.company.booksBeginningDate);
  const [canReadGroups, canReadUnits, canReadWarehouses] = await Promise.all([
    hasPermission(context, "stock-groups", "read").then((allowed) => allowed || canCreate),
    hasPermission(context, "units", "read").then((allowed) => allowed || canCreate),
    hasPermission(context, "warehouses", "read").then((allowed) => allowed || canCreate),
  ]);
  const [groups, units, warehouses] = await Promise.all([
    prisma.stockGroup.findMany({ where: { companyId: context.companyId }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }),
    prisma.unitOfMeasure.findMany({ where: { companyId: context.companyId }, orderBy: { name: "asc" }, select: { id: true, name: true, symbol: true, precision: true } }),
    prisma.warehouse.findMany({ where: { companyId: context.companyId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, isActive: true } }),
  ]);
  return <StockItemsManager
    locale={session!.locale}
    canCreate={canCreate}
    booksBeginningDate={booksBeginningDate}
    companyCurrency={context.company.currency}
    options={{ groups: canReadGroups ? groups : [], units: canReadUnits ? units : [], warehouses: canReadWarehouses ? warehouses : [] }}
  />;
}
