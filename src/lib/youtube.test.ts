import { describe, expect, it } from "vitest";
import { assertYouTubeUrl, extractYouTubeVideoId, parseTimestamp } from "./youtube";

describe("assertYouTubeUrl", () => {
  it("accepts supported HTTPS YouTube hosts", () => {
    expect(assertYouTubeUrl("https://www.youtube.com/watch?v=abc123").hostname).toBe("www.youtube.com");
    expect(assertYouTubeUrl("https://youtu.be/abc123").hostname).toBe("youtu.be");
  });

  it("rejects non-YouTube and non-HTTPS URLs", () => {
    expect(() => assertYouTubeUrl("https://example.com/watch?v=abc123")).toThrow(/Only YouTube/);
    expect(() => assertYouTubeUrl("http://youtube.com/watch?v=abc123")).toThrow(/HTTPS/);
  });

  it("removes playlist parameters", () => {
    const url = assertYouTubeUrl("https://www.youtube.com/watch?v=abc123&list=PL123");
    expect(url.searchParams.has("list")).toBe(false);
  });
});

describe("extractYouTubeVideoId", () => {
  it("extracts video IDs from common YouTube URL formats", () => {
    expect(extractYouTubeVideoId(new URL("https://www.youtube.com/watch?v=abc123"))).toBe("abc123");
    expect(extractYouTubeVideoId(new URL("https://youtu.be/abc123?t=1:23"))).toBe("abc123");
    expect(extractYouTubeVideoId(new URL("https://www.youtube.com/shorts/abc123"))).toBe("abc123");
    expect(extractYouTubeVideoId(new URL("https://www.youtube.com/embed/abc123"))).toBe("abc123");
  });
});

describe("parseTimestamp", () => {
  const url = new URL("https://www.youtube.com/watch?v=abc123");

  it("parses common timestamp formats", () => {
    expect(parseTimestamp("1:23.4", url)).toBe(83.4);
    expect(parseTimestamp("1:23", url)).toBe(83);
    expect(parseTimestamp("1:02:03.4", url)).toBe(3723.4);
  });

  it("uses t= from the URL when the field is empty", () => {
    const timedUrl = new URL("https://www.youtube.com/watch?v=abc123&t=1:23.5");
    expect(parseTimestamp("", timedUrl)).toBe(83.5);
  });

  it("rejects unreasonable timestamps", () => {
    expect(() => parseTimestamp("7:00:00", url)).toThrow(/between 0 and 6 hours/);
  });

  it("rejects raw seconds format", () => {
    expect(() => parseTimestamp("17.6", url)).toThrow(/1:23/);
  });

  it("rejects invalid minute or second segments", () => {
    expect(() => parseTimestamp("1:99", url)).toThrow(/1:23/);
    expect(() => parseTimestamp("1:99:05", url)).toThrow(/1:23/);
  });
});
