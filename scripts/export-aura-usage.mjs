// Export the AURA usage/cost CSV for handing to the reporting department.
//
// This is an OPS/EXPORT tool ONLY — NOT imported by the app, not wired into any
// route or UI. The app accumulates one CSV row per play into the "aura/usage-csv"
// store as a side effect of normal play (see lib/aura-usage.ts). This script just
// reads that store and writes it out as a real .csv file.
//
// Columns: AttendeeID, TimeStamp, AttendeeInputs, TokenUsage, Cost
// Each row = one play; TokenUsage/Cost each hold all 3 models
// (google-embeddings-002, gpt-4o-mini, vidu-q3-turbo).
//
// Sources, in order:
//   1. Prod (Netlify Blobs) — when NETLIFY_SITE_ID + NETLIFY_API_TOKEN are set.
//   2. Local dev file — the out-of-tree dev store, then legacy ./data.
//
// Usage:
//   node scripts/export-aura-usage.mjs                 # writes aura-usage-<date>.csv + prints
//   node scripts/export-aura-usage.mjs out.csv          # writes to a chosen path
//   node scripts/export-aura-usage.mjs --stdout         # print CSV to stdout only
//
// Prod alternative (no script): `netlify blobs:get aura usage-csv`
import fs from "fs";
import os from "os";
import path from "path";

const args = process.argv.slice(2);
const toStdout = args.includes("--stdout");
const outArg = args.find((a) => !a.startsWith("--"));

function coerceCsv(value) {
  // The store holds the CSV as a JSON-encoded string; blobGet/local read may hand
  // it back already-parsed (a plain string) or as raw JSON text — handle both.
  if (typeof value === "string") {
    if (value.startsWith("AttendeeID")) return value;
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {}
    return value;
  }
  return "";
}

async function fromNetlify() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) return null;
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore({ name: "aura", siteID, token });
    const data = await store.get("usage-csv", { type: "json" });
    const csv = coerceCsv(data);
    return csv ? { source: `Netlify Blobs (site ${siteID}, aura/usage-csv)`, csv } : null;
  } catch (err) {
    console.error("[export] Netlify Blobs read failed:", err?.message || err);
    return null;
  }
}

function fromLocal() {
  const candidates = [
    path.join(os.tmpdir(), "prompt-battle-devstore", "aura-usage-csv.json"),
    path.join(process.cwd(), "data", "aura-usage-csv.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return { source: p, csv: coerceCsv(JSON.parse(fs.readFileSync(p, "utf-8"))) };
      } catch {
        try {
          return { source: p, csv: coerceCsv(fs.readFileSync(p, "utf-8")) };
        } catch {}
      }
    }
  }
  return null;
}

(async () => {
  const result = (await fromNetlify()) ?? fromLocal();
  if (!result || !result.csv) {
    console.error(
      "No AURA usage data found.\n" +
      "  - Prod: set NETLIFY_SITE_ID and NETLIFY_API_TOKEN, or run `netlify blobs:get aura usage-csv`.\n" +
      "  - Local: run the app and complete a few plays first."
    );
    process.exit(1);
  }

  const csv = result.csv.endsWith("\n") ? result.csv : result.csv + "\n";
  const rowCount = Math.max(0, csv.trim().split("\n").length - 1); // minus header

  if (toStdout) {
    process.stdout.write(csv);
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const outPath = outArg || path.join(process.cwd(), `aura-usage-${date}.csv`);
  fs.writeFileSync(outPath, csv, "utf-8");
  console.log("=".repeat(60));
  console.log("  AURA USAGE EXPORT");
  console.log(`  source : ${result.source}`);
  console.log(`  rows   : ${rowCount} play(s)`);
  console.log(`  wrote  : ${outPath}`);
  console.log("=".repeat(60));
})();
