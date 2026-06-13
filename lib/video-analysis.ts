import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const FFMPEG_BIN: string = ffmpegInstaller.path;

export interface VideoAnalysisResult {
  videoScore: number;
  feedback: string;
  framesProcessed: number;
  timestamp: number;
  completedAt?: number;
  error?: string;
}

// Convert a URL-style path like /videos/golden-field.mp4 → filesystem path
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
    const tempDir = path.join(
      process.cwd(),
      ".tmp-frames",
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

    const timeout = setTimeout(() => {
      proc.kill();
      cleanup(tempDir);
      reject(new Error("ffmpeg timed out after 10s"));
    }, 10000);

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

// Score visual similarity between reference and user video frames using
// gpt-5.4-mini vision. Returns 0-100 score + one-sentence explanation.
export async function scoreVideoSimilarity(
  referenceFrames: Buffer[],
  userFrames: Buffer[]
): Promise<{ score: number; feedback: string }> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const toImg = (buf: Buffer) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:image/jpeg;base64,${buf.toString("base64")}`,
      detail: "low" as const,
    },
  });

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "You are a judge comparing two AI-generated video sequences.\n\nREFERENCE VIDEO (the challenge target):",
          },
          ...referenceFrames.slice(0, 3).map(toImg),
          { type: "text", text: "USER VIDEO (the player's attempt):" },
          ...userFrames.slice(0, 3).map(toImg),
          {
            type: "text",
            text: `Score how closely the user's video matches the reference in: visual theme, subject matter, color palette, mood, and style.

Scoring guide:
90-100 = near-identical theme and style
70-89  = strong thematic match, minor differences
50-69  = partial match, some overlap
0-49   = different content or style

Respond ONLY with valid JSON (no markdown): {"score": <0-100>, "feedback": "<one sentence why>"}`,
          },
        ],
      },
    ],
    max_tokens: 150,
    temperature: 0.2,
  });

  const raw = response.choices[0]?.message?.content?.trim() ?? "";

  try {
    const json = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(json);
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
    return { score, feedback: String(parsed.feedback ?? "") };
  } catch {
    const m = raw.match(/\b(\d{1,3})\b/);
    return {
      score: m ? Math.min(100, parseInt(m[1])) : 50,
      feedback: "Visual analysis completed.",
    };
  }
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
