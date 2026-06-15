import { NextResponse } from "next/server";
import { CommandError } from "@/lib/process";
import { generateSticker } from "@/lib/stickers";
import { QueueFullError, runStickerJob } from "@/lib/jobQueue";
import {
  assertRateLimit,
  assertTrustedProxy,
  assertTurnstileToken,
  ClientIpError,
  getClientIp,
  ProxyTrustError,
  RateLimitError,
  VerificationError
} from "@/lib/security";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof RateLimitError) {
    return NextResponse.json(
      { error: error.message },
      {
        status: 429,
        headers: {
          "Retry-After": String(error.retryAfterSeconds)
        }
      }
    );
  }

  if (error instanceof QueueFullError) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }

  if (error instanceof VerificationError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  if (error instanceof ProxyTrustError) {
    console.warn("[proxy:reject]", error.message);
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (error instanceof ClientIpError) {
    console.warn("[client-ip:reject]", error.message);
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (error instanceof CommandError) {
    console.error("[generate:command]", error.message, error.stderr.split(/\r?\n/).filter(Boolean).slice(-3));
    return NextResponse.json(
      { error: "Could not process this video. Try a shorter public YouTube clip." },
      { status: 400 }
    );
  }

  const message = error instanceof Error ? error.message : "Could not generate sticker.";
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 4096) {
      return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    }

    assertTrustedProxy(request);

    const clientIp = getClientIp(request);
    const body = await request.json();
    await assertTurnstileToken(String(body.turnstileToken ?? ""), clientIp);

    assertRateLimit(`generate:${clientIp}`, {
      windowMs: 10 * 60 * 1000,
      maxRequests: Number(process.env.STICKER_RATE_LIMIT_10M_MAX ?? 3)
    });

    assertRateLimit(`generate:daily:${clientIp}`, {
      windowMs: 24 * 60 * 60 * 1000,
      maxRequests: Number(process.env.STICKER_RATE_LIMIT_DAILY_MAX ?? 20)
    });

    const result = await runStickerJob(() =>
      generateSticker({
        url: String(body.url ?? ""),
        timestamp: typeof body.timestamp === "string" ? body.timestamp : "",
        endTimestamp: typeof body.endTimestamp === "string" ? body.endTimestamp : "",
        mode: body.mode === "animated" ? "animated" : "static",
        shape: body.shape === "original" ? "original" : "square"
      })
    );

    return NextResponse.json({
      id: result.id,
      filename: result.filename,
      downloadUrl: `/api/download/${result.id}/${result.filename}`,
      sizeBytes: result.sizeBytes,
      mode: result.mode,
      shape: result.shape
    });
  } catch (error) {
    return errorResponse(error);
  }
}
