// Ports search_tracks() and its fallback chain from
// video_to_music_recommendation.py: Spotify -> Last.fm -> Apple charts -> iTunes.
import type { Track } from "./types";

function withTimeout(ms: number) {
  return AbortSignal.timeout(ms);
}

// ---------------------------------------------------------------------------
// Spotify (client-credentials flow; owner needs Spotify Premium since 2026)
// ---------------------------------------------------------------------------
let spotifyToken: { token: string; expiresAt: number } | null = null;

async function getSpotifyToken(): Promise<string | null> {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (spotifyToken && spotifyToken.expiresAt > Date.now()) return spotifyToken.token;

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
    signal: withTimeout(10000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  spotifyToken = {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) - 60) * 1000,
  };
  return spotifyToken.token;
}

async function spotifySearch(token: string, q: string, limit: number) {
  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("q", q);
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: withTimeout(10000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data?.tracks?.items ?? [];
}

async function searchSpotifyTracks(genres: string[], n: number): Promise<Track[]> {
  const token = await getSpotifyToken();
  if (!token) return [];
  const results: Track[] = [];
  for (const raw of genres) {
    const g = raw.trim();
    if (!g) continue;
    try {
      let items = await spotifySearch(token, `genre:"${g}"`, n);
      if (items.length === 0) items = await spotifySearch(token, g, n);
      for (const t of items) {
        results.push({
          genre: g,
          track: t.name,
          artist: t.artists?.[0]?.name ?? "?",
          url: t.external_urls?.spotify ?? "",
          source: "Spotify",
        });
      }
    } catch {
      // try the next genre
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Last.fm top tracks per tag (needs a free API key)
// ---------------------------------------------------------------------------
async function itunesLink(artist: string, track: string): Promise<string> {
  try {
    const url = new URL("https://itunes.apple.com/search");
    url.searchParams.set("term", `${artist} ${track}`);
    url.searchParams.set("entity", "song");
    url.searchParams.set("limit", "1");
    const res = await fetch(url, { signal: withTimeout(10000) });
    if (!res.ok) return "";
    const data = await res.json();
    return data?.results?.[0]?.trackViewUrl ?? "";
  } catch {
    return "";
  }
}

async function searchLastfmTracks(genres: string[], n: number): Promise<Track[]> {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) return [];

  const results: Track[] = [];
  for (const raw of genres) {
    const g = raw.trim();
    if (!g) continue;
    let tracks: unknown[] = [];
    try {
      const url = new URL("https://ws.audioscrobbler.com/2.0/");
      url.searchParams.set("method", "tag.gettoptracks");
      url.searchParams.set("tag", g);
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", String(n));
      const res = await fetch(url, { signal: withTimeout(10000) });
      if (!res.ok) continue;
      const data = await res.json();
      const raw2 = data?.tracks?.track ?? [];
      tracks = Array.isArray(raw2) ? raw2 : [raw2];
    } catch {
      continue;
    }
    for (const t of tracks as Record<string, unknown>[]) {
      const artist = (t?.artist as Record<string, unknown>)?.name as string | undefined ?? "?";
      const name = (t?.name as string | undefined) ?? "?";
      const url = (await itunesLink(artist, name)) || (t?.url as string | undefined) || "";
      results.push({ genre: g, track: name, artist, url, source: "Last.fm" });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Apple "Top Songs" charts (keyless)
// ---------------------------------------------------------------------------
const APPLE_GENRE_IDS: Record<string, number> = {
  blues: 2, classical: 5, country: 6, electronic: 7, electronica: 7,
  edm: 7, house: 7, techno: 7, trance: 7, dubstep: 7, dance: 17,
  jazz: 11, latin: 12, reggaeton: 12, "new age": 13, ambient: 13,
  chill: 13, "chill-out": 13, chillout: 13, "lo-fi": 13, lofi: 13,
  pop: 14, "synth-pop": 14, "dream pop": 20, "r&b": 15, rnb: 15,
  soul: 15, funk: 15, soundtrack: 16, cinematic: 16, "hip hop": 18,
  "hip-hop": 18, rap: 18, trap: 18, world: 19, alternative: 20,
  indie: 20, "indie pop": 20, "indie rock": 20, rock: 21, metal: 21,
  punk: 21, christian: 22, gospel: 22, vocal: 23, reggae: 24,
  acoustic: 10, "singer-songwriter": 10, folk: 10, "easy listening": 25,
  "j-pop": 27, "k-pop": 51,
};

function appleGenreId(genre: string): number | null {
  const g = genre.trim().toLowerCase();
  if (g in APPLE_GENRE_IDS) return APPLE_GENRE_IDS[g];
  for (const [key, gid] of Object.entries(APPLE_GENRE_IDS)) {
    if (g.includes(key) || key.includes(g)) return gid;
  }
  return null;
}

async function searchAppleChartTracks(genres: string[], n: number): Promise<Track[]> {
  const results: Track[] = [];
  for (const g of genres) {
    const gid = appleGenreId(g);
    if (gid == null) continue;
    try {
      const url = `https://itunes.apple.com/us/rss/topsongs/limit=${Math.max(
        n,
        1
      )}/genre=${gid}/json`;
      const res = await fetch(url, { signal: withTimeout(10000) });
      if (!res.ok) continue;
      const data = await res.json();
      const raw = data?.feed?.entry ?? [];
      const entries = Array.isArray(raw) ? raw : [raw];
      for (const e of entries) {
        results.push({
          genre: g,
          track: e?.["im:name"]?.label ?? "?",
          artist: e?.["im:artist"]?.label ?? "?",
          url: e?.id?.label ?? "",
          source: "Apple Charts",
        });
      }
    } catch {
      continue;
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// iTunes keyword search (last resort, keyless)
// ---------------------------------------------------------------------------
async function searchItunesTracks(genres: string[], n: number): Promise<Track[]> {
  const results: Track[] = [];
  for (const raw of genres) {
    const g = raw.trim();
    if (!g) continue;
    try {
      const url = new URL("https://itunes.apple.com/search");
      url.searchParams.set("term", g);
      url.searchParams.set("entity", "song");
      url.searchParams.set("limit", String(n));
      const res = await fetch(url, { signal: withTimeout(10000) });
      if (!res.ok) continue;
      const data = await res.json();
      for (const t of data?.results ?? []) {
        results.push({
          genre: g,
          track: t?.trackName ?? "?",
          artist: t?.artistName ?? "?",
          url: t?.trackViewUrl ?? "",
          source: "iTunes",
        });
      }
    } catch {
      continue;
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
export async function searchTracks(genres: string[], nTracksPerGenre: number): Promise<Track[]> {
  const providers: Array<(g: string[], n: number) => Promise<Track[]>> = [
    searchSpotifyTracks,
    searchLastfmTracks,
    searchAppleChartTracks,
    searchItunesTracks,
  ];
  for (const provider of providers) {
    try {
      const tracks = await provider(genres, nTracksPerGenre);
      if (tracks.length) return tracks;
    } catch {
      continue;
    }
  }
  return [];
}
