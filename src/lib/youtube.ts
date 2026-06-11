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

  try {
    parsed = new URL(input);
  } catch {
    throw new Error("Paste a valid YouTube URL.");
  }

  if (!YOUTUBE_HOSTS.has(parsed.hostname)) {
    throw new Error("Only YouTube links are supported in this local MVP.");
  }

  return parsed;
}

export function parseTimestamp(input: string | undefined, url: URL) {
  const raw = input?.trim() || url.searchParams.get("t") || url.searchParams.get("start") || "";

  if (!raw) {
    return 0;
  }

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    return Number(raw);
  }

  const text = raw.toLowerCase();
  const unitMatch = text.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s?)?(?:(\d+)ms)?$/);

  if (unitMatch && unitMatch[0]) {
    const hours = Number(unitMatch[1] ?? 0);
    const minutes = Number(unitMatch[2] ?? 0);
    const seconds = Number(unitMatch[3] ?? 0);
    const milliseconds = Number(unitMatch[4] ?? 0);
    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  }

  const parts = text.split(":").map(Number);
  if (parts.length > 3 || parts.some((part) => Number.isNaN(part) || part < 0)) {
    throw new Error("Use a timestamp like 83, 83.4, 1:23.7, 1h2m3.4s, or 3s400ms.");
  }

  return parts.reduce((total, part) => total * 60 + part, 0);
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
