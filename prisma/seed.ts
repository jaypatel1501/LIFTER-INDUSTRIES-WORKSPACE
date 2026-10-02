import bcrypt from "bcryptjs";
import { MembershipStatus, PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import { passwordSchema, emailSchema } from "../lib/validation/auth";

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
        roles: { create: { name: "Owner", description: "Development company owner", isSystem: true } },
      },
      include: { roles: { select: { id: true }, take: 1 } },
    });
    const role = company.roles[0];
    if (!role) throw new Error("Could not create development owner role");
    membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_companyId: { userId: user.id, companyId: company.id } },
      select: { id: true, companyId: true },
    });

    const permissions = [
      ["company", "read"],
      ["company", "update"],
      ["members", "read"],
      ["members", "invite"],
      ["roles", "manage"],
      ["audit", "read"],
      ["profile", "manage"],
    ] as const;
    for (const [resource, action] of permissions) {
      const permission = await prisma.permission.upsert({
        where: { resource_action: { resource, action } },
        create: { resource, action },
        update: {},
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        create: { roleId: role.id, permissionId: permission.id },
        update: {},
      });
    }
    await prisma.membershipRole.upsert({
      where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
      create: { membershipId: membership.id, roleId: role.id },
      update: {},
    });
  }
  console.info(`Development administrator provisioned: ${user.email}`);
}

main()
  .catch((error: unknown) => {
    console.error("Development seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
