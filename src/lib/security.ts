import { isIP } from "node:net";

type RateLimitOptions = {
  windowMs: number;
  maxRequests: number;
};

type RateLimitBucket = {
  resetAt: number;
  count: number;
};

type TurnstileResponse = {
  success: boolean;
  "error-codes"?: string[];
};

const buckets = new Map<string, RateLimitBucket>();
const TRUSTED_CLIENT_IP_HEADER = "x-sticker-client-ip";
const INTERNAL_PROXY_SECRET_HEADER = "x-internal-proxy-secret";

type SecurityLogContext = {
  method: string;
  url: string;
  host: string | null;
  origin: string | null;
  userAgent: string | null;
  trustedClientIp: string | null;
  trustedClientIpValid: boolean;
  forwardedFor: string | null;
  realIp: string | null;
  cfConnectingIp: string | null;
  forwardedProto: string | null;
  internalProxySecretPresent: boolean;
  internalProxySecretMatches?: boolean;
};

export class RateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many requests. Please wait and try again.");
    this.name = "RateLimitError";
  }
}

export class VerificationError extends Error {
  constructor(message = "Verification failed. Please try again.") {
    super(message);
    this.name = "VerificationError";
  }
}

export class ProxyTrustError extends Error {
  constructor(
    message = "Request did not come through the trusted proxy.",
    readonly context?: SecurityLogContext
  ) {
    super(message);
    this.name = "ProxyTrustError";
  }
}

export class ClientIpError extends Error {
  constructor(
    message = "Verified client IP is missing or invalid.",
    readonly context?: SecurityLogContext
  ) {
    super(message);
    this.name = "ClientIpError";
  }
}

function getSecurityLogContext(request: Request, internalProxySecretMatches?: boolean): SecurityLogContext {
  const trustedClientIp = request.headers.get(TRUSTED_CLIENT_IP_HEADER)?.trim() || null;

  return {
    method: request.method,
    url: request.url,
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    userAgent: request.headers.get("user-agent"),
    trustedClientIp,
    trustedClientIpValid: Boolean(trustedClientIp && isIP(trustedClientIp)),
    forwardedFor: request.headers.get("x-forwarded-for"),
    realIp: request.headers.get("x-real-ip"),
    cfConnectingIp: request.headers.get("cf-connecting-ip"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    internalProxySecretPresent: request.headers.has(INTERNAL_PROXY_SECRET_HEADER),
    internalProxySecretMatches
  };
}

export function getClientIp(request: Request) {
  const trustedIp = request.headers.get(TRUSTED_CLIENT_IP_HEADER)?.trim();

  if (trustedIp && isIP(trustedIp)) {
    return trustedIp;
  }

  if (process.env.NODE_ENV !== "production") {
    return "local-dev";
  }

  throw new ClientIpError(
    `${TRUSTED_CLIENT_IP_HEADER} is missing or invalid. Check the reverse proxy header configuration.`,
    getSecurityLogContext(request)
  );
}

export function assertTrustedProxy(request: Request) {
  const expectedSecret = process.env.INTERNAL_PROXY_SECRET;

  if (!expectedSecret) {
    if (process.env.NODE_ENV === "production") {
      throw new ProxyTrustError(
        "Trusted proxy secret is not configured.",
        getSecurityLogContext(request)
      );
    }

    return;
  }

  const providedSecret = request.headers.get(INTERNAL_PROXY_SECRET_HEADER);
  const secretMatches = providedSecret === expectedSecret;

  if (!providedSecret || !secretMatches) {
    throw new ProxyTrustError(
      providedSecret
        ? "Request provided an invalid trusted proxy secret."
        : "Request did not include the trusted proxy secret.",
      getSecurityLogContext(request, secretMatches)
    );
  }
}

export function assertRateLimit(key: string, options: RateLimitOptions) {
  const now = Date.now();

  for (const [bucketKey, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(bucketKey);
    }
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + options.windowMs
    });
    return;
  }

  existing.count += 1;

  if (existing.count > options.maxRequests) {
    throw new RateLimitError(Math.ceil((existing.resetAt - now) / 1000));
  }
}

export async function assertTurnstileToken(token: string, remoteIp: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new VerificationError("Verification is not configured.");
    }

    return;
  }

  if (!token || token.length > 2048) {
    throw new VerificationError();
  }

  const formData = new FormData();
  formData.append("secret", secret);
  formData.append("response", token);
  if (remoteIp !== "unknown") {
    formData.append("remoteip", remoteIp);
  }

  let result: TurnstileResponse;

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData
    });

    result = await response.json();
  } catch (error) {
    console.error("[turnstile:error]", error);
    throw new VerificationError();
  }

  if (!result.success) {
    console.warn("[turnstile:fail]", result["error-codes"] ?? []);
    throw new VerificationError();
  }
}
