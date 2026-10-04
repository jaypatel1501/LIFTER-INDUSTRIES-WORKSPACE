import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { ValidationError } from "@/lib/errors";
import { OWNER_PERMISSIONS, grantPermissionsToRole } from "@/lib/company-permissions";
import { writeAuditLog } from "@/lib/audit";

const schema = z.object({
  email: z.string().email(),
  companyName: z.string().min(2).max(120),
  legalName: z.string().min(2).max(180).optional().or(z.literal("")),
  country: z.string().min(2).max(80).default("India"),
  currency: z.string().regex(/^[A-Z]{3}$/).default("INR"),
  timezone: z.string().min(2).max(80).default("Asia/Kolkata"),
  financialYearStartMonth: z.coerce.number().int().min(1).max(12).default(4),
  booksBeginningDate: z.string().date().optional().or(z.literal("")),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await readJson(request));
    const attempt = await prisma.registrationAttempt.findFirst({
      where: {
        email: input.email,
        status: { in: ["STARTED", "EMAIL_VERIFIED", "MOBILE_VERIFIED", "COMPLETED"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!attempt) throw new ValidationError("Complete your registration before creating a company.");

    const created = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findFirst({
        where: {
          OR: [
            { normalizedEmail: input.email },
            { email: input.email },
          ],
        },
      });

      if (!user) {
        user = await tx.user.create({
          data: {
            email: attempt.email,
            normalizedEmail: attempt.email,
            name: attempt.name,
            mobile: attempt.mobileNumber,
            mobileNumber: attempt.mobileNumber,
            normalizedMobileNumber: attempt.mobileNumber,
            passwordHash: attempt.passwordHash,
            emailVerifiedAt: attempt.emailVerifiedAt,
            mobileVerifiedAt: attempt.mobileVerifiedAt,
            status: "ACTIVE",
            onboardingStatus: "COMPANY_SETUP_PENDING",
            preferredLanguage: attempt.preferredLanguage,
            locale: attempt.preferredLanguage === "HINDI" ? "HI" : attempt.preferredLanguage === "BILINGUAL" ? "BILINGUAL" : "EN",
          },
        });
      } else {
        await tx.user.update({
          where: { id: user.id },
          data: {
            name: attempt.name || user.name,
            mobile: attempt.mobileNumber || user.mobile,
            mobileNumber: attempt.mobileNumber || user.mobileNumber,
            normalizedMobileNumber: attempt.mobileNumber || user.normalizedMobileNumber,
            emailVerifiedAt: attempt.emailVerifiedAt ?? user.emailVerifiedAt,
            mobileVerifiedAt: attempt.mobileVerifiedAt ?? user.mobileVerifiedAt,
            onboardingStatus: "COMPANY_SETUP_PENDING",
            preferredLanguage: attempt.preferredLanguage ?? user.preferredLanguage,
            locale: attempt.preferredLanguage === "HINDI" ? "HI" : attempt.preferredLanguage === "BILINGUAL" ? "BILINGUAL" : user.locale,
          },
        });
      }

      const company = await tx.company.create({
        data: {
          name: input.companyName,
          legalName: input.legalName || null,
          country: input.country,
          currency: input.currency,
          timezone: input.timezone,
          financialYearStartMonth: input.financialYearStartMonth,
          booksBeginningDate: input.booksBeginningDate ? new Date(input.booksBeginningDate) : null,
          memberships: { create: { userId: user.id, status: "ACTIVE", isDefault: true } },
          roles: { create: [{ name: "Owner", description: "Company owner", isSystem: true }, { name: "Member", description: "Standard member", isSystem: true }] },
        },
        include: { roles: true, memberships: true },
      });
      const ownerRole = company.roles.find((role) => role.name === "Owner");
      if (!ownerRole) throw new ValidationError("The company owner role could not be created.");
      const membership = company.memberships.find((entry) => entry.userId === user.id);
      if (!membership) throw new ValidationError("The user membership could not be created.");
      await grantPermissionsToRole(tx, ownerRole.id, OWNER_PERMISSIONS);
      await tx.membershipRole.create({
        data: { membershipId: membership.id, roleId: ownerRole.id },
      });
      await tx.registrationAttempt.update({
        where: { id: attempt.id },
        data: { createdUserId: user.id, status: "COMPLETED", selectedOnboardingPath: "CREATE_COMPANY" },
      });
      await writeAuditLog({
        companyId: company.id,
        actorId: user.id,
        action: "COMPANY_CREATED",
        entityType: "Company",
        entityId: company.id,
        changes: { name: company.name },
        ipAddress: "system",
      }, tx);
      return { userId: user.id, companyId: company.id };
    });

    return successResponse({ message: "Company created successfully.", userId: created.userId, companyId: created.companyId }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
