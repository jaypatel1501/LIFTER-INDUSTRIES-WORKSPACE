import { prisma } from "@/lib/prisma";
import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const email = url.searchParams.get("email");
    if (!email) return successResponse({ status: "NOT_STARTED", onboardingStatus: "NOT_STARTED" }, 200);
    const attempt = await prisma.registrationAttempt.findFirst({
      where: { email },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        mobileNumber: true,
        status: true,
        emailVerifiedAt: true,
        mobileVerifiedAt: true,
        selectedOnboardingPath: true,
      },
    });
    return successResponse({
      status: attempt?.status ?? "NOT_STARTED",
      email: attempt?.email ?? email,
      mobileNumber: attempt?.mobileNumber ?? null,
      emailVerifiedAt: attempt?.emailVerifiedAt ?? null,
      mobileVerifiedAt: attempt?.mobileVerifiedAt ?? null,
      selectedOnboardingPath: attempt?.selectedOnboardingPath ?? null,
    }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request) as { email?: string };
    const email = body.email ?? "";
    const attempt = await prisma.registrationAttempt.findFirst({ where: { email }, orderBy: { createdAt: "desc" } });
    return successResponse({
      status: attempt?.status ?? "NOT_STARTED",
      emailVerifiedAt: attempt?.emailVerifiedAt ?? null,
      mobileVerifiedAt: attempt?.mobileVerifiedAt ?? null,
      selectedOnboardingPath: attempt?.selectedOnboardingPath ?? null,
    }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}
