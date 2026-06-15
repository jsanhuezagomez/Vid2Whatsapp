"use client";

import Script from "next/script";
import { FormEvent, useEffect, useMemo, useState } from "react";

type StickerMode = "animated";
type StickerShape = "square" | "original";
type Language = "es" | "en";

type GenerateResponse = {
  id: string;
  filename: string;
  downloadUrl: string;
  sizeBytes: number;
  mode: StickerMode;
  shape: StickerShape;
};

declare global {
  interface Window {
    onTurnstileSuccess?: (token: string) => void;
    onTurnstileExpired?: () => void;
    turnstile?: {
      reset: () => void;
    };
  }
}

const copy = {
  es: {
    intro: "Pega un enlace de YouTube, elige un rango corto y genera un sticker estilo WhatsApp desde tu maquina.",
    youtubeLink: "Enlace de YouTube",
    timestamp: "Timestamp inicial",
    timestampPlaceholder: "1:23 o 1:23.5",
    endTimestamp: "Timestamp final",
    endTimestampPlaceholder: "1:27 o 1:27.5",
    outputShape: "Formato de salida",
    square: "Cuadrado",
    original: "Original",
    squareShape: "recortado a 512x512",
    originalShape: "manteniendo la proporcion original",
    animatedHelp: "Corta un clip corto sin audio y lo exporta como MP4",
    localMode: "Modo local: la verificacion esta desactivada.",
    generating: "Generando...",
    generatingDetail: "Procesando el video. Esto puede tomar unos segundos.",
    generate: "Generar sticker",
    genericError: "Algo salio mal.",
    apiError: "No se pudo generar el sticker.",
    download: "Descargar",
    emptyPreview: "La vista previa del sticker generado aparecera aqui.",
    languageLabel: "Idioma"
  },
  en: {
    intro: "Paste a YouTube link, pick a short range, and generate a WhatsApp-style sticker on your machine.",
    youtubeLink: "YouTube link",
    timestamp: "Start timestamp",
    timestampPlaceholder: "1:23 or 1:23.5",
    endTimestamp: "End timestamp",
    endTimestampPlaceholder: "1:27 or 1:27.5",
    outputShape: "Output shape",
    square: "Square",
    original: "Original",
    squareShape: "cropped to 512x512",
    originalShape: "kept in its original aspect ratio",
    animatedHelp: "Cuts a short silent clip and exports it as an MP4",
    localMode: "Local mode: verification is disabled.",
    generating: "Generating...",
    generatingDetail: "Processing the video. This can take a few seconds.",
    generate: "Generate sticker",
    genericError: "Something went wrong.",
    apiError: "Could not generate sticker.",
    download: "Download",
    emptyPreview: "Your generated sticker preview will appear here.",
    languageLabel: "Language"
  }
} as const;

function detectLanguage(): Language {
  const languages = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  return languages.some((language) => language.toLowerCase().startsWith("es")) ? "es" : "en";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [timestamp, setTimestamp] = useState("");
  const [endTimestamp, setEndTimestamp] = useState("");
  const [shape, setShape] = useState<StickerShape>("square");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("");
  const [language, setLanguage] = useState<Language>("es");
  const t = copy[language];

  useEffect(() => {
    setLanguage(detectLanguage());
    window.onTurnstileSuccess = setTurnstileToken;
    window.onTurnstileExpired = () => setTurnstileToken("");

    return () => {
      delete window.onTurnstileSuccess;
      delete window.onTurnstileExpired;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadConfig() {
      try {
        const response = await fetch("/api/config");
        const payload = await response.json();

        if (isMounted && typeof payload.turnstileSiteKey === "string") {
          setTurnstileSiteKey(payload.turnstileSiteKey);
        }
      } catch {
        if (isMounted) {
          setTurnstileSiteKey("");
        }
      }
    }

    loadConfig();

    return () => {
      isMounted = false;
    };
  }, []);

  const helperText = useMemo(() => {
    const shapeText = shape === "square" ? t.squareShape : t.originalShape;

    return `${t.animatedHelp}, ${shapeText}.`;
  }, [shape, t]);

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
          endTimestamp,
          mode: "animated",
          shape,
          turnstileToken
        })
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? t.apiError);
      }

      setResult(payload);
      window.turnstile?.reset();
      setTurnstileToken("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.genericError);
      window.turnstile?.reset();
      setTurnstileToken("");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <main className="shell">
      {turnstileSiteKey ? <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer /> : null}
      <section className="workspace" aria-labelledby="title">
        <div className="intro">
          <div className="topline">
            <label className="languagePicker">
              <span>{t.languageLabel}</span>
              <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
                <option value="es">ES</option>
                <option value="en">EN</option>
              </select>
            </label>
          </div>
          <h1 id="title">Vid2WhatsApp</h1>
          <p>{t.intro}</p>
        </div>

        <form className="generator" onSubmit={handleSubmit}>
          <label className="field">
            <span>{t.youtubeLink}</span>
            <input
              required
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </label>

          <label className="field">
            <span>{t.timestamp}</span>
            <input
              required
              value={timestamp}
              onChange={(event) => setTimestamp(event.target.value)}
              placeholder={t.timestampPlaceholder}
            />
          </label>

          <label className="field">
            <span>{t.endTimestamp}</span>
            <input
              required
              value={endTimestamp}
              onChange={(event) => setEndTimestamp(event.target.value)}
              placeholder={t.endTimestampPlaceholder}
            />
          </label>

          <p className="hint">{helperText}</p>

          <div className="modeRow" role="radiogroup" aria-label={t.outputShape}>
            <button
              type="button"
              className={shape === "square" ? "active" : ""}
              onClick={() => setShape("square")}
              aria-pressed={shape === "square"}
            >
              {t.square}
            </button>
            <button
              type="button"
              className={shape === "original" ? "active" : ""}
              onClick={() => setShape("original")}
              aria-pressed={shape === "original"}
            >
              {t.original}
            </button>
          </div>

          {turnstileSiteKey ? (
            <div
              className="cf-turnstile turnstileBox"
              data-sitekey={turnstileSiteKey}
              data-callback="onTurnstileSuccess"
              data-expired-callback="onTurnstileExpired"
              data-theme="auto"
            />
          ) : (
            <p className="hint">{t.localMode}</p>
          )}

          <button className="primary" disabled={isGenerating || Boolean(turnstileSiteKey && !turnstileToken)} type="submit">
            {isGenerating ? t.generating : t.generate}
          </button>

          {isGenerating ? (
            <div className="loadingStatus" role="status" aria-live="polite">
              <span className="loadingBar" />
              <p>{t.generatingDetail}</p>
            </div>
          ) : null}

          {error ? <p className="error">{error}</p> : null}
        </form>

        <aside className="preview" aria-live="polite">
          {isGenerating ? (
            <div className="emptyState loadingPreview">
              <span className="spinner" aria-hidden="true" />
              <p>{t.generatingDetail}</p>
            </div>
          ) : result ? (
            <>
              <div className="stickerFrame">
                <video src={result.downloadUrl} autoPlay loop muted playsInline />
              </div>
              <div className="resultMeta">
                <strong>{result.filename}</strong>
                <span>{formatBytes(result.sizeBytes)}</span>
              </div>
              <a className="download" href={result.downloadUrl} download={result.filename}>
                {t.download} MP4
              </a>
            </>
          ) : (
            <div className="emptyState">
              <span>512</span>
              <p>{t.emptyPreview}</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
