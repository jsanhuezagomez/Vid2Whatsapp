"use client";

import { FormEvent, useMemo, useState } from "react";

type StickerMode = "static" | "animated";

type GenerateResponse = {
  id: string;
  filename: string;
  downloadUrl: string;
  sizeBytes: number;
  mode: StickerMode;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [timestamp, setTimestamp] = useState("");
  const [mode, setMode] = useState<StickerMode>("static");
  const [duration, setDuration] = useState(3);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GenerateResponse | null>(null);

  const helperText = useMemo(() => {
    if (mode === "static") {
      return "Captures one frame from the timestamp and exports a 512x512 WebP.";
    }

    return "Cuts a short silent clip and exports it as an MP4.";
  }, [mode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    setIsGenerating(true);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          url,
          timestamp,
          mode,
          duration
        })
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not generate sticker.");
      }

      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <main className="shell">
      <section className="workspace" aria-labelledby="title">
        <div className="intro">
          <p className="eyebrow">Local MVP</p>
          <h1 id="title">Vid2WhatsApp</h1>
          <p>
            Paste a YouTube link, pick the moment, and generate a WhatsApp-style
            WebP sticker on your machine.
          </p>
        </div>

        <form className="generator" onSubmit={handleSubmit}>
          <label className="field">
            <span>YouTube link</span>
            <input
              required
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </label>

          <label className="field">
            <span>Timestamp</span>
            <input
              value={timestamp}
              onChange={(event) => setTimestamp(event.target.value)}
              placeholder="1:23.4, 83.4, 3s400ms, or leave blank if URL has t="
            />
          </label>

          <div className="modeRow" role="radiogroup" aria-label="Sticker type">
            <button
              type="button"
              className={mode === "static" ? "active" : ""}
              onClick={() => setMode("static")}
              aria-pressed={mode === "static"}
            >
              Static
            </button>
            <button
              type="button"
              className={mode === "animated" ? "active" : ""}
              onClick={() => setMode("animated")}
              aria-pressed={mode === "animated"}
            >
              Animated
            </button>
          </div>

          <p className="hint">{helperText}</p>

          {mode === "animated" ? (
            <label className="field">
              <span>Duration: {duration}s</span>
              <input
                type="range"
                min="1"
                max="6"
                step="1"
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
              />
            </label>
          ) : null}

          <button className="primary" disabled={isGenerating} type="submit">
            {isGenerating ? "Generating..." : "Generate sticker"}
          </button>

          {error ? <p className="error">{error}</p> : null}
        </form>

        <aside className="preview" aria-live="polite">
          {result ? (
            <>
              <div className="stickerFrame">
                {result.mode === "animated" ? (
                  <video src={result.downloadUrl} autoPlay loop muted playsInline />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={result.downloadUrl} alt="Generated sticker preview" />
                )}
              </div>
              <div className="resultMeta">
                <strong>{result.filename}</strong>
                <span>{formatBytes(result.sizeBytes)}</span>
              </div>
              <a className="download" href={result.downloadUrl} download={result.filename}>
                Download {result.mode === "animated" ? "MP4" : "WebP"}
              </a>
            </>
          ) : (
            <div className="emptyState">
              <span>512</span>
              <p>Your generated sticker preview will appear here.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
