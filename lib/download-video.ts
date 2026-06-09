import fs from "fs";
import path from "path";
import https from "https";
import { markAsDownloaded } from "@/lib/video-cache";

const VIDEOS_DIR = path.join(process.cwd(), "public", "videos");

export function ensureVideosDir() {
  if (!fs.existsSync(VIDEOS_DIR)) {
    fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  }
}

/**
 * Download video from CDN URL to local storage.
 * Does NOT block — runs in background.
 * Resolves when download completes or fails (non-fatal).
 */
export async function downloadVideoInBackground(
  promptId: string,
  cdnUrl: string
): Promise<void> {
  // Non-blocking: fire and forget
  downloadVideo(promptId, cdnUrl).catch((err) => {
    console.error(`Failed to download video ${promptId}:`, err);
  });
}

/**
 * Download a video from CDN to local public/videos directory.
 */
async function downloadVideo(promptId: string, cdnUrl: string): Promise<void> {
  ensureVideosDir();

  const localPath = path.join(VIDEOS_DIR, `${promptId}.mp4`);

  // Skip if already exists
  if (fs.existsSync(localPath)) {
    markAsDownloaded(promptId);
    return;
  }

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(localPath);

    https
      .get(cdnUrl, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);

        file.on("finish", () => {
          file.close();
          markAsDownloaded(promptId);
          resolve();
        });
      })
      .on("error", (err) => {
        fs.unlink(localPath, () => {}); // cleanup on error
        reject(err);
      });

    file.on("error", (err) => {
      fs.unlink(localPath, () => {}); // cleanup on error
      reject(err);
    });
  });
}

/**
 * Check if local video file exists
 */
export function localVideoExists(promptId: string): boolean {
  ensureVideosDir();
  const localPath = path.join(VIDEOS_DIR, `${promptId}.mp4`);
  return fs.existsSync(localPath);
}
