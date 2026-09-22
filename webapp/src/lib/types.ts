export type Track = {
  genre: string;
  track: string;
  artist: string;
  url: string;
  source: string;
};

export type AnalyzeResult = {
  captions: string[];
  summary: string;
  genres: string[];
  tracks: Track[];
};
