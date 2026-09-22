"use client";

import { useState } from "react";
import { extractFrames } from "@/lib/extractFrames";
import type { AnalyzeResult } from "@/lib/types";

const MAX_FRAMES = 12;

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fps, setFps] = useState(0.5);
  const [nTracksPerGenre, setNTracksPerGenre] = useState(2);
  const [stage, setStage] = useState<"idle" | "extracting" | "analyzing" | "done" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [showCaptions, setShowCaptions] = useState(false);

  function onFileChange(f: File | null) {
    setFile(f);
    setResult(null);
    setError(null);
    setStage("idle");
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(f ? URL.createObjectURL(f) : null);
  }

  async function run() {
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      setStage("extracting");
      const frames = await extractFrames(file, fps, MAX_FRAMES);

      setStage("analyzing");
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frames, nTracksPerGenre }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      setResult(data as AnalyzeResult);
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStage("error");
    }
  }

  const busy = stage === "extracting" || stage === "analyzing";

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
      <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
        <span>🎬 → 🎵</span> Video-to-Music Recommender
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        Upload a short video and get music recommendations based on its visual content and
        atmosphere.
      </p>
      <p className="mt-1 text-xs text-neutral-400">
        frames captioned with Gemini vision &middot; runs entirely on Vercel
      </p>

      <hr className="my-6 border-neutral-200 dark:border-neutral-800" />

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Video file</label>
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            className="block w-full cursor-pointer rounded-lg border border-neutral-300 text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-neutral-700 dark:border-neutral-700 dark:file:bg-white dark:file:text-neutral-900"
          />
        </div>

        <details className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
          <summary className="cursor-pointer select-none font-medium">Options</summary>
          <div className="mt-3 space-y-4">
            <div>
              <div className="mb-1 flex justify-between">
                <span>Frames sampled per second</span>
                <span className="text-neutral-500">{fps.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.1}
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                className="w-full"
              />
              <p className="mt-1 text-xs text-neutral-400">
                capped at {MAX_FRAMES} frames total to stay within a serverless function&apos;s
                time limit
              </p>
            </div>
            <div>
              <div className="mb-1 flex justify-between">
                <span>Tracks per genre</span>
                <span className="text-neutral-500">{nTracksPerGenre}</span>
              </div>
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={nTracksPerGenre}
                onChange={(e) => setNTracksPerGenre(Number(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
        </details>

        {videoUrl && <video src={videoUrl} controls className="w-full rounded-lg" />}

        <button
          onClick={run}
          disabled={!file || busy}
          className="w-full rounded-lg bg-violet-600 px-4 py-2.5 font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {stage === "extracting"
            ? "Sampling frames…"
            : stage === "analyzing"
              ? "Analyzing video and finding music…"
              : "Run recommendation"}
        </button>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            Failed: {error}
          </div>
        )}
      </div>

      {result && (
        <div className="mt-8 space-y-8">
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">🎬 Video summary</h2>
            <div className="rounded-lg border-l-4 border-violet-500 bg-neutral-50 px-4 py-3 leading-relaxed dark:bg-neutral-900">
              {result.summary}
            </div>
            <button
              onClick={() => setShowCaptions((v) => !v)}
              className="mt-2 text-xs text-neutral-500 underline underline-offset-2"
            >
              {showCaptions ? "hide" : "show"} frame-level captions ({result.captions.length})
            </button>
            {showCaptions && (
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-neutral-500">
                {result.captions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
              🎵 Recommended genres
            </h2>
            {result.genres.length === 0 ? (
              <span className="text-neutral-400">—</span>
            ) : (
              <div className="flex flex-wrap gap-2">
                {result.genres.map((g) => (
                  <span
                    key={g}
                    className="rounded-full border border-violet-300 px-3 py-1 text-sm font-semibold text-violet-600 dark:border-violet-800 dark:text-violet-400"
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">🎧 Tracks</h2>
            {result.tracks.length === 0 ? (
              <div className="rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-500 dark:bg-neutral-900">
                No tracks found for these genres.
              </div>
            ) : (
              <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {result.tracks.map((t, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-4 py-2.5">
                    <div>
                      <span className="font-semibold">{t.track}</span>{" "}
                      <span className="text-neutral-500">— {t.artist}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                      <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-xs dark:border-neutral-700">
                        {t.genre}
                      </span>
                      {t.url && (
                        <a
                          href={t.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-semibold text-violet-600 dark:text-violet-400"
                        >
                          open ↗
                        </a>
                      )}
                      <span className="text-xs text-neutral-400">{t.source}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
