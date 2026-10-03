import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { RateLimitError } from "@/lib/errors";

export async function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
) {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  const rows = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
    INSERT INTO "RateLimit" ("id", "key", "count", "resetAt", "createdAt")
    VALUES (${randomUUID()}, ${key}, 1, ${resetAt}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimit"."resetAt" <= ${now} THEN 1
        ELSE "RateLimit"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "RateLimit"."resetAt" <= ${now} THEN ${resetAt}
        ELSE "RateLimit"."resetAt"
      END
    RETURNING "count"
  `);
  const count = rows[0]?.count;
  if (count === undefined) throw new Error("Rate limit counter was not returned");
  if (count > limit) throw new RateLimitError();
}

export function rateLimitKey(scope: string, identifier: string) {
  return `${scope}:${identifier.trim().toLowerCase()}`;
}
