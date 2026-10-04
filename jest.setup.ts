import { prisma } from "@/lib/prisma";

process.env.AUTH_SECRET = "unit-test-secret-with-more-than-thirty-two-characters";

afterAll(async () => {
  await prisma.$disconnect();
});
