import { auth } from "@/lib/auth";
import { AuthorizationError, AuthenticationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) throw new AuthenticationError();
  return session;
}

export async function requireCompanyContext(companyId?: string) {
  const session = await requireSession();
  const activeCompanyId = companyId ?? session.activeCompanyId;
  if (!activeCompanyId) throw new AuthorizationError("Select an active company");

  const membership = await prisma.membership.findFirst({
    where: {
      userId: session.user.id,
      companyId: activeCompanyId,
      status: "ACTIVE",
    },
    select: {
      id: true,
      companyId: true,
      company: { select: { id: true, name: true, currency: true, timezone: true, booksBeginningDate: true } },
    },
  });
  if (!membership) throw new AuthorizationError("Active company membership required");

  return {
    userId: session.user.id,
    membershipId: membership.id,
    companyId: membership.companyId,
    company: membership.company,
  };
}

export async function requirePermission(resource: string, action: string) {
  const context = await requireCompanyContext();
  const permission = await prisma.permission.findFirst({
    where: {
      resource,
      action,
      roles: {
        some: {
          role: {
            companyId: context.companyId,
            memberships: { some: { membershipId: context.membershipId } },
          },
        },
      },
    },
    select: { id: true },
  });
  if (!permission) throw new AuthorizationError();
  return context;
}

export async function hasPermission(
  context: { membershipId: string; companyId: string },
  resource: string,
  action: string,
) {
  const permission = await prisma.permission.findFirst({
    where: {
      resource,
      action,
      roles: {
        some: {
          role: {
            companyId: context.companyId,
            memberships: { some: { membershipId: context.membershipId } },
          },
        },
      },
    },
    select: { id: true },
  });
  return permission !== null;
}

export function tenantWhere<T extends { companyId?: string }>(companyId: string, where?: T) {
  return { ...where, companyId };
}
