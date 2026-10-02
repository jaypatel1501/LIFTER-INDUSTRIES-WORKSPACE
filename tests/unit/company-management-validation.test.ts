import {
  companyUpdateSchema,
  financialYearSchema,
  memberInviteSchema,
  memberUpdateSchema,
  roleSchema,
} from "@/lib/validation/companies";
import { COMPANY_PERMISSION_KEYS, OWNER_PERMISSIONS } from "@/lib/company-permissions";

describe("company management validation", () => {
  it("accepts valid Indian company identity and accounting settings", () => {
    const result = companyUpdateSchema.safeParse({
      name: "Example Traders",
      legalName: "Example Traders Private Limited",
      gstin: "27AAPFU0939F1ZV",
      pan: "AAPFU0939F",
      addressLine1: "12 Market Road",
      addressLine2: "",
      city: "Mumbai",
      state: "Maharashtra",
      stateCode: "27",
      postalCode: "400001",
      country: "India",
      email: "accounts@example.test",
      phone: "+912212345678",
      website: "https://example.test",
      currency: "INR",
      timezone: "Asia/Kolkata",
      financialYearStartMonth: 4,
      booksBeginningDate: "2026-04-01",
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed PAN, GST state codes, and invalid year months", () => {
    const result = companyUpdateSchema.safeParse({
      name: "Example Traders",
      gstin: "invalid",
      pan: "bad-pan",
      stateCode: "270",
      country: "India",
      currency: "INR",
      timezone: "Asia/Kolkata",
      financialYearStartMonth: 13,
    });
    expect(result.success).toBe(false);
  });

  it("requires valid, non-overflowing financial year dates", () => {
    expect(financialYearSchema.safeParse({
      name: "FY 2026-27",
      startDate: "2026-04-01",
      endDate: "2027-03-31",
      booksBeginningDate: "2026-04-01",
    }).success).toBe(true);
    expect(financialYearSchema.safeParse({
      name: "FY 2026-27",
      startDate: "2027-03-31",
      endDate: "2026-04-01",
      booksBeginningDate: "2026-04-01",
    }).success).toBe(false);
  });

  it("normalizes invitations and validates membership actions", () => {
    expect(memberInviteSchema.parse({
      email: "  USER@Example.test ",
      name: "A User",
      mobile: "+919876543210",
    }).email).toBe("user@example.test");
    expect(memberUpdateSchema.safeParse({ status: "SUSPENDED" }).success).toBe(true);
    expect(memberUpdateSchema.safeParse({}).success).toBe(false);
    expect(memberInviteSchema.safeParse({
      email: "user@example.test",
      name: "A User",
      roleIds: [`c${"a".repeat(32)}`],
    }).success).toBe(true);
  });

  it("limits the role editor to the defined company action catalog", () => {
    expect(roleSchema.safeParse({
      name: "Read Only",
      description: "Can review company details",
      permissions: ["company:read", "audit:read"],
    }).success).toBe(true);
    expect(COMPANY_PERMISSION_KEYS.has("sessions:revoke")).toBe(true);
    expect(OWNER_PERMISSIONS).toHaveLength(COMPANY_PERMISSION_KEYS.size);
  });
});
