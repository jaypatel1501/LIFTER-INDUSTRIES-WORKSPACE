import type { Locale } from "@prisma/client";

export function managementCopy(locale: Locale, english: string, hindi: string) {
  return locale === "HI"
    ? hindi
    : locale === "BILINGUAL"
      ? `${english} · ${hindi}`
      : english;
}
