import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";

describe("safeNextPath (open-redirect protection)", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/dashboard/security")).toBe("/dashboard/security");
    expect(safeNextPath("/t/abc?x=1")).toBe("/t/abc?x=1");
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "dashboard",
    "/ok\nLocation: https://evil.example",
    "",
  ])("rejects %j", (value) => {
    expect(safeNextPath(value)).toBe("/dashboard");
  });

  it("uses the fallback for missing values", () => {
    expect(safeNextPath(undefined, "/x")).toBe("/x");
  });
});
