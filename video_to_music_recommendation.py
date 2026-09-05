# video_to_music_recommendation.py
"""
Core pipeline for the Video-to-Music Recommender.

Steps (see the project report / System Pipeline slide):
  1. extract_frames            - sample frames from a video
  2. caption_image             - fine-tuned BLIP caption per frame
  3. aggregate_captions_llm    - LLM soft-reasoning -> one video-level summary
  4. recommend_music_genre_gemini - LLM infers 2-3 music genres
  5. search_spotify_tracks     - Spotify Web API -> real tracks

Models / API clients are created lazily and cached, so importing this module
is cheap and Streamlit re-runs stay fast.
"""

import os
import glob
from functools import lru_cache

import torch
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

# ===============================
# Config
# ===============================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DEVICE = (
    "cuda" if torch.cuda.is_available()
    else "mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available()
    else "cpu"
)

BLIP_FINETUNED_DIR = os.path.join(BASE_DIR, "blip_best")     # produced by the fine-tuning notebook
BLIP_BASE_MODEL = "Salesforce/blip-image-captioning-base"    # fallback if blip_best/ is missing
FRAMES_DIR = os.path.join(BASE_DIR, "frames")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "models/gemini-2.5-flash")
SPOTIFY_CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID")
SPOTIFY_CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET")
LASTFM_API_KEY = os.getenv("LASTFM_API_KEY")


# ===============================
# Lazy model / client loaders
# ===============================
@lru_cache(maxsize=1)
def _load_blip():
    from transformers import BlipProcessor, BlipForConditionalGeneration

    if os.path.isdir(BLIP_FINETUNED_DIR):
        model_path = BLIP_FINETUNED_DIR
    else:
        model_path = BLIP_BASE_MODEL
        print(
            f"[warn] fine-tuned model not found at {BLIP_FINETUNED_DIR!r}; "
            f"falling back to base model {BLIP_BASE_MODEL!r}. "
            f"Run 'BLIP caption fine-tuning.ipynb' to create it."
        )

    processor = BlipProcessor.from_pretrained(model_path)
    model = BlipForConditionalGeneration.from_pretrained(model_path).to(DEVICE)
    model.eval()
    return processor, model


@lru_cache(maxsize=1)
def _load_llm():
    import google.generativeai as genai

    if not GEMINI_API_KEY:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Copy .env.example to .env and fill it in."
        )
    genai.configure(api_key=GEMINI_API_KEY)
    return genai.GenerativeModel(GEMINI_MODEL)


@lru_cache(maxsize=1)
def _load_spotify():
    import spotipy
    from spotipy.oauth2 import SpotifyClientCredentials

    if not (SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET):
        raise RuntimeError(
            "SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not set. "
            "Copy .env.example to .env and fill them in."
        )
    return spotipy.Spotify(
        auth_manager=SpotifyClientCredentials(
            client_id=SPOTIFY_CLIENT_ID,
            client_secret=SPOTIFY_CLIENT_SECRET,
        )
    )


# ===============================
# Core functions
# ===============================
def _is_ascii(s: str) -> bool:
    try:
        s.encode("ascii")
        return True
    except UnicodeEncodeError:
        return False


def extract_frames(video_path, fps=1):
    """Sample ~`fps` frames per second from the video into FRAMES_DIR.

    OpenCV on Windows cannot open/write paths that contain non-ASCII characters
    (this project lives under '...\\OneDrive\\桌面\\...'), so we copy the video to
    an ASCII temp path when needed and write each frame via numpy .tofile().
    """
    import cv2
    import shutil
    import tempfile

    os.makedirs(FRAMES_DIR, exist_ok=True)
    for old in glob.glob(os.path.join(FRAMES_DIR, "frame_*.jpg")):
        os.remove(old)

    tmp_copy = None
    open_path = video_path
    if not _is_ascii(os.path.abspath(video_path)):
        fd, tmp_copy = tempfile.mkstemp(suffix=os.path.splitext(video_path)[1] or ".mp4")
        os.close(fd)
        shutil.copyfile(video_path, tmp_copy)
        open_path = tmp_copy

    try:
        cap = cv2.VideoCapture(open_path)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open video: {video_path}")

        video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        interval = max(int(round(video_fps / fps)), 1)

        frames, idx, saved = [], 0, 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if idx % interval == 0:
                p = os.path.join(FRAMES_DIR, f"frame_{saved:04d}.jpg")
                ok, buf = cv2.imencode(".jpg", frame)
                if not ok:
                    raise RuntimeError("Failed to encode frame")
                buf.tofile(p)  # handles non-ASCII paths, unlike cv2.imwrite
                frames.append(p)
                saved += 1
            idx += 1
        cap.release()
    finally:
        if tmp_copy and os.path.exists(tmp_copy):
            os.remove(tmp_copy)

    if not frames:
        raise RuntimeError(f"No frames extracted from {video_path}")
    return frames


def caption_image(image_path):
    """Generate a caption for one frame with the (fine-tuned) BLIP model."""
    processor, blip_model = _load_blip()
    img = Image.open(image_path).convert("RGB")
    inputs = processor(images=img, return_tensors="pt").to(DEVICE)
    with torch.no_grad():
        out = blip_model.generate(**inputs, max_new_tokens=30, num_beams=3)
    return processor.decode(out[0], skip_special_tokens=True).strip()


def _gemini_text(response) -> str:
    try:
        return (response.text or "").strip()
    except Exception:
        try:
            return response.candidates[0].content.parts[0].text.strip()
        except Exception:
            return ""


def call_llm(prompt: str) -> str:
    llm_model = _load_llm()
    return _gemini_text(llm_model.generate_content(prompt))


def aggregate_captions_llm(captions):
    prompt = f"""
You are given multiple descriptions of frames sampled from a video.

Frame descriptions:
{chr(10).join('- ' + c for c in captions)}

Summarize the video in ONE concise sentence.
Focus on dominant actions, emotions, and atmosphere.
"""
    return call_llm(prompt).strip()


def recommend_music_genre_gemini(video_summary):
    prompt = f"""
Video description:
"{video_summary}"

Suggest 2-3 suitable music genres.
Output ONLY comma-separated genre names.
"""
    return call_llm(prompt).strip()


def parse_genres(genres_text):
    """Turn the LLM's comma/newline separated answer into a clean list."""
    raw = genres_text.replace("\n", ",")
    return [g.strip(" .-") for g in raw.split(",") if g.strip(" .-")]


def search_spotify_tracks(genres, n_tracks_per_genre=2):
    sp = _load_spotify()
    results = []
    for g in genres:
        g = g.strip()
        if not g:
            continue
        items = []
        try:
            r = sp.search(q=f'genre:"{g}"', type="track", limit=n_tracks_per_genre)
            items = r["tracks"]["items"]
            if not items:  # genre filter is picky; fall back to a plain keyword search
                r = sp.search(q=g, type="track", limit=n_tracks_per_genre)
                items = r["tracks"]["items"]
        except Exception as e:
            print(f"[warn] Spotify search failed for {g!r}: {e}")
        for t in items:
            results.append({
                "genre": g,
                "track": t["name"],
                "artist": t["artists"][0]["name"],
                "url": t["external_urls"]["spotify"],
                "source": "Spotify",
            })
    return results


def _itunes_link(artist, track):
    """Look up an exact 'artist - track' on the iTunes Store and return its page URL."""
    import requests

    try:
        r = requests.get(
            "https://itunes.apple.com/search",
            params={"term": f"{artist} {track}", "entity": "song", "limit": 1},
            timeout=10,
        )
        r.raise_for_status()
        res = r.json().get("results") or []
        if res:
            return res[0].get("trackViewUrl", "")
    except Exception:
        pass
    return ""


def search_lastfm_tracks(genres, n_tracks_per_genre=2):
    """Last.fm 'tag.getTopTracks': real popular tracks for a genre/tag, ranked by
    listeners. Free API key required (https://www.last.fm/api/account/create)."""
    import requests

    if not LASTFM_API_KEY:
        return []

    results = []
    for g in genres:
        g = g.strip()
        if not g:
            continue
        try:
            r = requests.get(
                "https://ws.audioscrobbler.com/2.0/",
                params={
                    "method": "tag.gettoptracks",
                    "tag": g,
                    "api_key": LASTFM_API_KEY,
                    "format": "json",
                    "limit": n_tracks_per_genre,
                },
                timeout=10,
            )
            r.raise_for_status()
            tracks = r.json().get("tracks", {}).get("track", [])
        except Exception as e:
            print(f"[warn] Last.fm search failed for {g!r}: {e}")
            continue
        if isinstance(tracks, dict):
            tracks = [tracks]
        for t in tracks:
            artist = (t.get("artist") or {}).get("name", "?")
            name = t.get("name", "?")
            results.append({
                "genre": g,
                "track": name,
                "artist": artist,
                "url": _itunes_link(artist, name) or t.get("url", ""),
                "source": "Last.fm",
            })
    return results


# LLM genre string  ->  Apple Music top-level genre id (for the "top songs" chart)
_APPLE_GENRE_IDS = {
    "blues": 2, "classical": 5, "country": 6, "electronic": 7, "electronica": 7,
    "edm": 7, "house": 7, "techno": 7, "trance": 7, "dubstep": 7, "dance": 17,
    "jazz": 11, "latin": 12, "reggaeton": 12, "new age": 13, "ambient": 13,
    "chill": 13, "chill-out": 13, "chillout": 13, "lo-fi": 13, "lofi": 13,
    "pop": 14, "synth-pop": 14, "dream pop": 20, "r&b": 15, "rnb": 15,
    "soul": 15, "funk": 15, "soundtrack": 16, "cinematic": 16, "hip hop": 18,
    "hip-hop": 18, "rap": 18, "trap": 18, "world": 19, "alternative": 20,
    "indie": 20, "indie pop": 20, "indie rock": 20, "rock": 21, "metal": 21,
    "punk": 21, "christian": 22, "gospel": 22, "vocal": 23, "reggae": 24,
    "acoustic": 10, "singer-songwriter": 10, "folk": 10, "easy listening": 25,
    "j-pop": 27, "k-pop": 51,
}


def _apple_genre_id(genre):
    g = genre.strip().lower()
    if g in _APPLE_GENRE_IDS:
        return _APPLE_GENRE_IDS[g]
    for key, gid in _APPLE_GENRE_IDS.items():
        if key in g or g in key:
            return gid
    return None


def search_apple_chart_tracks(genres, n_tracks_per_genre=2):
    """Keyless fallback: Apple's 'Top Songs' RSS feed for the closest genre."""
    import requests

    results = []
    for g in genres:
        gid = _apple_genre_id(g)
        if gid is None:
            print(f"[warn] no Apple genre match for {g!r}")
            continue
        try:
            r = requests.get(
                f"https://itunes.apple.com/us/rss/topsongs/limit={max(n_tracks_per_genre, 1)}"
                f"/genre={gid}/json",
                timeout=10,
            )
            r.raise_for_status()
            entries = r.json().get("feed", {}).get("entry", [])
        except Exception as e:
            print(f"[warn] Apple chart failed for {g!r}: {e}")
            continue
        if isinstance(entries, dict):
            entries = [entries]
        for e in entries:
            results.append({
                "genre": g,
                "track": (e.get("im:name") or {}).get("label", "?"),
                "artist": (e.get("im:artist") or {}).get("label", "?"),
                "url": (e.get("id") or {}).get("label", ""),
                "source": "Apple Charts",
            })
    return results


def search_itunes_tracks(genres, n_tracks_per_genre=2):
    """Last-resort fallback: plain iTunes keyword search (matches the genre word
    in a title/artist, so results are only loosely on-genre)."""
    import requests

    results = []
    for g in genres:
        g = g.strip()
        if not g:
            continue
        try:
            r = requests.get(
                "https://itunes.apple.com/search",
                params={"term": g, "entity": "song", "limit": n_tracks_per_genre},
                timeout=10,
            )
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            print(f"[warn] iTunes search failed for {g!r}: {e}")
            continue
        for t in data.get("results", []):
            results.append({
                "genre": g,
                "track": t.get("trackName", "?"),
                "artist": t.get("artistName", "?"),
                "url": t.get("trackViewUrl", ""),
                "source": "iTunes",
            })
    return results


def search_tracks(genres, n_tracks_per_genre=2):
    """Return popular tracks for the given genres.

    Order of preference:
      1. Spotify           - if app credentials work (owner needs Premium since 2026)
      2. Last.fm top tracks - real per-genre popularity, needs a free API key
      3. Apple 'Top Songs' - keyless genre charts, coarse genre mapping
      4. iTunes keyword search - last resort, only loosely on-genre
    """
    for name, fn, enabled in (
        ("Spotify", search_spotify_tracks, bool(SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET)),
        ("Last.fm", search_lastfm_tracks, bool(LASTFM_API_KEY)),
        ("Apple charts", search_apple_chart_tracks, True),
        ("iTunes search", search_itunes_tracks, True),
    ):
        if not enabled:
            continue
        try:
            tracks = fn(genres, n_tracks_per_genre=n_tracks_per_genre)
        except Exception as e:
            print(f"[warn] {name} unavailable: {e}")
            continue
        if tracks:
            return tracks
    return []


# ===============================
# End-to-end helper
# ===============================
def recommend_from_video(video_path, fps=1, n_tracks_per_genre=2):
    frames = extract_frames(video_path, fps=fps)
    captions = [caption_image(f) for f in frames]
    summary = aggregate_captions_llm(captions)
    genres = parse_genres(recommend_music_genre_gemini(summary))
    tracks = search_tracks(genres, n_tracks_per_genre=n_tracks_per_genre)
    return {
        "frames": frames,
        "captions": captions,
        "summary": summary,
        "genres": genres,
        "tracks": tracks,
    }


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Recommend music for a video.")
    ap.add_argument("video", help="path to a video file")
    ap.add_argument("--fps", type=float, default=1.0, help="frames sampled per second")
    args = ap.parse_args()

    print(f"device: {DEVICE}")
    out = recommend_from_video(args.video, fps=args.fps)

    print("\n=== Frame captions ===")
    for c in out["captions"]:
        print(" -", c)
    print("\n=== Video summary ===\n", out["summary"])
    print("\n=== Recommended genres ===\n", ", ".join(out["genres"]))
    print("\n=== Recommended tracks ===")
    for r in out["tracks"]:
        print(f" - {r['track']} - {r['artist']}  ({r['genre']}, {r.get('source', '?')})  {r['url']}")
