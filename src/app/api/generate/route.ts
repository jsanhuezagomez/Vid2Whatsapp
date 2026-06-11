import { NextResponse } from "next/server";
import { CommandError } from "@/lib/process";
import { generateSticker } from "@/lib/stickers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await generateSticker({
      url: String(body.url ?? ""),
      timestamp: typeof body.timestamp === "string" ? body.timestamp : "",
      mode: body.mode === "animated" ? "animated" : "static",
      duration: Number(body.duration)
    });

    return NextResponse.json({
      id: result.id,
      filename: result.filename,
      downloadUrl: `/api/download/${result.id}/${result.filename}`,
      sizeBytes: result.sizeBytes,
      mode: result.mode
    });
  } catch (error) {
    const message =
      error instanceof CommandError
        ? `${error.message} ${error.stderr.split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? ""}`.trim()
        : error instanceof Error
          ? error.message
          : "Could not generate sticker.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
