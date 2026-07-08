// Generate 6 more booth reference videos via fal.ai (same model/params as the
// app) and save them to public/videos/<id>.mp4. Idempotent — skips files that
// already exist, so it can be safely re-run to resume after a failure.
import { fal } from "@fal-ai/client";
import fs from "fs";
import path from "path";

// Load env (FAL_KEY) from .env.local / .env.
for (const f of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

if (!process.env.FAL_KEY) {
  console.error("FAL_KEY not found in env / .env.local");
  process.exit(1);
}
fal.config({ credentials: process.env.FAL_KEY });

const MODEL = "fal-ai/vidu/q3/text-to-video/turbo";

const NEW_CHALLENGES = [
  {
    id: "golden-retriever-beach",
    prompt: "A golden retriever running along a sunset beach, splashing through shallow ocean waves, warm golden backlight, slow motion, cinematic wide shot",
  },
  {
    id: "misty-forest-fox",
    prompt: "A red fox trotting through a misty pine forest at dawn, soft golden light shafts piercing through the fog, wide atmospheric cinematic shot",
  },
  {
    id: "storm-lighthouse",
    prompt: "A lone lighthouse on a rocky cliff battered by crashing waves during a dramatic storm at dusk, moody grey-blue sky, wide cinematic shot",
  },
  {
    id: "glacier-fjord",
    prompt: "A massive glacial waterfall cascading into a turquoise arctic fjord, icebergs drifting below, crisp cold light, sweeping aerial wide shot",
  },
  {
    id: "desert-caravan",
    prompt: "A camel caravan silhouetted against golden desert dunes at sunset, long dramatic shadows, warm sweeping wide cinematic shot",
  },
  {
    id: "hummingbird-garden",
    prompt: "A hummingbird hovering beside vibrant tropical flowers in a lush garden at morning, soft dew light, slow motion close cinematic shot",
  },
];

const outDir = path.join(process.cwd(), "public", "videos");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate(prompt) {
  console.log(`  Submitting to fal.ai...`);
  const { request_id } = await fal.queue.submit(MODEL, {
    input: { prompt, duration: 4, aspect_ratio: "16:9", resolution: "540p", audio: false },
  });
  console.log(`  Job queued (request_id: ${request_id}), polling...`);
  for (;;) {
    const st = await fal.queue.status(MODEL, { requestId: request_id, logs: false });
    const state = String(st.status);
    process.stdout.write(`  Status: ${state}\r`);
    if (state === "COMPLETED") break;
    if (state === "FAILED" || state === "CANCELLED") throw new Error(`job ${state}`);
    await sleep(4000);
  }
  console.log(`  Status: COMPLETED`);
  const { data } = await fal.queue.result(MODEL, { requestId: request_id });
  return data?.video?.url ?? data?.videos?.[0]?.url ?? data?.output?.video?.url ?? data?.url;
}

console.log("=".repeat(60));
console.log("  Generating 6 more reference videos via fal.ai (batch 2)");
console.log(`  Model: ${MODEL}`);
console.log("=".repeat(60));

let ok = 0;
for (const { id, prompt } of NEW_CHALLENGES) {
  const dest = path.join(outDir, `${id}.mp4`);
  if (fs.existsSync(dest)) {
    console.log(`\n[SKIP] ${id}.mp4 already exists`);
    ok++;
    continue;
  }
  console.log(`\n[${ok + 1}/${NEW_CHALLENGES.length}] Generating: ${id}`);
  console.log(`  Prompt: "${prompt.slice(0, 80)}..."`);
  try {
    const url = await generate(prompt);
    if (!url) {
      console.error(`  ERROR: No video URL returned for ${id}`);
      continue;
    }
    console.log(`  Downloading from: ${url.slice(0, 80)}...`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`  ERROR: Download failed for ${id}: HTTP ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    console.log(`  SAVED: ${id}.mp4 (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
    ok++;
  } catch (e) {
    console.error(`  ERROR for ${id}: ${e?.message || e}`);
  }
}

console.log("\n" + "=".repeat(60));
console.log(`  Done — ${ok}/${NEW_CHALLENGES.length} videos generated`);
console.log("=".repeat(60));
