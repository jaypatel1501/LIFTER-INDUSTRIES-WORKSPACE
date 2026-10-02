import { getDictionary, localeLabel } from "@/lib/i18n";

describe("locale dictionaries", () => {
  it("provides Hindi copy for the dashboard shell", () => {
    expect(getDictionary("HI").overview).toBe("अवलोकन");
  });

  it("provides combined English and Hindi copy for bilingual users", () => {
    expect(getDictionary("BILINGUAL").company).toContain("कंपनी");
    expect(localeLabel("BILINGUAL")).toBe("English · हिंदी");
  });
});
