import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const FFMPEG_BIN: string = ffmpegInstaller.path;

// Video similarity is computed with Google's gemini-embedding-2 multimodal
// model: each frame is embedded as an image (3072-dim), the per-frame vectors
// are mean-pooled into one video vector, and cosine similarity between the
// reference and user vectors becomes the score. This beat CLIP/GPT-Vision/pHash
// in benchmarking (highest agreement with human-style judges, cleanest spread).
const EMBED_MODEL = "gemini-embedding-2";
// Cosine→score mapping calibrated on the booth's reference set: identical
// videos score 1.0, strong matches ~0.92, weak matches ~0.75, unrelated ~0.60.
const COS_FLOOR = 0.6; // cosine at/below this maps to 0
const COS_CEIL = 1.0; // cosine at/above this maps to 100

export interface VideoAnalysisResult {
  videoScore: number;
  feedback: string;
  framesProcessed: number;
  timestamp: number;
  completedAt?: number;
  error?: string;
}

// Convert a URL-style path like /videos/golden-field.mp4 → filesystem path.
// NOTE: callers should pass an absolute HTTPS URL in production — the local public/
// folder is NOT present in the serverless function filesystem on Netlify.
function resolveVideoInput(input: string): string {
  if (input.startsWith("/videos/")) {
    return path.join(process.cwd(), "public", input);
  }
  return input; // CDN URL or absolute path — ffmpeg handles both
}

// Extract `count` frames evenly from a video (filesystem path or HTTPS URL)
// Frames deleted from disk immediately after being read into memory.
export async function extractFrames(videoInput: string, count = 4): Promise<Buffer[]> {
  const resolved = resolveVideoInput(videoInput);

  return new Promise((resolve, reject) => {
    // Use the OS temp dir (/tmp). On Netlify/Lambda process.cwd() is read-only,
    // so writing frames under it throws EROFS — /tmp is the only writable path.
    const tempDir = path.join(
      os.tmpdir(),
      "prompt-battle-frames",
      `f-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    fs.mkdirSync(tempDir, { recursive: true });

    const framePattern = path.join(tempDir, "frame_%d.jpg");

    // fps=1 → one frame per second, capped at `count`
    const proc = spawn(FFMPEG_BIN, [
      "-i", resolved,
      "-vf", "fps=1,scale=384:216",
      "-frames:v", String(count),
      "-q:v", "3",
      framePattern,
      "-y",
    ]);

    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    // Both inputs may be fetched over HTTPS (reference + user CDN video), so allow
    // more headroom than a purely local read would need.
    const timeout = setTimeout(() => {
      proc.kill();
      cleanup(tempDir);
      reject(new Error("ffmpeg timed out after 20s"));
    }, 20000);

    proc.on("close", (code) => {
      clearTimeout(timeout);
      try {
        const files = fs
          .readdirSync(tempDir)
          .filter((f) => f.startsWith("frame_"))
          .sort((a, b) => {
            const n = (s: string) => parseInt(s.match(/\d+/)?.[0] ?? "0");
            return n(a) - n(b);
          });

        if (files.length === 0) {
          cleanup(tempDir);
          reject(new Error(`ffmpeg produced no frames (exit ${code}). ${stderr.slice(-300)}`));
          return;
        }

        const buffers = files.slice(0, count).map((f) =>
          fs.readFileSync(path.join(tempDir, f))
        );
        cleanup(tempDir); // delete immediately after reading
        resolve(buffers);
      } catch (err) {
        cleanup(tempDir);
        reject(err);
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      cleanup(tempDir);
      if (err.code === "ENOENT") {
        reject(new Error(`ffmpeg binary not found at: ${FFMPEG_BIN}`));
      } else {
        reject(err);
      }
    });
  });
}

// Embed a set of JPEG frames with gemini-embedding-2 in a single batch call,
// then mean-pool into one L2-normalized video vector.
async function embedVideoVector(frames: Buffer[], apiKey: string): Promise<number[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: frames.map((buf) => ({
          model: `models/${EMBED_MODEL}`,
          content: {
            parts: [{ inline_data: { mime_type: "image/jpeg", data: buf.toString("base64") } }],
          },
        })),
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini embed error ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as { embeddings?: { values: number[] }[] };
  const vectors = (data.embeddings ?? []).map((e) => e.values).filter(Boolean);
  if (vectors.length === 0) throw new Error("Gemini returned no embeddings");

  const dim = vectors[0].length;
  const mean = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) mean[i] += v[i];
  for (let i = 0; i < dim; i++) mean[i] /= vectors.length;

  const norm = Math.sqrt(mean.reduce((s, x) => s + x * x, 0)) || 1e-12;
  return mean.map((x) => x / norm);
}

// Score visual similarity between reference and user video frames using
// gemini-embedding-2 multimodal embeddings. Returns a 0-100 score (cosine
// similarity rescaled) plus a one-sentence qualitative explanation.
export async function scoreVideoSimilarity(
  referenceFrames: Buffer[],
  userFrames: Buffer[]
): Promise<{ score: number; feedback: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const [refVec, userVec] = await Promise.all([
    embedVideoVector(referenceFrames, apiKey),
    embedVideoVector(userFrames, apiKey),
  ]);

  // Both vectors are already L2-normalized, so the dot product is the cosine.
  let cosine = 0;
  for (let i = 0; i < refVec.length; i++) cosine += refVec[i] * userVec[i];

  const score = Math.max(
    0,
    Math.min(100, Math.round(((cosine - COS_FLOOR) / (COS_CEIL - COS_FLOOR)) * 100))
  );

  const feedback =
    score >= 85 ? "Near-identical visuals — theme, color, and motion closely match the reference."
    : score >= 65 ? "Strong visual match with the reference, with some differences in detail or mood."
    : score >= 45 ? "Partial visual overlap — captures some of the reference's look but diverges in key elements."
    : "Visually distinct from the reference in subject, color, or style.";

  return { score, feedback };
}

function cleanup(dir: string) {
  try {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach((f) => {
      try { fs.unlinkSync(path.join(dir, f)); } catch {}
    });
    fs.rmdirSync(dir);
  } catch {}
}
