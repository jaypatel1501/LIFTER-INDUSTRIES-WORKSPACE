import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { verifyCompanySwitchProof, verifySecret } from "@/lib/security";
import { otpVerifySchema, passwordLoginSchema } from "@/lib/validation/auth";
import { writeAuditLog } from "@/lib/audit";
import { requestIp, requestUserAgent } from "@/lib/request";

const authSecret = env.AUTH_SECRET;
const sessionLifetimeMs = 8 * 60 * 60_000;

function requestedCompanySwitch(value: unknown) {
  if (
    typeof value !== "object" ||
    value === null ||
    !("activeCompanyId" in value) ||
    !("switchProof" in value)
  ) {
    return undefined;
  }
  const companyId = value.activeCompanyId;
  const switchProof = value.switchProof;
  return typeof companyId === "string" &&
    companyId.length <= 64 &&
    typeof switchProof === "string" &&
    switchProof.length <= 2048
    ? { companyId, switchProof }
    : undefined;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...(authSecret ? { secret: authSecret } : {}),
  trustHost: true,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      id: "credentials",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCredentials, request) {
        const input = passwordLoginSchema.safeParse(rawCredentials);
        if (!input.success) return null;
        const ipAddress = requestIp(request);
        const userAgent = requestUserAgent(request);
        await enforceRateLimit(rateLimitKey("login-ip", ipAddress), 5, 15 * 60_000);
        await enforceRateLimit(rateLimitKey("login-email", input.data.email), 5, 15 * 60_000);

        const user = await prisma.user.findUnique({
          where: { normalizedEmail: input.data.email },
          include: {
            memberships: {
              where: { status: "ACTIVE" },
              orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
              take: 1,
              select: { companyId: true },
            },
          },
        });
        const now = new Date();
        const verified = user && (!user.lockedUntil || user.lockedUntil <= now)
          ? await bcrypt.compare(input.data.password, user.passwordHash)
          : false;

        if (!user || !verified) {
          if (user) {
            await prisma.$transaction(async (tx) => {
              const failedUser = await tx.user.update({
                where: { id: user.id },
                data: {
                  failedLoginCount: { increment: 1 },
                },
                select: { failedLoginCount: true },
              });
              await tx.loginHistory.create({
                data: { userId: user.id, success: false, ipAddress, userAgent: userAgent ?? null },
              });
              for (const membership of user.memberships) {
                await writeAuditLog(
                  {
                    companyId: membership.companyId,
                    actorId: user.id,
                    action: "AUTH_LOGIN_FAILED",
                    entityType: "User",
                    entityId: user.id,
                    ipAddress,
                    userAgent,
                  },
                  tx,
                );
              }
              if (failedUser.failedLoginCount >= 5) {
                await tx.user.update({
                  where: { id: user.id },
                  data: { lockedUntil: new Date(now.getTime() + 15 * 60_000) },
                });
              }
            });
          }
          return null;
        }

        const sessionTokenId = randomUUID();
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: { failedLoginCount: 0, lockedUntil: null },
          });
          await tx.loginHistory.create({
            data: { userId: user.id, success: true, ipAddress, userAgent: userAgent ?? null },
          });
          await tx.authSession.create({
            data: {
              tokenId: sessionTokenId,
              userId: user.id,
              ipAddress,
              userAgent: userAgent ?? null,
              expiresAt: new Date(now.getTime() + sessionLifetimeMs),
            },
          });
          for (const { companyId } of user.memberships) {
            await writeAuditLog(
              {
                companyId,
                actorId: user.id,
                action: "AUTH_LOGIN",
                entityType: "User",
                entityId: user.id,
                ipAddress,
                userAgent,
              },
              tx,
            );
          }
        });
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          activeCompanyId: user.memberships[0]?.companyId ?? null,
          sessionVersion: user.sessionVersion,
          locale: user.locale,
          sessionTokenId,
        };
      },
    }),
    Credentials({
      id: "otp",
      name: "Mobile OTP",
      credentials: {
        mobile: { label: "Mobile", type: "tel" },
        code: { label: "One-time code", type: "text" },
      },
      async authorize(rawCredentials, request) {
        const input = otpVerifySchema.safeParse(rawCredentials);
        if (!input.success) return null;
        const ipAddress = requestIp(request);
        await enforceRateLimit(rateLimitKey("otp-verify-ip", ipAddress), 5, 15 * 60_000);
        await enforceRateLimit(rateLimitKey("otp-verify", input.data.mobile), 5, 15 * 60_000);

        const user = await prisma.user.findUnique({
          where: { mobile: input.data.mobile },
          include: {
            memberships: {
              where: { status: "ACTIVE" },
              orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
              take: 1,
              select: { companyId: true },
            },
          },
        });
        if (!user) return null;
        const challenge = await prisma.otpChallenge.findFirst({
          where: {
            userId: user.id,
            purpose: "LOGIN",
            consumedAt: null,
            expiresAt: { gt: new Date() },
            attempts: { lt: 5 },
          },
          orderBy: { createdAt: "desc" },
        });
        if (!challenge) return null;

        const valid = verifySecret(input.data.code, challenge.codeHash);
        const sessionTokenId = randomUUID();
        const userAgent = requestUserAgent(request);
        const accepted = await prisma.$transaction(async (tx) => {
          const changed = await tx.otpChallenge.updateMany({
            where: {
              id: challenge.id,
              consumedAt: null,
              expiresAt: { gt: new Date() },
              attempts: { lt: 5 },
            },
            data: valid ? { consumedAt: new Date() } : { attempts: { increment: 1 } },
          });
          if (changed.count !== 1) return false;
          await tx.loginHistory.create({
            data: {
              userId: user.id,
              success: valid,
              ipAddress,
              userAgent: userAgent ?? null,
            },
          });
          if (!valid) {
            for (const membership of user.memberships) {
              await writeAuditLog(
                {
                  companyId: membership.companyId,
                  actorId: user.id,
                  action: "AUTH_OTP_LOGIN_FAILED",
                  entityType: "User",
                  entityId: user.id,
                  ipAddress,
                  userAgent,
                },
                tx,
              );
            }
          }
          if (valid) {
            await tx.authSession.create({
              data: {
                tokenId: sessionTokenId,
                userId: user.id,
                ipAddress,
                userAgent: userAgent ?? null,
                expiresAt: new Date(Date.now() + sessionLifetimeMs),
              },
            });
            for (const membership of user.memberships) {
              await writeAuditLog(
                {
                  companyId: membership.companyId,
                  actorId: user.id,
                  action: "AUTH_LOGIN_OTP",
                  entityType: "User",
                  entityId: user.id,
                  ipAddress,
                  userAgent,
                },
                tx,
              );
            }
          }
          return true;
        });
        if (!valid || !accepted) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          activeCompanyId: user.memberships[0]?.companyId ?? null,
          sessionVersion: user.sessionVersion,
          locale: user.locale,
          sessionTokenId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user && typeof user.id === "string") {
        token.userId = user.id;
        token.activeCompanyId = user.activeCompanyId;
        token.sessionVersion = user.sessionVersion;
        token.locale = user.locale;
        token.sessionTokenId = user.sessionTokenId;
      }

      if (typeof token.userId !== "string" || !token.userId) return token;
      const currentUser = await prisma.user.findUnique({
        where: { id: token.userId },
        select: { sessionVersion: true, locale: true },
      });
      const activeSession = currentUser && typeof token.sessionTokenId === "string"
        ? await prisma.authSession.findFirst({
            where: {
              tokenId: token.sessionTokenId,
              userId: token.userId,
              revokedAt: null,
              expiresAt: { gt: new Date() },
            },
            select: { id: true },
          })
        : null;
      if (!currentUser || currentUser.sessionVersion !== token.sessionVersion || !activeSession) {
        token.userId = "";
        token.activeCompanyId = null;
        return token;
      }
      token.locale = currentUser.locale;

      const companySwitch = requestedCompanySwitch(session);
      if (
        trigger === "update" &&
        companySwitch &&
        companySwitch.companyId !== token.activeCompanyId &&
        typeof token.sessionTokenId === "string"
      ) {
        await enforceRateLimit(
          rateLimitKey("company-switch-session", token.sessionTokenId),
          30,
          60_000,
        );
        const claims = verifyCompanySwitchProof(companySwitch.switchProof, {
          userId: token.userId,
          companyId: companySwitch.companyId,
        });
        if (claims) {
          const membership = await prisma.membership.findFirst({
            where: {
              userId: token.userId,
              companyId: companySwitch.companyId,
              status: "ACTIVE",
            },
            select: { companyId: true },
          });
          if (membership) {
            await writeAuditLog({
              companyId: membership.companyId,
              actorId: token.userId,
              action: "COMPANY_SWITCHED",
              entityType: "Company",
              entityId: membership.companyId,
              changes: {
                from: typeof token.activeCompanyId === "string"
                  ? token.activeCompanyId
                  : null,
                to: membership.companyId,
              },
              ipAddress: claims.ipAddress,
              userAgent: claims.userAgent ?? undefined,
            });
            token.activeCompanyId = membership.companyId;
          }
        }
      }

      const activeMembership = token.activeCompanyId
        ? await prisma.membership.findFirst({
            where: {
              userId: token.userId,
              companyId: token.activeCompanyId,
              status: "ACTIVE",
            },
            select: { companyId: true },
          })
        : null;
      if (!activeMembership) {
        const fallback = await prisma.membership.findFirst({
          where: { userId: token.userId, status: "ACTIVE" },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          select: { companyId: true },
        });
        token.activeCompanyId = fallback?.companyId ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      const locale = token.locale === "HI" || token.locale === "BILINGUAL"
        ? token.locale
        : "EN";
      session.user.id = typeof token.userId === "string" ? token.userId : "";
      session.user.locale = locale;
      session.activeCompanyId = typeof token.activeCompanyId === "string"
        ? token.activeCompanyId
        : null;
      session.locale = locale;
      return session;
    },
  },
  events: {
    async signOut(message) {
      if ("token" in message && typeof message.token?.sessionTokenId === "string") {
        await prisma.authSession.updateMany({
          where: { tokenId: message.token.sessionTokenId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    },
  },
});
