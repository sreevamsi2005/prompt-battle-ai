import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const FFMPEG_BIN: string = ffmpegInstaller.path;

// Video similarity is computed with Google's gemini-embedding-2 multimodal model.
//
// PRIMARY PATH — full video: the complete MP4 (reference + user) is sent directly
// to embedContent as inline video data, producing one 3072-dim vector per video.
// Benchmarks showed this is usually the fastest AND highest-fidelity option
// (~4-8s per video), BUT its latency is unpredictable — the same call has been
// observed to take anywhere from 3.6s to 54s with no discernible pattern.
//
// FALLBACK PATH — 16 frames: if the full-video attempt hasn't completed within
// FULL_VIDEO_TIMEOUT_MS, we abort it and fall back to extracting 16 frames per
// video, embedding them in one batch call, and mean-pooling into a video vector.
// Frame-based latency is consistently 5-11s, so the fallback keeps the total
// request inside Netlify's 60s function budget even on a bad day.
const EMBED_MODEL = "gemini-embedding-2";
// Cosine→score mapping: anything at/below 0.75 scores 0; from 0.75→1.0 it scales
// linearly to 0→100, i.e. score = round(100 * (cosine - 0.75) / 0.25). This makes
// the booth stricter — only genuinely close visual matches earn points.
const COS_FLOOR = 0.75; // cosine at/below this maps to 0
const COS_CEIL = 1.0; // cosine at/above this maps to 100
// Give the full-video attempt this long before aborting and switching to frames.
const FULL_VIDEO_TIMEOUT_MS = 30_000;
// Frames per video for the fallback path.
const FALLBACK_FRAME_COUNT = 16;
// inline_data payloads are capped (~20MB request). Booth clips are 2-6MB, but if
// a video is unexpectedly large, skip full-video and go straight to frames.
const MAX_INLINE_VIDEO_BYTES = 14 * 1024 * 1024;

export interface VideoAnalysisResult {
  videoScore: number;
  feedback: string;
  framesProcessed: number;
  timestamp: number;
  completedAt?: number;
  error?: string;
}

export interface SimilarityOutcome {
  score: number;
  feedback: string;
  // Which pipeline produced the score — surfaced in the API response/logs.
  method: "full-video" | `frames-${number}`;
  framesProcessed: number;
}

// Convert a URL-style path like /videos/golden-field.mp4 → filesystem path.
// NOTE: callers should pass an absolute HTTPS URL in production — the local public/
// folder is NOT present in the serverless function filesystem on Netlify.
function resolveVideoInput(input: string): string {
  if (input.startsWith("/videos/")) {
    return path.join(process.cwd(), "public", input);
  }
  return input; // CDN URL or absolute path — ffmpeg/fetch handle both
}

// Extract `count` frames evenly from a video (filesystem path or HTTPS URL).
// The sampling rate scales with the requested count assuming ~4s booth clips
// (count=4 → 1fps, count=16 → 4fps) so higher counts still span the whole clip.
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
    const fps = Math.max(1, Math.ceil(count / 4)); // ~4s clips → covers full duration

    const proc = spawn(FFMPEG_BIN, [
      "-i", resolved,
      "-vf", `fps=${fps},scale=384:216`,
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

// Read a video into memory: local file for /videos/ paths in dev, HTTPS fetch
// for CDN/deployment URLs in production.
async function fetchVideoBytes(input: string, signal?: AbortSignal): Promise<Buffer> {
  const resolved = resolveVideoInput(input);
  if (!/^https?:\/\//i.test(resolved)) {
    return fs.promises.readFile(resolved);
  }
  const res = await fetch(resolved, { signal });
  if (!res.ok) throw new Error(`video fetch failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1e-12;
  return vec.map((x) => x / norm);
}

// Embed one COMPLETE video (raw MP4 bytes) in a single embedContent call.
async function embedFullVideoVector(bytes: Buffer, apiKey: string, signal?: AbortSignal): Promise<number[]> {
  if (bytes.length > MAX_INLINE_VIDEO_BYTES) {
    throw new Error(`video too large for inline embed (${(bytes.length / 1048576).toFixed(1)}MB)`);
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        content: {
          parts: [{ inline_data: { mime_type: "video/mp4", data: bytes.toString("base64") } }],
        },
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini full-video embed error ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as { embedding?: { values: number[] } };
  const values = data.embedding?.values;
  if (!values?.length) throw new Error("Gemini returned no embedding for full video");
  return l2Normalize(values);
}

// Embed a set of JPEG frames with gemini-embedding-2 in a single batch call,
// then mean-pool into one L2-normalized video vector.
async function embedFramesVector(frames: Buffer[], apiKey: string): Promise<number[]> {
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

  return l2Normalize(mean);
}

function cosineOf(a: number[], b: number[]): number {
  // Inputs are already L2-normalized, so the dot product is the cosine.
  let cosine = 0;
  for (let i = 0; i < a.length; i++) cosine += a[i] * b[i];
  return cosine;
}

function toOutcome(cosine: number, method: SimilarityOutcome["method"], framesProcessed: number): SimilarityOutcome {
  const score = Math.max(
    0,
    Math.min(100, Math.round(((cosine - COS_FLOOR) / (COS_CEIL - COS_FLOOR)) * 100))
  );

  const feedback =
    score >= 85 ? "Near-identical visuals — theme, color, and motion closely match the reference."
    : score >= 65 ? "Strong visual match with the reference, with some differences in detail or mood."
    : score >= 45 ? "Partial visual overlap — captures some of the reference's look but diverges in key elements."
    : "Visually distinct from the reference in subject, color, or style.";

  return { score, feedback, method, framesProcessed };
}

// Reference videos are fixed per challenge, so cache their full-video vectors
// across warm serverless invocations — halves latency and quota on repeat plays.
const refVectorCache = new Map<string, number[]>();

// Main entry: score visual similarity between the reference video and the
// player's generated video. Tries the full-video embedding first (best quality,
// usually fastest); if that path hasn't finished within FULL_VIDEO_TIMEOUT_MS —
// its latency is known to spike unpredictably — aborts and falls back to
// 16-frame sampling, which is consistently fast.
export async function analyzeVideoSimilarity(
  referenceInput: string,
  userInput: string
): Promise<SimilarityOutcome> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  // ── Attempt 1: full video with a hard 30s deadline ──────────────────────
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), FULL_VIDEO_TIMEOUT_MS);
  try {
    const refPromise = (async () => {
      const cached = refVectorCache.get(referenceInput);
      if (cached) return cached;
      const bytes = await fetchVideoBytes(referenceInput, controller.signal);
      const vec = await embedFullVideoVector(bytes, apiKey, controller.signal);
      refVectorCache.set(referenceInput, vec);
      return vec;
    })();
    const userPromise = (async () => {
      const bytes = await fetchVideoBytes(userInput, controller.signal);
      return embedFullVideoVector(bytes, apiKey, controller.signal);
    })();

    const [refVec, userVec] = await Promise.all([refPromise, userPromise]);
    clearTimeout(deadline);
    return toOutcome(cosineOf(refVec, userVec), "full-video", 0);
  } catch (err) {
    clearTimeout(deadline);
    const reason = controller.signal.aborted
      ? `timed out after ${FULL_VIDEO_TIMEOUT_MS / 1000}s`
      : err instanceof Error ? err.message : String(err);
    console.warn(`[video-analysis] full-video embed failed (${reason}) — falling back to ${FALLBACK_FRAME_COUNT} frames`);
  }

  // ── Attempt 2: 16-frame sampling (consistent 5-11s latency) ─────────────
  const [refFrames, userFrames] = await Promise.all([
    extractFrames(referenceInput, FALLBACK_FRAME_COUNT),
    extractFrames(userInput, FALLBACK_FRAME_COUNT),
  ]);
  const [refVec, userVec] = await Promise.all([
    embedFramesVector(refFrames, apiKey),
    embedFramesVector(userFrames, apiKey),
  ]);
  return toOutcome(cosineOf(refVec, userVec), `frames-${FALLBACK_FRAME_COUNT}`, FALLBACK_FRAME_COUNT);
}

// Legacy frame-based scorer kept for compatibility (route now uses
// analyzeVideoSimilarity, which adds the full-video primary path).
export async function scoreVideoSimilarity(
  referenceFrames: Buffer[],
  userFrames: Buffer[]
): Promise<{ score: number; feedback: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const [refVec, userVec] = await Promise.all([
    embedFramesVector(referenceFrames, apiKey),
    embedFramesVector(userFrames, apiKey),
  ]);

  const { score, feedback } = toOutcome(cosineOf(refVec, userVec), `frames-${referenceFrames.length}`, referenceFrames.length);
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
