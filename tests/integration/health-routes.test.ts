import { GET } from "@/app/api/health/route";

describe("health route integration", () => {
  it("returns a successful liveness response without requiring a database", async () => {
    const response = GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { status: "ok" },
      error: null,
    });
  });
});
