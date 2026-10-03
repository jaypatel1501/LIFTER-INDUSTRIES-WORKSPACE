import { prisma } from "@/lib/prisma";

export async function getOpeningBooksDate(companyId: string, companyDate: Date | null) {
  if (companyDate) return companyDate.toISOString().slice(0, 10);
  const financialYear = await prisma.financialYear.findFirst({
    where: { companyId, status: "OPEN" },
    orderBy: { startDate: "desc" },
    select: { booksBeginningDate: true },
  });
  return financialYear?.booksBeginningDate.toISOString().slice(0, 10) ?? "";
}
