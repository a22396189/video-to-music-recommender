import { NextRequest, NextResponse } from "next/server";
import { aggregateCaptions, captionFrames, recommendGenres } from "@/lib/llm";
import { searchTracks } from "@/lib/tracks";
import type { AnalyzeResult } from "@/lib/types";

// Give the whole pipeline (captioning + 2 LLM calls + track search) room to
// run within one Vercel serverless invocation.
export const maxDuration = 60;

const MAX_FRAMES = 12;

export async function POST(req: NextRequest) {
  let body: { frames?: unknown; nTracksPerGenre?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const frames = body.frames;
  if (!Array.isArray(frames) || frames.length === 0 || !frames.every((f) => typeof f === "string")) {
    return NextResponse.json({ error: "`frames` must be a non-empty array of data URLs" }, { status: 400 });
  }
  if (frames.length > MAX_FRAMES) {
    return NextResponse.json({ error: `Too many frames (max ${MAX_FRAMES})` }, { status: 400 });
  }

  const nTracksPerGenre = Math.min(Math.max(Number(body.nTracksPerGenre) || 2, 1), 5);

  try {
    const captions = await captionFrames(frames);
    const summary = await aggregateCaptions(captions);
    const genres = await recommendGenres(summary);
    const tracks = await searchTracks(genres, nTracksPerGenre);

    const result: AnalyzeResult = { captions, summary, genres, tracks };
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
