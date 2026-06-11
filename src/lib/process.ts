import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

type RunResult = {
  stdout: string;
  stderr: string;
};

export class CommandError extends Error {
  constructor(
    message: string,
    readonly command: string,
    readonly stderr: string
  ) {
    super(message);
    this.name = "CommandError";
  }
}

const WINDOWS_BINARY_CANDIDATES: Record<string, string[]> = {
  "yt-dlp": [
    path.join(
      process.env.LOCALAPPDATA ?? "",
      "Microsoft",
      "WinGet",
      "Packages",
      "yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe",
      "yt-dlp.exe"
    )
  ],
  ffmpeg: [
    path.join(
      process.env.LOCALAPPDATA ?? "",
      "Microsoft",
      "WinGet",
      "Packages",
      "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
      "ffmpeg-8.1.1-full_build",
      "bin",
      "ffmpeg.exe"
    )
  ]
};

function resolveCommand(command: string) {
  const candidates = WINDOWS_BINARY_CANDIDATES[command] ?? [];
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? command;
}

export function runCommand(command: string, args: string[], timeoutMs = 120_000) {
  return new Promise<RunResult>((resolve, reject) => {
    const executable = resolveCommand(command);
    const startedAt = Date.now();
    const printableArgs = args.map((arg) => (arg.startsWith("http") ? "[url]" : arg)).join(" ");

    console.log(`[cmd:start] ${command} ${printableArgs}`);

    const child = spawn(executable, args, {
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let didSettle = false;

    const timeout = setTimeout(() => {
      didSettle = true;
      child.kill("SIGKILL");
      console.error(`[cmd:timeout] ${command} after ${Date.now() - startedAt}ms`);
      reject(new CommandError(`${command} timed out after ${Math.round(timeoutMs / 1000)}s.`, command, stderr));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (didSettle) {
        return;
      }

      didSettle = true;
      clearTimeout(timeout);
      const hint =
        "code" in error && error.code === "ENOENT"
          ? ` Could not find ${command}. Check that it is installed and available on PATH.`
          : "";

      reject(new CommandError(`${command} failed to start.${hint}`, command, error.message));
    });

    child.on("close", (code) => {
      if (didSettle) {
        return;
      }

      didSettle = true;
      clearTimeout(timeout);
      const elapsedMs = Date.now() - startedAt;

      if (code === 0) {
        console.log(`[cmd:done] ${command} in ${elapsedMs}ms`);
        resolve({ stdout, stderr });
        return;
      }

      console.error(`[cmd:fail] ${command} exited with code ${code} after ${elapsedMs}ms`);
      reject(new CommandError(`${command} exited with code ${code}.`, command, stderr));
    });
  });
}
