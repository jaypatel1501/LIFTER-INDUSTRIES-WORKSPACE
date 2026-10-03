import { createHash } from "node:crypto";
import { ValidationError } from "@/lib/errors";

export function hashIdempotencyKey(key: string) {
  if (key.length < 16 || key.length > 200) {
    throw new ValidationError("Idempotency-Key must contain 16 to 200 characters");
  }
  return createHash("sha256").update(key).digest("hex");
}
