// Ports caption_image() / aggregate_captions_llm() / recommend_music_genre_gemini()
// from the original video_to_music_recommendation.py.
//
// The original used a local BLIP model for per-frame captions. Hugging Face's
// serverless Inference API no longer supports the image-to-text task, so
// captioning is done with Gemini's own multimodal vision input instead - one
// batched call over all sampled frames.
const GEMINI_MODEL = (process.env.GEMINI_MODEL || "models/gemini-2.5-flash").replace(
  /^models\//,
  ""
);

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

async function callGemini(parts: GeminiPart[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const text: string =
    data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ??
    "";
  return text.trim();
}

function callGeminiText(prompt: string): Promise<string> {
  return callGemini([{ text: prompt }]);
}

function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

export async function captionFrames(frameDataUrls: string[]): Promise<string[]> {
  const parts: GeminiPart[] = [
    {
      text:
        `You are given ${frameDataUrls.length} frames sampled from a video, in order. ` +
        `Write ONE short factual caption per frame describing the dominant subject, action, ` +
        `and setting. Respond with ONLY a JSON array of exactly ${frameDataUrls.length} strings ` +
        `(one caption per frame, same order) - no markdown fences, no extra text.`,
    },
    ...frameDataUrls.map((dataUrl) => ({
      inline_data: {
        mime_type: "image/jpeg",
        data: dataUrl.split(",").pop() ?? dataUrl,
      },
    })),
  ];

  const text = await callGemini(parts);
  const cleaned = stripCodeFence(text);
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((s) => String(s).trim());
    }
  } catch {
    // fall through to a line-based fallback below
  }
  return cleaned
    .split("\n")
    .map((s) => s.replace(/^[-*\d.\s]+/, "").trim())
    .filter(Boolean);
}

export async function aggregateCaptions(captions: string[]): Promise<string> {
  const prompt = `You are given multiple descriptions of frames sampled from a video.

Frame descriptions:
${captions.map((c) => `- ${c}`).join("\n")}

Summarize the video in ONE concise sentence.
Focus on dominant actions, emotions, and atmosphere.`;
  return callGeminiText(prompt);
}

export async function recommendGenres(summary: string): Promise<string[]> {
  const prompt = `Video description:
"${summary}"

Suggest 2-3 suitable music genres.
Output ONLY comma-separated genre names.`;
  const text = await callGeminiText(prompt);
  return text
    .replace(/\n/g, ",")
    .split(",")
    .map((g) => g.trim().replace(/^[ .\-]+|[ .\-]+$/g, ""))
    .filter(Boolean);
}
