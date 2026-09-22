# Video-to-Music Recommender — Vercel edition

A rewrite of the project as a Next.js app so the whole pipeline can run on
Vercel serverless functions - no torch/transformers/ffmpeg on the server.

```
<video> + <canvas>  ->  frames sampled in the browser
                    ->  POST /api/analyze
                          -> Gemini vision: 1 caption per frame
                          -> Gemini text: captions -> 1 summary
                          -> Gemini text: summary -> 2-3 genres
                          -> Spotify / Last.fm / Apple charts / iTunes -> tracks
```

Frame extraction that used OpenCV in the original CLI/Streamlit app is now
done client-side (`src/lib/extractFrames.ts`), and BLIP captioning is
replaced with Gemini's multimodal vision input (`src/lib/llm.ts`) - Hugging
Face's serverless Inference API no longer supports the image-to-text task,
so this keeps everything on one already-required API key.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in the keys below
npm run dev
```

| Var | Needed? | Where |
|-----|---------|-------|
| `GEMINI_API_KEY` | **yes** | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `LASTFM_API_KEY` | recommended | [Last.fm API](https://www.last.fm/api/account/create) (free, instant) |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | optional | [Spotify Dashboard](https://developer.spotify.com/dashboard) — owner needs Premium |

Track search order (same as the original pipeline): Spotify -> Last.fm ->
Apple "Top Songs" charts -> iTunes keyword search, first one to return
results wins.

## Deploy to Vercel

This app lives in the `webapp/` subfolder of the repo, so when importing the
project on [vercel.com/new](https://vercel.com/new):

1. Import `a22396189/video-to-music-recommender`.
2. Under **Root Directory**, click *Edit* and select `webapp`.
3. Framework preset should auto-detect as **Next.js** - leave build/output
   settings as default.
4. Under **Environment Variables**, add `GEMINI_API_KEY` (required) and
   optionally `LASTFM_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`,
   `GEMINI_MODEL`.
5. Deploy.

Or with the Vercel CLI from this folder:

```bash
npm i -g vercel
vercel link
vercel env add GEMINI_API_KEY
vercel env add LASTFM_API_KEY
vercel --prod
```

## Notes / limits

- `/api/analyze` is capped at 12 frames per request and `maxDuration = 60`
  (seconds) - keep the "Frames sampled per second" option low for longer
  videos so the whole request finishes within a serverless function's time
  budget.
- Frames are downscaled to 480px wide and JPEG-compressed client-side before
  upload, to stay well under Vercel's request body size limit.
- The BLIP fine-tuning notebook and the original Streamlit/CLI app
  (`../app.py`, `../video_to_music_recommendation.py`) are unrelated to this
  folder and still work standalone with a local Python environment.
