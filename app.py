import os
import html
import tempfile

import streamlit as st
from dotenv import load_dotenv

load_dotenv()

from video_to_music_recommendation import recommend_from_video, DEVICE, BLIP_FINETUNED_DIR

# ===============================
# Page config + styling
# ===============================
st.set_page_config(
    page_title="Video-to-Music Recommender",
    page_icon="🎬",
    layout="centered",
)

st.markdown(
    """
    <style>
      .block-container { max-width: 780px; padding-top: 2.6rem; padding-bottom: 4rem; }

      .app-title {
        display: flex; align-items: center; gap: .5rem;
        font-size: clamp(1.5rem, 3.4vw, 2.1rem);
        font-weight: 800; letter-spacing: -.02em;
        white-space: nowrap; margin-bottom: .15rem;
      }
      .app-sub { color: rgba(128,128,128,.95); font-size: .98rem; margin-bottom: .35rem; }
      .app-meta { color: rgba(128,128,128,.75); font-size: .82rem; }
      .app-meta code {
        background: var(--secondary-background-color, #f0f2f6);
        padding: .05rem .35rem; border-radius: 5px; font-size: .8rem;
      }

      .section-title {
        font-size: 1.15rem; font-weight: 700; margin: 1.6rem 0 .6rem;
        display: flex; align-items: center; gap: .45rem;
      }

      .summary {
        background: var(--secondary-background-color, #f5f5fa);
        border-left: 3px solid var(--primary-color, #6C5CE7);
        border-radius: 8px; padding: .85rem 1rem; line-height: 1.55;
      }

      .chips { display: flex; flex-wrap: wrap; gap: .4rem; }
      .chip {
        display: inline-block; padding: .18rem .6rem; border-radius: 999px;
        font-size: .82rem; font-weight: 600;
        background: var(--secondary-background-color, #f0f2f6);
        border: 1px solid rgba(128,128,128,.22);
      }
      .chip-genre { color: var(--primary-color, #6C5CE7); }

      .track {
        display: flex; justify-content: space-between; align-items: baseline;
        gap: 1rem; padding: .7rem .2rem;
        border-bottom: 1px solid rgba(128,128,128,.16);
      }
      .track:last-child { border-bottom: none; }
      .track-name { font-weight: 650; }
      .track-artist { color: rgba(128,128,128,.95); }
      .track-right { display: flex; align-items: center; gap: .55rem; white-space: nowrap; }
      .track-link { font-size: .85rem; text-decoration: none; font-weight: 600; }
      .track-src { font-size: .72rem; color: rgba(128,128,128,.7); }
    </style>
    """,
    unsafe_allow_html=True,
)

blip_label = "fine-tuned" if os.path.isdir(BLIP_FINETUNED_DIR) else "base model"

st.markdown(
    '<div class="app-title">🎬&nbsp;&rarr;&nbsp;🎵&nbsp; Video-to-Music Recommender</div>',
    unsafe_allow_html=True,
)
st.markdown(
    '<div class="app-sub">Upload a short video and get music recommendations based '
    'on its visual content and atmosphere.</div>',
    unsafe_allow_html=True,
)
st.markdown(
    f'<div class="app-meta">device <code>{DEVICE}</code> &nbsp;·&nbsp; '
    f'BLIP <code>{blip_label}</code></div>',
    unsafe_allow_html=True,
)

missing = [k for k in ("GEMINI_API_KEY",) if not os.getenv(k)]
if missing:
    st.warning(
        "Missing " + ", ".join(f"`{m}`" for m in missing)
        + ". Create a `.env` file (see `.env.example`) before running."
    )

st.divider()

# ===============================
# Inputs
# ===============================
uploaded_video = st.file_uploader(
    "Video file", type=["mp4", "mov", "avi", "mkv"]
)
with st.expander("Options"):
    fps = st.slider("Frames sampled per second", 0.2, 2.0, 1.0, 0.2)
    n_per_genre = st.slider("Tracks per genre", 1, 5, 2, 1)

if uploaded_video is not None:
    suffix = os.path.splitext(uploaded_video.name)[1] or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(uploaded_video.read())
        video_path = tmp.name

    st.video(video_path)
    run = st.button("Run recommendation", type="primary", use_container_width=True)

    if run:
        try:
            with st.spinner("Analyzing video and finding music…"):
                result = recommend_from_video(
                    video_path, fps=fps, n_tracks_per_genre=n_per_genre
                )
        except Exception as e:
            st.error(f"Failed: {e}")
        else:
            # ---- summary ----
            st.markdown('<div class="section-title">🎬 Video summary</div>', unsafe_allow_html=True)
            st.markdown(
                f'<div class="summary">{html.escape(result["summary"])}</div>',
                unsafe_allow_html=True,
            )
            with st.expander(f"Frame-level captions ({len(result['captions'])})"):
                for c in result["captions"]:
                    st.markdown(f"- {c}")

            # ---- genres ----
            st.markdown('<div class="section-title">🎵 Recommended genres</div>', unsafe_allow_html=True)
            if result["genres"]:
                chips = "".join(
                    f'<span class="chip chip-genre">{html.escape(g)}</span>'
                    for g in result["genres"]
                )
                st.markdown(f'<div class="chips">{chips}</div>', unsafe_allow_html=True)
            else:
                st.markdown("—")

            # ---- tracks ----
            st.markdown('<div class="section-title">🎧 Tracks</div>', unsafe_allow_html=True)
            if not result["tracks"]:
                st.info("No tracks found for these genres.")
            else:
                rows = []
                for r in result["tracks"]:
                    src = html.escape(r.get("source", ""))
                    url = html.escape(r.get("url", ""))
                    link = (
                        f'<a class="track-link" href="{url}" target="_blank">open ↗</a>'
                        if url else ""
                    )
                    rows.append(
                        '<div class="track">'
                        f'<div><span class="track-name">{html.escape(r["track"])}</span> '
                        f'<span class="track-artist">— {html.escape(r["artist"])}</span></div>'
                        f'<div class="track-right"><span class="chip">{html.escape(r["genre"])}</span>'
                        f'{link}<span class="track-src">{src}</span></div>'
                        '</div>'
                    )
                st.markdown("".join(rows), unsafe_allow_html=True)
