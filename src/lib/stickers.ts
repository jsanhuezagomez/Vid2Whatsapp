import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { CommandError } from "./process";
import { runCommand } from "./process";
import { assertYouTubeUrl, downloadSection, getDirectVideoUrl, parseTimestamp } from "./youtube";

export type StickerMode = "animated";
export type StickerShape = "square" | "original";

export type GenerateStickerInput = {
  url: string;
  timestamp?: string;
  endTimestamp?: string;
  mode: StickerMode;
  shape?: StickerShape;
};

export type GenerateStickerResult = {
  id: string;
  filename: string;
  absolutePath: string;
  sizeBytes: number;
  mode: StickerMode;
  shape: StickerShape;
};

const TMP_DIR = path.join(process.cwd(), "tmp");
const GENERATED_FILE_MAX_BYTES = 500 * 1024;
const TMP_TTL_MS = Number(process.env.STICKER_TMP_TTL_MS ?? 60 * 60 * 1000);

export function resolveClipDuration(startSeconds: number, endSeconds: number) {
  const duration = Math.round((endSeconds - startSeconds) * 1000) / 1000;

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("End timestamp must be after the start timestamp.");
  }

  if (duration > 5) {
    throw new Error("Clip range cannot be longer than 5 seconds.");
  }

  return duration;
}

export function safeShape(value: StickerShape | undefined): StickerShape {
  if (value === "original") {
    return value;
  }

  return "square";
}

export function videoFilter(shape: StickerShape, fps?: number) {
  const fpsFilter = fps ? `fps=${fps},` : "";

  if (shape === "original") {
    return `${fpsFilter}scale=512:512:force_original_aspect_ratio=decrease,format=${fps ? "yuv420p" : "rgba"}`;
  }

  return `${fpsFilter}scale=512:512:force_original_aspect_ratio=increase,crop=512:512,format=${fps ? "yuv420p" : "rgba"}`;
}

function seekTime(seconds: number) {
  return Math.max(0, seconds).toFixed(3);
}

async function fileSize(filePath: string) {
  const stats = await stat(filePath);
  return stats.size;
}

async function assertGeneratedFileSize(filePath: string) {
  const bytes = await fileSize(filePath);

  if (bytes > GENERATED_FILE_MAX_BYTES) {
    throw new Error("The generated sticker is too large. Try a shorter or simpler clip.");
  }

  return bytes;
}

async function cleanupOldJobs() {
  await mkdir(TMP_DIR, { recursive: true });

  const now = Date.now();
  const entries = await readdir(TMP_DIR, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name))
      .map(async (entry) => {
        const dir = path.join(TMP_DIR, entry.name);
        const stats = await stat(dir).catch(() => null);

        if (stats && now - stats.mtimeMs > TMP_TTL_MS) {
          await rm(dir, { force: true, recursive: true });
        }
      })
  );
}

async function encodeAnimated(
  inputUrl: string,
  startSeconds: number,
  duration: number,
  outputPath: string,
  shape: StickerShape,
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
        "-threads",
        "1",
        ...(seekMode === "input" ? seekArgs : []),
        ...(seekMode === "input" ? ["-t", String(duration)] : []),
        ...inputArgs,
        ...(seekMode === "output" ? seekArgs : []),
        ...(seekMode === "output" ? ["-t", String(duration)] : []),
        "-an",
        "-vf",
        videoFilter(shape, attempt.fps),
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
    if (bytes <= GENERATED_FILE_MAX_BYTES) {
      return;
    }
  }

  throw new Error("The generated sticker is too large. Try a shorter or simpler clip.");
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
  shape: StickerShape;
  outputPath: string;
}) {
  try {
    await encodeAnimated(input.streamUrl, input.startSeconds, input.duration, input.outputPath, input.shape, 20_000);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.warn(`[fallback] Fast remote ffmpeg failed: ${reason}`);

    try {
      console.warn("[fallback] Trying remote decode before downloading a local section.");
      await encodeAnimated(input.streamUrl, input.startSeconds, input.duration, input.outputPath, input.shape, 35_000, "output");
      return;
    } catch (remoteDecodeError) {
      const remoteDecodeReason = remoteDecodeError instanceof Error ? remoteDecodeError.message : "unknown error";
      console.warn(`[fallback] Remote decode also failed: ${remoteDecodeReason}`);
    }

    console.warn("[fallback] Downloading local section instead.");

    const sectionTemplate = path.join(input.jobDir, "source.%(ext)s");

    try {
      await downloadSection({
        url: input.url,
        startSeconds: input.startSeconds,
        durationSeconds: input.duration,
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

    await encodeAnimated(mediaPath, 0, input.duration, input.outputPath, input.shape);

    if (error instanceof CommandError) {
      console.warn(`[fallback] Original stderr tail: ${error.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(" ")}`);
    }
  }
}

export async function generateSticker(input: GenerateStickerInput): Promise<GenerateStickerResult> {
  const parsedUrl = assertYouTubeUrl(input.url);
  const startSeconds = parseTimestamp(input.timestamp, parsedUrl);
  const mode: StickerMode = "animated";
  const shape = safeShape(input.shape);
  const endSeconds = parseTimestamp(input.endTimestamp, parsedUrl);
  const duration = resolveClipDuration(startSeconds, endSeconds);
  const id = crypto.randomUUID();
  const jobDir = path.join(TMP_DIR, id);
  const extension = "mp4";
  const filename = `${mode}-sticker-${id.slice(0, 8)}.${extension}`;
  const absolutePath = path.join(jobDir, filename);

  await cleanupOldJobs();
  await mkdir(jobDir, { recursive: true });

  const streamUrl = await getDirectVideoUrl(parsedUrl.toString(), 480);

  await encodeWithFallback({
    url: parsedUrl.toString(),
    streamUrl,
    jobDir,
    startSeconds,
    duration,
    mode,
    shape,
    outputPath: absolutePath
  });

  return {
    id,
    filename,
    absolutePath,
    sizeBytes: await assertGeneratedFileSize(absolutePath),
    mode,
    shape
  };
}

export function resolveGeneratedFile(id: string, filename: string) {
  if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-z0-9-]+\.mp4$/.test(filename)) {
    throw new Error("Invalid generated file path.");
  }

  return path.join(TMP_DIR, id, filename);
}
