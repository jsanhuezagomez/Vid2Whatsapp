import { runCommand } from "./process";

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "music.youtube.com"
]);

export function assertYouTubeUrl(input: string) {
  let parsed: URL;

  if (input.length > 2048) {
    throw new Error("The YouTube URL is too long.");
  }

  try {
    parsed = new URL(input);
  } catch {
    throw new Error("Paste a valid YouTube URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Use an HTTPS YouTube link.");
  }

  if (!YOUTUBE_HOSTS.has(parsed.hostname)) {
    throw new Error("Only YouTube links are supported.");
  }

  if (parsed.searchParams.has("list")) {
    parsed.searchParams.delete("list");
  }

  return parsed;
}

export function parseTimestamp(input: string | undefined, url: URL) {
  const raw = input?.trim() || url.searchParams.get("t") || url.searchParams.get("start") || "";

  if (raw.length > 32) {
    throw new Error("Use a shorter timestamp.");
  }

  if (!raw) {
    return 0;
  }

  const text = raw.toLowerCase();
  if (!/^\d+:\d{1,2}(?::\d{1,2})?(?:\.\d+)?$/.test(text)) {
    throw new Error("Use a timestamp like 1:23 or 1:23.5.");
  }

  const parts = text.split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part) || part < 0)) {
    throw new Error("Use a timestamp like 1:23 or 1:23.5.");
  }

  const lastPart = parts.at(-1) ?? 0;
  const middlePart = parts.length === 3 ? parts[1] : 0;
  if (lastPart >= 60 || middlePart >= 60) {
    throw new Error("Use a timestamp like 1:23 or 1:23.5.");
  }

  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return assertReasonableTimestamp(seconds);
}

function assertReasonableTimestamp(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 6 * 60 * 60) {
    throw new Error("Use a timestamp between 0 and 6 hours.");
  }

  return seconds;
}

export async function getDirectVideoUrl(url: string, maxHeight = 720) {
  const { stdout } = await runCommand(
    "yt-dlp",
    [
      "-g",
      "-f",
      `bv*[height<=${maxHeight}][ext=mp4]/bv*[height<=${maxHeight}]/best[height<=${maxHeight}]/best`,
      "--no-playlist",
      url
    ],
    90_000
  );

  const directUrl = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!directUrl) {
    throw new Error("yt-dlp did not return a usable video stream.");
  }

  return directUrl;
}

export async function downloadSection(input: {
  url: string;
  startSeconds: number;
  durationSeconds: number;
  outputTemplate: string;
  includeAudio: boolean;
  maxHeight: number;
  timeoutMs: number;
}) {
  const { url, startSeconds, durationSeconds, outputTemplate, includeAudio, maxHeight, timeoutMs } = input;
  const sectionStart = Math.max(0, Math.floor(startSeconds));
  const sectionEnd = sectionStart + Math.ceil(durationSeconds) + 2;
  const format = includeAudio
    ? `bv*[height<=${maxHeight}][ext=mp4]+ba[ext=m4a]/b[height<=${maxHeight}][ext=mp4]/best[height<=${maxHeight}]/best`
    : `bv*[height<=${maxHeight}][ext=mp4]/bv*[height<=${maxHeight}]/best[height<=${maxHeight}]/best`;
  const args = [
    "--no-playlist",
    "--socket-timeout",
    "10",
    "--retries",
    "1",
    "--fragment-retries",
    "1",
    "-f",
    format,
    "--download-sections",
    `*${sectionStart}-${sectionEnd}`,
    "-o",
    outputTemplate
  ];

  if (includeAudio) {
    args.push("--merge-output-format", "mp4");
  }

  await runCommand(
    "yt-dlp",
    [...args, url],
    timeoutMs
  );
}
