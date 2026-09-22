# Video-to-Music Recommender

End-to-end system that recommends background music for a video based on its
visual content and atmosphere.

**Use it now, no install needed: [video-to-music-recommender.vercel.app](https://video-to-music-recommender.vercel.app)**

```
frames  ->  BLIP caption per frame  ->  LLM aggregates to 1 summary
        ->  LLM infers 2-3 genres   ->  Spotify / Last.fm / Apple charts / iTunes -> real tracks
        ->  Streamlit web app (or the hosted Vercel app linked above)
```

## Files

| File | Role |
|------|------|
| `BLIP caption fine-tuning.ipynb` | Fine-tunes BLIP on a custom caption dataset -> `./blip_best/` |
| `video_to_music_recommendation.py` | Core pipeline functions + a CLI |
| `app.py` | Streamlit web app |
| `webapp/` | Next.js port deployed on Vercel — see [Vercel deployment](#vercel-deployment) below |

## Setup (VSCode, Windows)

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Then create your keys file:

```bash
copy .env.example .env
```

and edit `.env`:

| Var | Needed? | Where |
|-----|---------|-------|
| `GEMINI_API_KEY` | **yes** | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `LASTFM_API_KEY` | recommended | [Last.fm API](https://www.last.fm/api/account/create) (free, instant) |
| `SPOTIFY_CLIENT_ID/SECRET` | optional | [Spotify Dashboard](https://developer.spotify.com/dashboard) — the owner now needs **Spotify Premium** for the Web API |

### How track recommendations are sourced

`search_tracks()` tries, in order, until one returns results:

1. **Spotify** search (only if credentials work)
2. **Last.fm** `tag.getTopTracks` — real per-genre popularity (needs `LASTFM_API_KEY`)
3. **Apple "Top Songs"** RSS chart for the closest genre — keyless
4. **iTunes keyword search** — last resort, only loosely on-genre

> The old hard-coded keys were removed. If you ever committed them, revoke them.

## 1. (Optional) Fine-tune BLIP

Put your dataset here:

```
data/
  train.json   # [{"image": "images/001.jpg", "caption": "..."}, ...]
  val.json
  images/
```

Open `BLIP caption fine-tuning.ipynb` in VSCode, select the `.venv` kernel, and
run all cells. Output goes to `./blip_best/`.

If you skip this step, the pipeline automatically falls back to the base
`Salesforce/blip-image-captioning-base` model.

## 2. Run the pipeline

CLI:

```bash
python video_to_music_recommendation.py path\to\video.mp4 --fps 1
```

Web app:

```bash
streamlit run app.py
```

## Vercel deployment

The hosted app above (`webapp/`) is a separate Next.js rewrite of this
pipeline, built so it runs entirely on **Vercel serverless functions** — no
Python, torch, or ffmpeg on the server:

```
<video> + <canvas>  ->  frames sampled in the browser (no ffmpeg/OpenCV needed)
                    ->  POST /api/analyze  (one Vercel serverless function)
                          -> Gemini vision: 1 caption per frame   (replaces local BLIP)
                          -> Gemini text:   captions -> 1 summary
                          -> Gemini text:   summary -> 2-3 genres
                          -> Spotify / Last.fm / Apple charts / iTunes -> tracks
```

Two things had to change from the Python pipeline to fit a serverless
platform:

- **Frame extraction** moved from server-side OpenCV to the browser: a
  hidden `<video>` element seeks to sampled timestamps and each frame is
  drawn to a `<canvas>` and read back as a downscaled JPEG, so the server
  never has to decode video or ship an ffmpeg binary.
- **Frame captioning** moved from a locally-run BLIP model to **Gemini's own
  multimodal vision input** — all sampled frames are sent in one batched
  Gemini request. This also sidesteps a dead end: Hugging Face's serverless
  Inference API no longer supports the image-to-text task, so BLIP itself
  isn't reachable that way anymore.

Everything else (the LLM summary/genre prompts, and the Spotify → Last.fm →
Apple charts → iTunes track-search fallback chain) is a direct 1:1 port of
`video_to_music_recommendation.py`.

Deploying your own copy: import this repo on
[vercel.com/new](https://vercel.com/new), set **Root Directory** to
`webapp` (the app lives in that subfolder, not the repo root), and add a
`GEMINI_API_KEY` environment variable. Full instructions, env var table, and
the serverless time/size limits this design works around are in
[`webapp/README.md`](webapp/README.md).

## Notes

- First run downloads the BLIP model (~1 GB) from Hugging Face.
- Runs on GPU (CUDA), Apple MPS, or CPU automatically. CPU works but is slower.
- `ffmpeg` is not required; OpenCV handles frame extraction.
