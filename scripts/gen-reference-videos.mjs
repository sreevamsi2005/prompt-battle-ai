// One-off: generate the 6 new booth reference videos via fal.ai (same model/params
// as the app) and save them to public/videos/<id>.mp4. Idempotent — skips files
// that already exist, so it can be safely re-run to resume after a failure.
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

const CHALLENGES = [
  { id: "koi-pond", prompt: "A vibrant orange and white koi fish gliding slowly through a tranquil pond dotted with pink lotus flowers, clear rippling water, soft natural daylight, serene close-up" },
  { id: "hot-air-balloons", prompt: "Dozens of colorful hot air balloons drifting over rolling green hills at sunrise, soft morning mist, warm pastel sky, gentle sweeping aerial wide shot" },
  { id: "rainforest-waterfall", prompt: "A powerful waterfall cascading into a misty turquoise pool deep in a lush tropical rainforest, sun rays piercing through the dense canopy, vibrant green foliage, cinematic" },
  { id: "vintage-train", prompt: "A vintage steam locomotive winding through snowy mountain valleys, billowing white steam, warm golden afternoon light glinting off the metal, nostalgic cinematic wide shot" },
  { id: "underwater-city", prompt: "A lone diver exploring the ruins of a bioluminescent sunken city deep underwater, glowing blue coral overtaking ancient stone towers, shafts of light from the surface, eerie atmospheric" },
  { id: "desert-sandstorm", prompt: "A massive towering sandstorm wall engulfing an abandoned desert town at dusk, swirling ochre dust, dramatic backlight, intense apocalyptic cinematic scale" },
];

const outDir = path.join(process.cwd(), "public", "videos");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate(prompt) {
  const { request_id } = await fal.queue.submit(MODEL, {
    input: { prompt, duration: 4, aspect_ratio: "16:9", resolution: "540p", audio: false },
  });
  for (;;) {
    const st = await fal.queue.status(MODEL, { requestId: request_id, logs: false });
    const state = String(st.status);
    if (state === "COMPLETED") break;
    if (state === "FAILED" || state === "CANCELLED") throw new Error(`job ${state}`);
    await sleep(4000);
  }
  const { data } = await fal.queue.result(MODEL, { requestId: request_id });
  return data?.video?.url ?? data?.videos?.[0]?.url ?? data?.output?.video?.url ?? data?.url;
}

let ok = 0;
for (const { id, prompt } of CHALLENGES) {
  const dest = path.join(outDir, `${id}.mp4`);
  if (fs.existsSync(dest)) { console.log(`skip ${id} (already exists)`); ok++; continue; }
  console.log(`generating ${id} ...`);
  try {
    const url = await generate(prompt);
    if (!url) { console.error(`  no video URL for ${id}`); continue; }
    const res = await fetch(url);
    if (!res.ok) { console.error(`  download failed for ${id}: HTTP ${res.status}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    console.log(`  saved ${id}.mp4 (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
    ok++;
  } catch (e) {
    console.error(`  error for ${id}:`, e?.message || e);
  }
}
console.log(`done — ${ok}/${CHALLENGES.length} reference videos present`);
