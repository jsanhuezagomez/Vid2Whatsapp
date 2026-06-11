import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { CommandError } from "./process";
import { runCommand } from "./process";
import { assertYouTubeUrl, downloadSection, getDirectVideoUrl, parseTimestamp } from "./youtube";

export type StickerMode = "static" | "animated";

export type GenerateStickerInput = {
  url: string;
  timestamp?: string;
  mode: StickerMode;
  duration?: number;
};

export type GenerateStickerResult = {
  id: string;
  filename: string;
  absolutePath: string;
  sizeBytes: number;
  mode: StickerMode;
};

const TMP_DIR = path.join(process.cwd(), "tmp");

function safeDuration(value: number | undefined) {
  if (!value || Number.isNaN(value)) {
    return 3;
  }

  return Math.min(6, Math.max(1, Math.round(value)));
}

function seekTime(seconds: number) {
  return Math.max(0, seconds).toFixed(3);
}

async function fileSize(filePath: string) {
  const stats = await stat(filePath);
  return stats.size;
}

async function encodeStatic(
  inputUrl: string,
  startSeconds: number,
  outputPath: string,
  timeoutMs = 60_000,
  seekMode: "input" | "output" = "input"
) {
  const seekArgs = ["-ss", seekTime(startSeconds)];
  const inputArgs = ["-i", inputUrl];

  await runCommand(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostdin",
      "-y",
      ...(seekMode === "input" ? seekArgs : []),
      ...inputArgs,
      ...(seekMode === "output" ? seekArgs : []),
      "-frames:v",
      "1",
      "-vf",
      "scale=512:512:force_original_aspect_ratio=increase,crop=512:512,format=rgba",
      "-c:v",
      "libwebp",
      "-lossless",
      "0",
      "-compression_level",
      "6",
      "-q:v",
      "72",
      outputPath
    ],
    timeoutMs
  );
}

async function encodeAnimated(
  inputUrl: string,
  startSeconds: number,
  duration: number,
  outputPath: string,
  timeoutMs = 80_000,
  seekMode: "input" | "output" = "input"
) {
  const attempts = [
    { fps: 15, crf: 28 },
    { fps: 12, crf: 31 },
    { fps: 10, crf: 34 },
    { fps: 8, crf: 37 }
  ];

  for (const attempt of attempts) {
    const seekArgs = ["-ss", seekTime(startSeconds)];
    const inputArgs = ["-i", inputUrl];

    await runCommand(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostdin",
        "-y",
        ...(seekMode === "input" ? seekArgs : []),
        ...(seekMode === "input" ? ["-t", String(duration)] : []),
        ...inputArgs,
        ...(seekMode === "output" ? seekArgs : []),
        ...(seekMode === "output" ? ["-t", String(duration)] : []),
        "-an",
        "-vf",
        `fps=${attempt.fps},scale=512:512:force_original_aspect_ratio=increase,crop=512:512,format=yuv420p`,
        "-c:v",
        "libx264",
        "-profile:v",
        "baseline",
        "-level",
        "3.0",
        "-preset",
        "veryfast",
        "-crf",
        String(attempt.crf),
        "-movflags",
        "+faststart",
        outputPath
      ],
      timeoutMs
    );

    const bytes = await fileSize(outputPath);
    if (bytes <= 500 * 1024) {
      return;
    }
  }
}

async function findDownloadedMedia(jobDir: string) {
  const files = await readdir(jobDir);
  const mediaFiles = files.filter((file) => /\.(mp4|mkv|webm)$/i.test(file));

  for (const mediaFile of mediaFiles) {
    const mediaPath = path.join(jobDir, mediaFile);
    const stats = await stat(mediaPath);

    if (stats.size > 0) {
      return mediaPath;
    }
  }

  if (mediaFiles.length > 0) {
    throw new Error("yt-dlp produced an empty local media file.");
  }

  throw new Error("yt-dlp did not produce a local media file.");
}

async function encodeWithFallback(input: {
  url: string;
  streamUrl: string;
  jobDir: string;
  startSeconds: number;
  duration: number;
  mode: StickerMode;
  outputPath: string;
}) {
  try {
    if (input.mode === "static") {
      await encodeStatic(input.streamUrl, input.startSeconds, input.outputPath, 15_000);
      return;
    }

    await encodeAnimated(input.streamUrl, input.startSeconds, input.duration, input.outputPath, 20_000);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.warn(`[fallback] Fast remote ffmpeg failed: ${reason}`);

    try {
      if (input.mode === "static") {
        console.warn("[fallback] Trying remote decode before downloading a local section.");
        await encodeStatic(input.streamUrl, input.startSeconds, input.outputPath, 30_000, "output");
        return;
      }

      console.warn("[fallback] Trying remote decode before downloading a local section.");
      await encodeAnimated(input.streamUrl, input.startSeconds, input.duration, input.outputPath, 35_000, "output");
      return;
    } catch (remoteDecodeError) {
      const remoteDecodeReason = remoteDecodeError instanceof Error ? remoteDecodeError.message : "unknown error";
      console.warn(`[fallback] Remote decode also failed: ${remoteDecodeReason}`);
    }

    console.warn("[fallback] Downloading local section instead.");

    const sectionTemplate = path.join(input.jobDir, "source.%(ext)s");
    const fallbackDuration = input.mode === "static" ? 2 : input.duration;

    try {
      await downloadSection({
        url: input.url,
        startSeconds: input.startSeconds,
        durationSeconds: fallbackDuration,
        outputTemplate: sectionTemplate,
        includeAudio: false,
        maxHeight: 480,
        timeoutMs: 45_000
      });
    } catch (downloadError) {
      const mediaPath = await findDownloadedMedia(input.jobDir).catch(() => null);

      if (!mediaPath) {
        throw downloadError;
      }

      const downloadReason = downloadError instanceof Error ? downloadError.message : "unknown error";
      console.warn(`[fallback] yt-dlp ended with an error, but a local media file exists: ${downloadReason}`);
    }

    const mediaPath = await findDownloadedMedia(input.jobDir);

    if (input.mode === "static") {
      await encodeStatic(mediaPath, 0, input.outputPath);
      return;
    }

    await encodeAnimated(mediaPath, 0, input.duration, input.outputPath);

    if (error instanceof CommandError) {
      console.warn(`[fallback] Original stderr tail: ${error.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(" ")}`);
    }
  }
}

export async function generateSticker(input: GenerateStickerInput): Promise<GenerateStickerResult> {
  const parsedUrl = assertYouTubeUrl(input.url);
  const startSeconds = parseTimestamp(input.timestamp, parsedUrl);
  const mode = input.mode === "animated" ? "animated" : "static";
  const duration = safeDuration(input.duration);
  const id = crypto.randomUUID();
  const jobDir = path.join(TMP_DIR, id);
  const extension = mode === "animated" ? "mp4" : "webp";
  const filename = `${mode}-sticker-${id.slice(0, 8)}.${extension}`;
  const absolutePath = path.join(jobDir, filename);

  await mkdir(jobDir, { recursive: true });

  const streamUrl = await getDirectVideoUrl(input.url, 480);

  await encodeWithFallback({
    url: input.url,
    streamUrl,
    jobDir,
    startSeconds,
    duration,
    mode,
    outputPath: absolutePath
  });

  return {
    id,
    filename,
    absolutePath,
    sizeBytes: await fileSize(absolutePath),
    mode
  };
}

export function resolveGeneratedFile(id: string, filename: string) {
  if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-z0-9-]+\.(webp|mp4)$/.test(filename)) {
    throw new Error("Invalid generated file path.");
  }

  return path.join(TMP_DIR, id, filename);
}
