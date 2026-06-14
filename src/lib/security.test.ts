import { afterEach, describe, expect, it, vi } from "vitest";
import { assertRateLimit, assertTrustedProxy, ClientIpError, getClientIp, ProxyTrustError, RateLimitError } from "./security";

afterEach(() => {
  delete process.env.INTERNAL_PROXY_SECRET;
  vi.unstubAllEnvs();
});

describe("assertRateLimit", () => {
  it("allows requests below the configured limit", () => {
    const key = crypto.randomUUID();

    expect(() => assertRateLimit(key, { windowMs: 60_000, maxRequests: 2 })).not.toThrow();
    expect(() => assertRateLimit(key, { windowMs: 60_000, maxRequests: 2 })).not.toThrow();
  });

  it("blocks requests above the configured limit", () => {
    const key = crypto.randomUUID();

    assertRateLimit(key, { windowMs: 60_000, maxRequests: 1 });
    expect(() => assertRateLimit(key, { windowMs: 60_000, maxRequests: 1 })).toThrow(RateLimitError);
  });

  it("keeps independent counters per key", () => {
    const shortWindowKey = `short:${crypto.randomUUID()}`;
    const dailyKey = `daily:${crypto.randomUUID()}`;

    assertRateLimit(shortWindowKey, { windowMs: 60_000, maxRequests: 1 });
    assertRateLimit(dailyKey, { windowMs: 24 * 60 * 60 * 1000, maxRequests: 20 });

    expect(() => assertRateLimit(shortWindowKey, { windowMs: 60_000, maxRequests: 1 })).toThrow(RateLimitError);
    expect(() => assertRateLimit(dailyKey, { windowMs: 24 * 60 * 60 * 1000, maxRequests: 20 })).not.toThrow();
  });
});

describe("assertTrustedProxy", () => {
  it("allows local development when no proxy secret is configured", () => {
    const request = new Request("https://sticker.example.test/api/generate");

    expect(() => assertTrustedProxy(request)).not.toThrow();
  });

  it("requires the configured internal proxy secret", () => {
    process.env.INTERNAL_PROXY_SECRET = "test-secret";
    const request = new Request("https://sticker.example.test/api/generate", {
      headers: {
        "X-Internal-Proxy-Secret": "test-secret"
      }
    });

    expect(() => assertTrustedProxy(request)).not.toThrow();
  });

  it("rejects missing or wrong proxy secrets", () => {
    process.env.INTERNAL_PROXY_SECRET = "test-secret";

    expect(() => assertTrustedProxy(new Request("https://sticker.example.test/api/generate"))).toThrow(ProxyTrustError);
    expect(() =>
      assertTrustedProxy(
        new Request("https://sticker.example.test/api/generate", {
          headers: {
            "X-Internal-Proxy-Secret": "wrong-secret"
          }
        })
      )
    ).toThrow(ProxyTrustError);
  });
});

describe("getClientIp", () => {
  it("uses only the trusted reverse-proxy header", () => {
    const request = new Request("https://sticker.example.test/api/generate", {
      headers: {
        "X-Sticker-Client-IP": "203.0.113.10",
        "X-Forwarded-For": "198.51.100.99",
        "X-Real-IP": "198.51.100.88",
        "CF-Connecting-IP": "198.51.100.77"
      }
    });

    expect(getClientIp(request)).toBe("203.0.113.10");
  });

  it("does not trust spoofable forwarding headers", () => {
    const request = new Request("https://sticker.example.test/api/generate", {
      headers: {
        "X-Forwarded-For": "198.51.100.99",
        "X-Real-IP": "198.51.100.88",
        "CF-Connecting-IP": "198.51.100.77"
      }
    });

    expect(getClientIp(request)).toBe("local-dev");
  });

  it("ignores invalid trusted header values", () => {
    const request = new Request("https://sticker.example.test/api/generate", {
      headers: {
        "X-Sticker-Client-IP": "198.51.100.1, 203.0.113.1"
      }
    });

    expect(getClientIp(request)).toBe("local-dev");
  });

  it("rejects missing trusted client IP in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new Request("https://sticker.example.test/api/generate");

    expect(() => getClientIp(request)).toThrow(ClientIpError);
  });

  it("rejects invalid trusted client IP in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new Request("https://sticker.example.test/api/generate", {
      headers: {
        "X-Sticker-Client-IP": "198.51.100.1, 203.0.113.1"
      }
    });

    expect(() => getClientIp(request)).toThrow(ClientIpError);
  });
});
