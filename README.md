# Video-to-Music Recommender

End-to-end system that recommends background music for a video based on its
visual content and atmosphere.

```
frames  ->  BLIP caption per frame  ->  LLM aggregates to 1 summary
        ->  LLM infers 2-3 genres   ->  Spotify Web API returns real tracks
        ->  Streamlit web demo
```

## Files

| File | Role |
|------|------|
| `BLIP caption fine-tuning.ipynb` | Fine-tunes BLIP on a custom caption dataset -> `./blip_best/` |
| `video_to_music_recommendation.py` | Core pipeline functions + a CLI |
| `app.py` | Streamlit web demo |

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

Web demo:

```bash
streamlit run app.py
```

## Notes

- First run downloads the BLIP model (~1 GB) from Hugging Face.
- Runs on GPU (CUDA), Apple MPS, or CPU automatically. CPU works but is slower.
- `ffmpeg` is not required; OpenCV handles frame extraction.
