import { ValidationError } from "@/lib/errors";

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new ValidationError("Request body must be valid JSON");
    throw error;
  }
}

export function requestIp(request: Request) {
  return request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
}

export function requestUserAgent(request: Request) {
  return request.headers.get("user-agent")?.slice(0, 500);
}
