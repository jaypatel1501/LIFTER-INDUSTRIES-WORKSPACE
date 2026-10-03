import { prisma } from "@/lib/prisma";
import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { ValidationError } from "@/lib/errors";
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
  path: z.enum(["CREATE_COMPANY", "JOIN_COMPANY"]),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await readJson(request));
    const attempt = await prisma.registrationAttempt.findFirst({
      where: { email: input.email, status: { in: ["EMAIL_VERIFIED", "MOBILE_VERIFIED"] } },
      orderBy: { createdAt: "desc" },
    });
    if (!attempt) throw new ValidationError("Your registration must be verified before choosing a company path.");
    await prisma.registrationAttempt.update({
      where: { id: attempt.id },
      data: { selectedOnboardingPath: input.path },
    });
    return successResponse({ message: "Company path selected", path: input.path }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}
