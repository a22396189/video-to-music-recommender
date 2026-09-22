// Client-side frame sampling using <video> + <canvas>. This replaces the
// Python pipeline's OpenCV extract_frames() so no ffmpeg/OpenCV binary is
// needed on the server - frames are sent to the API already extracted.
const MAX_WIDTH = 480;

function waitForSeek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    video.currentTime = time;
    // Some browsers never fire `seeked` for edge-case timestamps; don't hang.
    setTimeout(done, 3000);
  });
}

export async function extractFrames(
  file: File,
  fps: number,
  maxFrames: number
): Promise<string[]> {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  const objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("無法讀取這個影片檔案"));
    });

    const duration = video.duration || 0;
    const interval = 1 / fps;
    const timestamps: number[] = [];
    for (let t = 0; t < duration && timestamps.length < maxFrames; t += interval) {
      timestamps.push(t);
    }
    if (timestamps.length === 0) timestamps.push(0);

    const scale = Math.min(1, MAX_WIDTH / (video.videoWidth || MAX_WIDTH));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((video.videoWidth || MAX_WIDTH) * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || 270) * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("瀏覽器不支援 canvas");

    const frames: string[] = [];
    for (const t of timestamps) {
      await waitForSeek(video, t);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", 0.75));
    }
    return frames;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
