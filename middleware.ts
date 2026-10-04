import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { requireEnv } from "@/lib/env";

export async function middleware(request: NextRequest) {
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  const secureCookie = forwardedProto === "https" || request.nextUrl.protocol === "https:";

  const token = await getToken({
    req: request,
    secret: requireEnv("AUTH_SECRET"),
    secureCookie,
  });
  if (typeof token?.userId !== "string" || !token.userId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (typeof token.activeCompanyId !== "string" || !token.activeCompanyId) {
    return NextResponse.redirect(new URL("/onboarding/company", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
