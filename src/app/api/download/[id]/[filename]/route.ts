import { readFile } from "node:fs/promises";
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
    const file = await readFile(resolveGeneratedFile(id, filename));
    const contentType = filename.endsWith(".mp4") ? "video/mp4" : "image/webp";

    return new NextResponse(file, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, max-age=3600"
      }
    });
  } catch {
    return NextResponse.json({ error: "Sticker not found." }, { status: 404 });
  }
}
