import bcrypt from "bcryptjs";
import { MembershipStatus, PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import { passwordSchema, emailSchema } from "../lib/validation/auth";
import { grantPermissionsToRole, OWNER_PERMISSIONS } from "../lib/company-permissions";
import { ensureDefaultChart } from "../lib/accounting/default-chart";
import { ensureDefaultInventoryMasters } from "../lib/inventory/defaults";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The development seed cannot run in production");
  }
  const email = emailSchema.parse(process.env.SEED_ADMIN_EMAIL);
  const password = passwordSchema.parse(process.env.SEED_ADMIN_PASSWORD);
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { normalizedEmail: email },
    create: {
      email,
      normalizedEmail: email,
      name: "Development Administrator",
      passwordHash,
      emailVerifiedAt: new Date(),
    },
    update: { passwordHash },
  });

  let membership = await prisma.membership.findFirst({
    where: { userId: user.id, status: MembershipStatus.ACTIVE },
    select: { id: true, companyId: true },
  });
  if (!membership) {
    const company = await prisma.company.create({
      data: {
        name: "Development Company",
        memberships: { create: { userId: user.id, status: MembershipStatus.ACTIVE, isDefault: true } },
        roles: {
          create: [
            { name: "Owner", description: "Development company owner", isSystem: true },
            { name: "Member", description: "Standard company member", isSystem: true },
          ],
        },
      },
      include: { roles: { select: { id: true, name: true } } },
    });
    const role = company.roles.find(({ name }) => name === "Owner");
    const memberRole = company.roles.find(({ name }) => name === "Member");
    if (!role) throw new Error("Could not create development owner role");
    if (!memberRole) throw new Error("Could not create development member role");
    membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_companyId: { userId: user.id, companyId: company.id } },
      select: { id: true, companyId: true },
    });

    await prisma.$transaction(async (tx) => {
      await grantPermissionsToRole(tx, role.id, OWNER_PERMISSIONS);
      await grantPermissionsToRole(tx, memberRole.id, [["company", "read"]]);
    });
    await prisma.membershipRole.upsert({
      where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
      create: { membershipId: membership.id, roleId: role.id },
      update: {},
    });
  }
  await prisma.$transaction(async (tx) => {
    await ensureDefaultChart(tx, membership!.companyId);
    await ensureDefaultInventoryMasters(tx, membership!.companyId);
  });
  console.info(`Development administrator provisioned: ${user.email}`);
}

main()
  .catch((error: unknown) => {
    console.error("Development seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
