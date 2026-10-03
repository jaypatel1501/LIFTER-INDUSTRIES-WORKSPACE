import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { requireEmailConfiguration, sendPasswordResetEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requestIp, readJson } from "@/lib/request";
import { createOpaqueToken, getPasswordResetUrl, hashSecret } from "@/lib/security";
import {
  resetCompleteSchema,
  resetRequestSchema,
} from "@/lib/validation/auth";
import { ValidationError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";

const tokenLifetimeMs = 30 * 60_000;

export async function POST(request: Request) {
  try {
    const ip = requestIp(request);
    await enforceRateLimit(rateLimitKey("password-reset-ip", ip), 5, 15 * 60_000);
    const input = resetRequestSchema.parse(await readJson(request));
    await enforceRateLimit(rateLimitKey("password-reset-email", input.email), 3, 15 * 60_000);
    requireEmailConfiguration();

    const user = await prisma.user.findUnique({
      where: { normalizedEmail: input.email },
      select: { id: true, email: true },
    });
    if (user) {
      const token = createOpaqueToken();
      await prisma.$transaction(async (tx) => {
        await tx.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashSecret(token),
            expiresAt: new Date(Date.now() + tokenLifetimeMs),
          },
        });
        const memberships = await tx.membership.findMany({
          where: { userId: user.id, status: "ACTIVE" },
          select: { companyId: true },
        });
        for (const membership of memberships) {
          await writeAuditLog(
            {
              companyId: membership.companyId,
              actorId: user.id,
              action: "AUTH_PASSWORD_RESET_REQUEST",
              entityType: "User",
              entityId: user.id,
              ipAddress: ip,
            },
            tx,
          );
        }
      });
      await sendPasswordResetEmail(user.email, getPasswordResetUrl(token));
    }
    return NextResponse.json(
      {
        success: true,
        data: { message: "If the account exists, a reset link has been sent." },
        error: null,
      },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const ip = requestIp(request);
    await enforceRateLimit(rateLimitKey("password-reset-complete-ip", ip), 5, 15 * 60_000);
    const input = resetCompleteSchema.parse(await readJson(request));
    const tokenHash = hashSecret(input.token);
    const reset = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });
    if (!reset || reset.usedAt || reset.expiresAt <= new Date()) {
      throw new ValidationError("This password reset link is invalid or expired");
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: reset.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) {
        throw new ValidationError("This password reset link is invalid or expired");
      }
      const user = await tx.user.update({
        where: { id: reset.userId },
        data: {
          passwordHash,
          emailVerifiedAt: now,
          failedLoginCount: 0,
          lockedUntil: null,
          sessionVersion: { increment: 1 },
        },
        select: { id: true, memberships: { select: { companyId: true } } },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });
      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      for (const membership of user.memberships) {
        await writeAuditLog(
          {
            companyId: membership.companyId,
            actorId: user.id,
            action: "AUTH_PASSWORD_RESET",
            entityType: "User",
            entityId: user.id,
            ipAddress: ip,
          },
          tx,
        );
      }
    });
    return successResponse({ message: "Password updated. You can now sign in." });
  } catch (error) {
    return errorResponse(error);
  }
}
