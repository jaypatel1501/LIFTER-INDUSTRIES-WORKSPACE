import { errorResponse, successResponse } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return successResponse({ status: "ready" });
  } catch (error) {
    return errorResponse(error);
  }
}
