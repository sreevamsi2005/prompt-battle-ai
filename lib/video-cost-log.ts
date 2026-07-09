import { blobGet, blobUpdate } from "./blob-storage";

/* ── Video generation cost/usage log ───────────────────────────────────────
 * Every fal.ai video generation (player prompt -> video) appends one entry
 * here once the job completes — same schema as the manually-built historical
 * record for the curated challenge videos (data/video-generation-costs.json),
 * so the file grows in place rather than needing a second source of truth.
 *
 * IMPORTANT: fal.ai's video-generation API does not expose token-level usage
 * anywhere (confirmed against @fal-ai/client's own types: its Result<T> is
 * just { data, requestId }, nothing else). input_tokens/output_tokens are
 * always null — that's not a logging gap, tokens genuinely don't apply to
 * this model. cost_usd is a COMPUTED ESTIMATE (duration * published rate),
 * never a number returned by the API.
 */

const STORE = "videocosts";
const KEY = "log";

const MODEL = "fal-ai/vidu/q3/text-to-video/turbo";
const DURATION_SECONDS = 4;
const RESOLUTION = "540p";
const ASPECT_RATIO = "16:9";
const AUDIO = false;
// Confirmed from fal.ai's own model page (https://fal.ai/models/fal-ai/vidu/q3/text-to-video/turbo).
const RATE_USD_PER_SECOND_540P = 0.035;

export interface VideoCostEntry {
  id: string;
  prompt: string | null;
  model: string;
  request_id: string;
  duration_seconds: number;
  resolution: string;
  aspect_ratio: string;
  audio: boolean;
  file_size_bytes: number | null;
  generated_at: string;
  playerName?: string;
  input_tokens: null;
  output_tokens: null;
  cost_usd: number;
}

interface VideoCostLog {
  _readme?: Record<string, unknown>;
  videos: VideoCostEntry[];
  totals: {
    video_count: number;
    total_duration_seconds: number;
    total_estimated_cost_usd: number;
  };
}

const EMPTY_LOG: VideoCostLog = {
  videos: [],
  totals: { video_count: 0, total_duration_seconds: 0, total_estimated_cost_usd: 0 },
};

async function fetchFileSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    const len = res.headers.get("content-length");
    return len ? parseInt(len, 10) : null;
  } catch {
    return null;
  }
}

/**
 * Records one completed fal.ai video generation's cost/usage details.
 * NEVER throws — logging must not break the game if this fails.
 */
export async function recordVideoGenerationCost(params: {
  id: string;
  requestId: string;
  videoUrl: string;
  prompt?: string | null;
  playerName?: string;
}): Promise<void> {
  try {
    const fileSize = await fetchFileSize(params.videoUrl);
    const cost = Math.round(DURATION_SECONDS * RATE_USD_PER_SECOND_540P * 100) / 100;

    const entry: VideoCostEntry = {
      id: params.id,
      prompt: params.prompt ?? null,
      model: MODEL,
      request_id: params.requestId,
      duration_seconds: DURATION_SECONDS,
      resolution: RESOLUTION,
      aspect_ratio: ASPECT_RATIO,
      audio: AUDIO,
      file_size_bytes: fileSize,
      generated_at: new Date().toISOString(),
      ...(params.playerName ? { playerName: params.playerName } : {}),
      input_tokens: null,
      output_tokens: null,
      cost_usd: cost,
    };

    await blobUpdate<VideoCostLog>(STORE, KEY, EMPTY_LOG, (cur) => {
      const videos = [...(cur.videos ?? []), entry];
      return {
        ...cur, // preserves _readme (and anything else) already in the file untouched
        videos,
        totals: {
          video_count: videos.length,
          total_duration_seconds: videos.reduce((s, v) => s + v.duration_seconds, 0),
          total_estimated_cost_usd: Math.round(videos.reduce((s, v) => s + v.cost_usd, 0) * 100) / 100,
        },
      };
    });
  } catch (err) {
    console.error("[video-cost-log] failed to record:", err instanceof Error ? err.message : err);
  }
}

export async function loadVideoCostLog(): Promise<VideoCostLog> {
  return blobGet<VideoCostLog>(STORE, KEY, EMPTY_LOG);
}
