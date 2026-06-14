import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveClipDuration, resolveGeneratedFile, safeShape, videoFilter } from "./stickers";

describe("resolveGeneratedFile", () => {
  it("builds paths under tmp for valid generated files", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    const resolved = resolveGeneratedFile(id, "static-sticker-123e4567.webp");

    expect(resolved).toBe(path.join(process.cwd(), "tmp", id, "static-sticker-123e4567.webp"));
  });

  it("rejects traversal and unexpected extensions", () => {
    expect(() => resolveGeneratedFile("../bad", "static-sticker.webp")).toThrow(/Invalid/);
    expect(() => resolveGeneratedFile("123e4567-e89b-12d3-a456-426614174000", "../bad.webp")).toThrow(/Invalid/);
    expect(() => resolveGeneratedFile("123e4567-e89b-12d3-a456-426614174000", "static-sticker.exe")).toThrow(/Invalid/);
  });
});

describe("generation options", () => {
  it("allows clip ranges up to five seconds", () => {
    expect(resolveClipDuration(83, 87)).toBe(4);
    expect(resolveClipDuration(83, 87.5)).toBe(4.5);
    expect(resolveClipDuration(83, 88)).toBe(5);
  });

  it("rejects clip ranges over five seconds", () => {
    expect(() => resolveClipDuration(83, 88.1)).toThrow(/longer than 5 seconds/);
  });

  it("rejects inverted or empty ranges", () => {
    expect(() => resolveClipDuration(83, 83)).toThrow(/after the start/);
    expect(() => resolveClipDuration(83, 82)).toThrow(/after the start/);
  });

  it("defaults to square shape unless original is requested", () => {
    expect(safeShape(undefined)).toBe("square");
    expect(safeShape("square")).toBe("square");
    expect(safeShape("original")).toBe("original");
  });

  it("uses crop only for square output", () => {
    expect(videoFilter("square")).toContain("crop=512:512");
    expect(videoFilter("original")).not.toContain("crop=512:512");
    expect(videoFilter("original")).toContain("force_original_aspect_ratio=decrease");
  });
});
