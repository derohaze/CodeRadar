import { describe, expect, it, vi } from "vitest";
import { basename, inferWorkspace, rememberRecentSource } from "@/features/dashboard/model/home-screen.utils";

describe("home-screen.utils", () => {
  it("extracts the basename from Windows-like paths", () => {
    expect(basename("D:\\workspace\\secure-scan\\src\\main.tsx")).toBe("main.tsx");
  });

  it("infers the workspace from a folder target", () => {
    expect(inferWorkspace("D:\\workspace\\secure-scan", "folder")).toBe("secure-scan");
  });

  it("infers the parent folder for file targets", () => {
    expect(inferWorkspace("D:\\workspace\\secure-scan\\src\\main.tsx", "file")).toBe("src");
  });

  it("returns short workspace placeholder when no source is selected", () => {
    expect(inferWorkspace("", "folder")).toBe("Select source");
  });

  it("deduplicates remembered recent sources", () => {
    const now = new Date("2026-04-08T10:00:00Z").getTime();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);

    const result = rememberRecentSource(
      [
        { path: "D:\\workspace\\secure-scan\\src\\main.tsx", type: "file", workspace: "src", pickedAt: 1 },
        { path: "D:\\workspace\\secure-scan", type: "folder", workspace: "secure-scan", pickedAt: 2 },
      ],
      "D:\\workspace\\secure-scan\\src\\main.tsx",
      "file",
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      path: "D:\\workspace\\secure-scan\\src\\main.tsx",
      type: "file",
      workspace: "src",
      pickedAt: now,
    });

    nowSpy.mockRestore();
  });
});
