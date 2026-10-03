import type { DefaultSession } from "next-auth";
import type { Locale } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    activeCompanyId: string | null;
    locale: Locale;
    switchProof?: string;
    user: DefaultSession["user"] & {
      id: string;
      locale: Locale;
    };
  }

  interface User {
    activeCompanyId: string | null;
    sessionVersion: number;
    locale: Locale;
    sessionTokenId: string;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    userId: string;
    activeCompanyId: string | null;
    sessionVersion: number;
    locale: Locale;
    sessionTokenId: string;
  }
}
