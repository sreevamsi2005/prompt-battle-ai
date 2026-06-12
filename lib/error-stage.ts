// Human-readable labels for the `stage` field returned by our API routes.
// Keeps error messaging consistent and specific across the app.
const STAGE_LABELS: Record<string, string> = {
  request: "Bad request",
  config: "Configuration error",
  queue_submit: "Queue submission failed",
  queue_status: "Queue status check failed",
  generation: "Generation failed",
  fetch_result: "Result download failed",
  no_video: "No video returned",
  storage: "Storage error",
  scoring: "Scoring failed",
};

/** Build a precise, user-facing message from an API error payload. */
export function formatApiError(
  payload: { error?: string; stage?: string } | null | undefined,
  fallback = "Something went wrong."
): string {
  if (!payload?.error) return fallback;
  const label = payload.stage ? STAGE_LABELS[payload.stage] : undefined;
  return label ? `${label}: ${payload.error}` : payload.error;
}
