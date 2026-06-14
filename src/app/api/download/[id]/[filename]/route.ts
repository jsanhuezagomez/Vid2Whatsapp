import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { resolveGeneratedFile } from "@/lib/stickers";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
    filename: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id, filename } = await context.params;
    const filePath = resolveGeneratedFile(id, filename);
    const fileStats = await stat(filePath);
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    const contentType = filename.endsWith(".mp4") ? "video/mp4" : "image/webp";

    return new NextResponse(stream, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(fileStats.size),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return NextResponse.json({ error: "Sticker not found." }, { status: 404 });
  }
}
