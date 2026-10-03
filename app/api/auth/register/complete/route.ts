import { prisma } from "@/lib/prisma";
import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { ValidationError } from "@/lib/errors";
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await readJson(request));
    const attempt = await prisma.registrationAttempt.findFirst({
      where: { email: input.email },
      orderBy: { createdAt: "desc" },
    });
    if (!attempt) throw new ValidationError("Registration is not active.");
    await prisma.registrationAttempt.update({
      where: { id: attempt.id },
      data: { status: "COMPLETED", selectedOnboardingPath: attempt.selectedOnboardingPath ?? "CREATE_COMPANY" },
    });
    return successResponse({ message: "Registration completed.", status: "COMPLETED" }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}
