# Scoring Video Similarity for a Generative-AI Game Booth — A Six-Technique Benchmark

> **Source material for a blog post.** Everything below is drawn directly from the
> PromptBattle AI codebase and the benchmark harness in `Video_test/`. All numbers,
> formulas, and code excerpts are real (not illustrative). Pick and choose; rewrite
> in your own voice.

---

## TL;DR

We built a live booth game where a player watches a short reference video, *guesses
the prompt* that generated it, and an AI re-generates a video from their guess. To
rank players we needed a fast, fair way to answer one question: **how visually
similar is the player's video to the original?**

We benchmarked **six** different similarity techniques on the same 8-video test set
and shipped the one with the best accuracy-per-second-per-dollar trade-off:
**Google `gemini-embedding-2` multimodal embeddings + cosine similarity.**

| | Winner | Why |
|---|---|---|
| **Shipped to production** | Gemini Embedding-2 (T6) | Highest rank-correlation with human-style consensus (Spearman ρ = 0.93), multimodal, ~7s |
| **Best zero-cost local option** | CLIP embeddings (T3) | 0.78s, no API, 3/3 top-3 agreement |
| **Fastest screener** | Perceptual hash (T4) | 0.015s, but poor accuracy (1/3) |
| **Richest context, worst latency** | Gemini 2.5 Flash full-video (T2) | 21.5s + quota failures |

The final player score blends **30% prompt-text similarity + 70% video similarity**.

---

## 1. The Problem

A generative-AI booth has a tight loop and an unforgiving audience:

1. Player sees a reference video (e.g. a tropical waterfall with sunbeams).
2. Player writes a text prompt trying to recreate it.
3. We generate their video from that prompt (via [fal.ai](https://fal.ai), model
   `fal-ai/vidu/q3/text-to-video/turbo`).
4. We must **score the visual match** — live, in front of a crowd, in seconds.

Constraints that shaped the whole design:

- **Latency** — the player is standing there watching. Tens of seconds is painful.
- **Consistency** — two similar videos must reliably score similarly; the booth
  loses credibility if scores feel random.
- **Cost** — every play is an API call; a busy booth makes thousands.
- **Robustness** — must run inside a 60-second Netlify serverless function with a
  read-only filesystem (only `/tmp` is writable).

These constraints are *why* we benchmarked instead of guessing.

---

## 2. The Test Set

| Item | Value |
|------|-------|
| Reference video | `Original.mp4` — tropical waterfall, lush greenery, dramatic sunbeams |
| Test videos | `w1.mp4` … `w8.mp4` — 8 waterfall-scene variations of differing closeness |
| Frames sampled | 6 per video, resized to **384 × 216** |
| Frame sampler (benchmark) | OpenCV, evenly spaced via `np.linspace(0, total-1, 6)` |
| Frame sampler (production) | FFmpeg, `fps=1, scale=384:216`, 4 frames |
| Outputs | `similarity_results.csv`, `embed2_comparison.csv`, `similarity_report.txt` |

The test set is deliberately *hard*: every clip is a waterfall, so techniques can't
win just by detecting "water." They have to discriminate on color palette, lighting,
composition, and motion.

### Establishing "ground truth": a consensus rank

There's no human-labeled gold standard, so we built a **consensus score** by
averaging the five original techniques (T1–T5) per video, then ranked by it. This
consensus is the yardstick every technique (including the new T6) is measured
against.

**Consensus ranking (the "correct" order):**

| Rank | Video | Consensus score |
|------|-------|-----------------|
| 1 | w1 | 69.2 |
| 2 | w5 | 67.0 |
| 3 | w4 | 66.4 |
| 4 | w8 | 66.2 |
| 5 | w3 | 64.4 |
| 6 | w7 | 62.8 |
| 7 | w2 | 60.6 |
| 8 | w6 | 57.4 |

**Consensus top-3: w1, w4, w5.** This trio is the accuracy benchmark below.

---

## 3. The Six Techniques

| ID | Technique | Model / Method | API cost? |
|----|-----------|----------------|-----------|
| **T1** | GPT Vision | OpenAI `gpt-4o-mini`, frame-level vision-LLM judge | Yes |
| **T2** | Gemini 2.5 Flash | `google/gemini-2.5-flash`, full-video upload via Files API | Yes |
| **T3** | CLIP Embeddings | `open_clip ViT-B-32` (ResNet-50 fallback), cosine of frame embeddings | No (local) |
| **T4** | Perceptual Hash | DCT-based pHash, Hamming distance | No (local) |
| **T5** | CV Multi-metric | OpenCV ensemble (color + SSIM + temporal + edge) | No (local) |
| **T6** | **Gemini Embedding-2** | `gemini-embedding-2`, 3072-dim multimodal embeddings, cosine | Yes |

### T1 — GPT Vision (the original production baseline)

Send 3 frames from each video (base64) to `gpt-4o-mini` and ask it to judge the
visual match on theme, subject, color, mood, and style, returning a 0–100 score and
a one-sentence explanation. Temperature 0.2.

- **Strength:** human-readable feedback, genuinely *understands* the scene.
- **Weakness:** absolute scores are compressed (everything lands 50–80) and it's
  inconsistent run-to-run on fine detail.

### T2 — Gemini 2.5 Flash (full-video)

Upload the **entire** video to Google's Files API and let a multimodal LLM compare
the two clips end-to-end — the only technique that sees *temporal motion* directly
rather than via sampled frames.

- **Strength:** richest context (sees real motion, pacing, camera moves).
- **Weakness:** slowest by far (21.5s avg) and *fragile* — during the benchmark it
  hit `503 service unavailable` and `429 quota exceeded`, leaving **w7 with no
  score at all.** Production-hostile for a live booth.

### T3 — CLIP Embeddings (best local option)

Embed each frame with OpenCLIP ViT-B-32, mean-pool, cosine similarity. No network
call after the one-time model download.

Calibration (from `benchmark.py`):

```python
# CLIP cosine for unrelated images ≈ 0.2-0.5, related ≈ 0.6-0.95
# Scale [0.2, 0.98] → [0, 100] so scores are human-readable
score = max(0, min(100, round((cos - 0.20) / 0.78 * 100)))
```

- **Strength:** fast (0.78s), free, and the **tightest, most consistent spread**
  (std 2.4) with 3/3 top-3 agreement.
- **Weakness:** scores cluster high (86–93) — great for *ranking*, less intuitive as
  an absolute "you scored 88%" number.

### T4 — Perceptual Hash (the speed demon)

64-bit DCT perceptual hash per frame; similarity = min Hamming distance across all
frame pairs. (Falls back to grayscale normalized cross-correlation if `imagehash`
isn't installed.)

- **Strength:** absurdly fast — **0.015s**, ~50× faster than the next option, no
  model at all.
- **Weakness:** near-blind to semantic similarity (only 1/3 top-3 agreement). Good
  as a *pre-filter*, not a *judge*.

### T5 — CV Multi-metric (classical ensemble)

A hand-weighted blend of four OpenCV signals:

```python
composite = 0.30 * color      # HSV histogram (Bhattacharyya)
          + 0.35 * struct     # SSIM (or NCC fallback)
          + 0.20 * temporal   # temporal color-profile similarity
          + 0.15 * edge        # edge-density similarity
```

- **Strength:** fully interpretable — you can see *why* it scored what it did.
  Example for w4: color=50.1, ssim=18.7, **temporal=99.2**, edge=88.4.
- **Weakness:** the hand-tuned weights don't track human perception; produced the
  **lowest scores overall** (mean 48.1). SSIM in particular punishes any framing
  difference too harshly.

### T6 — Gemini Embedding-2 (the winner, now in production)

Google's native multimodal embedding model. Each frame is embedded **directly as an
image** into a 3072-dimensional vector; frame vectors are mean-pooled and
L2-normalized into one "video vector"; cosine similarity vs the reference becomes
the score.

This is the technique that shipped. The production implementation lives in
[`lib/video-analysis.ts`](lib/video-analysis.ts):

```ts
const EMBED_MODEL = "gemini-embedding-2";
const COS_FLOOR = 0.6; // cosine at/below this maps to 0
const COS_CEIL  = 1.0; // cosine at/above this maps to 100

// score = clamp( (cosine - 0.6) / (1.0 - 0.6) * 100 , 0, 100 )
```

- **Strength:** highest rank-correlation with consensus (ρ = 0.93), multimodal, and
  far more stable than the vision-LLM judges.
- **Weakness:** API cost and ~7s latency (acceptable because it overlaps with video
  generation/playback, see §8).

---

## 4. The Headline Results

### Per-video scores, every technique (the master table)

| Video | Consensus | T1 GPT | T2 Gemini-Flash | T3 CLIP | T4 pHash | T5 CV | T6 Embed-2 (score) | T6 cosine |
|-------|-----------|--------|-----------------|---------|----------|-------|--------------------|-----------|
| **w1** | 69.2 (#1) | 80 | 65 | 93 | 57 | 51 | 98 | 0.91639 |
| **w5** | 67.0 (#2) | 70 | 65 | 92 | 59 | 49 | **100** | **0.91910** |
| **w4** | 66.4 (#3) | 70 | 55 | 91 | 61 | 55 | 63 | 0.85749 |
| **w8** | 66.2 (#4) | 70 | 62 | 88 | 63 | 48 | 98 | 0.91545 |
| **w3** | 64.4 (#5) | 70 | 55 | 91 | 58 | 48 | 55 | 0.84453 |
| **w7** | 62.8 (#6) | 60 | — *(failed)* | 86 | 59 | 46 | 17 | 0.78257 |
| **w2** | 60.6 (#7) | 50 | 60 | 90 | 60 | 43 | 24 | 0.79277 |
| **w6** | 57.4 (#8) | 50 | 45 | 88 | 59 | 45 | 0 | 0.75370 |

> T6 scores are min-max scaled across the observed cosine range per run (w5 = best =
> 100, w6 = worst = 0), which is why its spread looks wider than T3's. In production
> the *fixed* calibration `(cos − 0.6)/0.4` is used instead, so absolute numbers are
> comparable across sessions.

### Summary statistics (T1–T5, from `similarity_report.txt`)

| Technique | Min | Max | Mean | Std | Avg time (s) |
|-----------|-----|-----|------|-----|--------------|
| T1 — GPT Vision | 50.0 | 80.0 | 65.0 | 10.7 | 2.885 |
| T2 — Gemini 2.5 Flash | 45.0 | 65.0 | 58.1 | 7.1 | **21.545** |
| T3 — CLIP Embeddings | 86.0 | 93.0 | 89.9 | **2.4** | 0.777 |
| T4 — Perceptual Hash | 57.0 | 63.0 | 59.5 | 1.9 | **0.015** |
| T5 — CV Multi-metric | 43.0 | 55.0 | 48.1 | 3.7 | 0.080 |
| T6 — Gemini Embedding-2 | 0.0* | 100.0* | — | — | ~7.2 |

\* T6 min/max are artifacts of per-run min-max scaling; cosine range was
0.7537–0.9191.

---

## 5. Speed Ranking (the trade-off that decided everything)

From fastest to slowest, average seconds per video:

| Rank | Technique | Avg time | Note |
|------|-----------|----------|------|
| 🥇 #1 | T4 Perceptual Hash | **0.015s** | No model — pure DCT |
| 🥈 #2 | T5 CV Multi-metric | 0.080s | OpenCV only |
| 🥉 #3 | T3 CLIP Embeddings | 0.777s | Local inference after 1× model load |
| #4 | T1 GPT Vision | 2.885s | API + frame encode |
| #5 | T6 Gemini Embedding-2 | ~7.2s | API + batch embed |
| #6 | T2 Gemini 2.5 Flash | **21.545s** | Full-video upload + LLM |

**The spread is ~1,400×** between the fastest and slowest technique. This single
chart is why full-video LLM scoring (T2) never had a chance for a live booth, no
matter how "smart" it is.

---

## 6. Accuracy: top-3 agreement & rank correlation

### Top-3 overlap with the consensus (w1, w4, w5)

| Technique | Top-3 it picked | Overlap |
|-----------|-----------------|---------|
| T1 — GPT Vision | w1, w4, w5 | **3/3** ✅ |
| T3 — CLIP Embeddings | w1, w4, w5 | **3/3** ✅ |
| T5 — CV Multi-metric | w1, w4, w5 | **3/3** ✅ |
| T2 — Gemini 2.5 Flash | w1, w5, w8 | 2/3 |
| T6 — Gemini Embedding-2 | w1, w5, w8 | 2/3 |
| T4 — Perceptual Hash | w2, w4, w8 | 1/3 ❌ |

### Spearman rank correlation — T6 (Gemini Embedding-2) vs everything else

Computed from the merged data in `embed2_comparison.csv` (n = 8; n = 7 vs T2 because
w7 failed):

| T6 compared against | Spearman ρ | Interpretation |
|---------------------|-----------|----------------|
| **Consensus (T1–T5 avg)** | **0.93** | Near-perfect agreement with the crowd-of-methods |
| T2 Gemini 2.5 Flash | 0.88 | Both Google multimodal — agree strongly |
| T1 GPT Vision | 0.77 | Solid agreement |
| T5 CV Multi-metric | 0.75 | Moderate |
| T3 CLIP Embeddings | 0.74 | Moderate (CLIP clusters everything high) |
| T4 Perceptual Hash | **−0.08** | No relationship — pHash is essentially random here |

**This is the punchline:** T6 agrees with the *consensus of five independent
methods* at ρ = 0.93 while running ~3× faster than the full-video LLM and at a
fraction of the cost. That's why it shipped.

> Note the interesting split: T6 picks **w8 over w4** for its #3 slot, disagreeing
> with consensus. w8 and w4 are genuinely close (consensus 66.2 vs 66.4 — a 0.2-point
> gap), so this is a coin-flip case, not a real error.

---

## 7. Calibration: turning a cosine into a 0–100 score

A raw cosine of 0.88 means nothing to a booth player. Each embedding technique needs
a calibration curve mapping its *observed* cosine range onto a human-readable 0–100.

| Technique | Cosine floor → 0 | Cosine ceil → 100 | Formula |
|-----------|------------------|-------------------|---------|
| **T6 Gemini Embedding-2 (prod)** | 0.60 | 1.00 | `(cos − 0.60) / 0.40 × 100` |
| T3 CLIP | 0.20 | 0.98 | `(cos − 0.20) / 0.78 × 100` |

Observed cosine landmarks for Gemini Embedding-2 (from
[`lib/video-analysis.ts`](lib/video-analysis.ts) comments + benchmark data):

| Match quality | Cosine | Maps to |
|---------------|--------|---------|
| Identical | ~1.00 | 100 |
| Strong match | ~0.92 | ~80 |
| Weak match | ~0.75 | ~37 |
| Unrelated | ~0.60 | 0 |

**Why the floors differ:** CLIP cosines for *unrelated* images already sit at
0.2–0.5, so its floor is 0.2. Gemini Embedding-2 packs everything into a tighter,
higher band (0.75–0.92 even for our hard waterfall set), so its floor is 0.6. Picking
the floor wrong is the single biggest source of "why is everyone scoring 90%?"
complaints.

### Qualitative feedback tiers (production)

The score also drives a one-line remark on the results screen:

```ts
score >= 85  → "Near-identical visuals — theme, color, and motion closely match."
score >= 65  → "Strong visual match, with some differences in detail or mood."
score >= 45  → "Partial visual overlap — captures some of the look but diverges."
else         → "Visually distinct from the reference in subject, color, or style."
```

---

## 8. The Production Pipeline (what actually ships)

### Architecture

```
Player prompt
   │
   ▼
fal.ai  (fal-ai/vidu/q3/text-to-video/turbo)   ── generates player's video
   │
   ▼
/api/video-similarity   (Netlify function, maxDuration = 60s)
   │
   ├─ extractFrames(reference, 4)  ┐  FFmpeg, fps=1, scale=384:216, /tmp only
   ├─ extractFrames(player, 4)     ┘  (parallel)
   │
   ├─ embedVideoVector(...)  ──► gemini-embedding-2 :batchEmbedContents
   │        mean-pool 4 frame vectors → L2-normalize → 1 video vector (×2)
   │
   ├─ cosine(refVec, userVec) → calibrate → videoScore (0–100)
   │
   └─ compositeScore = round(textScore × 0.3 + videoScore × 0.7)
```

### Key engineering details (each one a hard-won lesson)

1. **Frames go in `/tmp`, not `cwd`.** Netlify/Lambda filesystems are read-only
   except `/tmp`; writing frames anywhere else throws `EROFS`. Frames are also
   **deleted the instant they're read into memory**.

2. **Reference video fetched over absolute HTTPS, not a relative path.** The
   `public/` folder isn't present in the serverless function's filesystem, so the
   reference is pulled from `https://<host>/videos/<id>.mp4`.

3. **One batched embed call, not N.** All frames of a video go in a single
   `batchEmbedContents` request, then mean-pooled — fewer round-trips, lower latency.

4. **20-second FFmpeg timeout** guards against a hung fetch of a remote video.

5. **Latency is hidden, not eliminated.** The ~7s video-similarity scoring runs in
   the **background** while the player is already watching their generated video.
   They never stare at a spinner waiting for the score.

6. **Graceful degradation.** If frame extraction or embedding fails, the API still
   returns `200` with `videoScore: null` and the submission falls back to the
   text-only score (`markRoomSubmissionVideoUnavailable`). A 180-second safety net in
   the admin panel ensures a row never hangs on "scoring…" forever.

### The final blended score

```ts
// lib/scoring.ts
finalScore = round(textScore × 0.30 + videoScore × 0.70)   // null until video is ready
```

**Why 30/70?** The booth's core challenge is *visual recreation*, so the video
similarity dominates. The prompt-text similarity (how close the player's words were
to the original prompt) is a secondary, "did you think about it right" signal. The
final number is hidden until *both* parts resolve, so players never see a misleading
text-only score flash to a different number.

> ⚠️ **Doc drift to fix:** `SCORING.md` still documents a legacy **50/50** blend. The
> live code in `lib/scoring.ts`, `lib/rooms.ts`, and the video-similarity route all
> use **30/70**. Update the doc before publishing.

---

## 9. Recommendations & Decision Matrix

| Your situation | Pick | Why |
|----------------|------|-----|
| Live booth, online generation, want best accuracy | **T6 Gemini Embedding-2** | ρ=0.93 vs consensus, multimodal, latency hides behind playback |
| Offline / privacy-sensitive / zero API budget | **T3 CLIP** | 0.78s, free, 3/3 top-3, tightest spread |
| Need a millisecond pre-filter before an expensive call | **T4 pHash** | 0.015s — screen out obvious non-matches first |
| Need fully explainable, auditable scores | **T5 CV Multi-metric** | Every sub-metric is inspectable |
| Need human-readable *feedback*, not just a number | **T1 GPT Vision** | Writes a sentence on *why* it scored that |
| Want to analyze true temporal motion, latency no object | **T2 Gemini Flash full-video** | Only method that sees motion directly — but fragile & slow |

### Ideas worth exploring (for a "future work" section)

- **Ensemble T3 + T6.** CLIP for instant rank, Gemini Embedding-2 for the calibrated
  final — combine for speed *and* robustness.
- **pHash as a gate.** If pHash Hamming distance is huge, skip the expensive embed
  entirely and return a low score.
- **Re-tune T5's weights** against the consensus via regression instead of by hand —
  its components clearly carry signal (temporal especially), just mis-weighted.

---

## 10. Reproduce It Yourself

```bash
cd Video_test
pip install -r requirements_benchmark.txt

# Reference + test clips must be present: Original.mp4, w1.mp4 … w8.mp4
# GEMINI_API_KEY and OPENAI_API_KEY in ../.env

python benchmark.py     # T1–T5 → similarity_results.csv + similarity_report.txt
python embed2_test.py   # T6, merged comparison → embed2_comparison.csv
```

### File map

| File | Lines | Purpose |
|------|-------|---------|
| [`lib/video-analysis.ts`](lib/video-analysis.ts) | 196 | Production Gemini Embedding-2 pipeline (frames, embed, cosine, calibrate) |
| [`app/api/video-similarity/route.ts`](app/api/video-similarity/route.ts) | 99 | Serverless endpoint, orchestration, composite score, failure handling |
| [`lib/scoring.ts`](lib/scoring.ts) | 18 | 30/70 blend + evaluation remarks |
| [`lib/rooms.ts`](lib/rooms.ts) | 289 | Submission store, deferred composite, text-only fallback |
| `Video_test/benchmark.py` | 839 | T1–T5 benchmark harness |
| `Video_test/embed2_test.py` | 198 | T6 isolation test + Spearman/top-3 comparison |
| `Video_test/similarity_results.csv` | — | Raw T1–T5 data (8 videos) |
| `Video_test/embed2_comparison.csv` | — | T1–T6 merged (8 videos) |
| `Video_test/similarity_report.txt` | — | Human-readable summary & rankings |

---

## Appendix: Sample qualitative feedback (T1 GPT Vision)

These show the kind of *language* a vision-LLM produces — useful as pull-quotes:

- **w1 (best match):** *"The user video has a strong thematic match with the
  reference, but there are minor differences in composition and lighting."*
- **w4:** *"Features a waterfall and lush greenery similar to the reference, but the
  setting and color palette differ significantly."*
- **w6 (worst match):** *"Features waterfalls and natural scenery but differs
  significantly in visual theme, color palette, and overall mood."*

And the failure mode that killed T2 for live use, captured verbatim in the data:

> `w7 — upload failed: 503 The service is currently unavailable. | fallback failed:
> 429 You exceeded your current quota, please check your plan`

---

*Generated from the PromptBattle AI codebase. Every statistic traces to
`Video_test/similarity_results.csv`, `Video_test/embed2_comparison.csv`,
`Video_test/similarity_report.txt`, and the production source files listed above.*
