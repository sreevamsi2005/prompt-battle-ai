#!/usr/bin/env python3
"""
T6 — Gemini Embedding 2 (models/gemini-embedding-2)
====================================================
Native multimodal embeddings: each frame is embedded directly as an image
(3072-dim), frame vectors are mean-pooled into one video vector, then cosine
similarity vs the reference gives the score.  Directly comparable to T3 (CLIP).

Reuses the SAME frame extraction (6 frames @ 384x216) as benchmark.py and
compares its ranking against the consensus already saved in
similarity_results.csv.
"""
import os, sys, io, time
import cv2
import numpy as np
import pandas as pd

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import google.generativeai as genai

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
REF         = os.path.join(SCRIPT_DIR, "Original.mp4")
TESTS       = {f"w{i}": os.path.join(SCRIPT_DIR, f"w{i}.mp4") for i in range(1, 9)}
RESULTS_CSV = os.path.join(SCRIPT_DIR, "similarity_results.csv")
EMBED_MODEL = "models/gemini-embedding-2"
NUM_FRAMES  = 6


def load_key():
    for p in [os.path.join(os.path.dirname(SCRIPT_DIR), ".env"),
              os.path.join(os.path.dirname(SCRIPT_DIR), ".env.local")]:
        if os.path.exists(p):
            for line in open(p, encoding="utf-8"):
                line = line.strip()
                if line.startswith("GEMINI_API_KEY=") and "=" in line:
                    v = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if v:
                        return v
    return os.getenv("GEMINI_API_KEY", "")  # never hardcode keys


def extract_frames(path, count=NUM_FRAMES):
    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    idxs = np.linspace(0, max(total - 1, 0), count, dtype=int)
    frames = []
    for i in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
        ok, fr = cap.read()
        if ok:
            frames.append(cv2.resize(fr, (384, 216)))
    cap.release()
    return frames


def embed_frame(frame, retries=4):
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    part = {"mime_type": "image/jpeg", "data": buf.tobytes()}
    delay = 2.0
    for attempt in range(retries):
        try:
            r = genai.embed_content(model=EMBED_MODEL, content=part)
            return np.array(r["embedding"], dtype=np.float64)
        except Exception as e:
            if attempt == retries - 1:
                raise
            time.sleep(delay)
            delay *= 2
    return None


def video_vector(frames):
    vecs = [embed_frame(f) for f in frames]
    m = np.mean(vecs, axis=0)
    return m / (np.linalg.norm(m) + 1e-12)


def spearman(rank_a, rank_b):
    """Spearman rho between two rank dicts keyed by video name."""
    keys = [k for k in rank_a if k in rank_b]
    n = len(keys)
    if n < 2:
        return float("nan")
    d2 = sum((rank_a[k] - rank_b[k]) ** 2 for k in keys)
    return 1 - (6 * d2) / (n * (n * n - 1))


def main():
    genai.configure(api_key=load_key())
    print("=" * 64)
    print("  T6 - Gemini Embedding 2  (models/gemini-embedding-2)")
    print("  Native image embeddings, mean-pooled, cosine vs reference")
    print("=" * 64)

    print("\nEmbedding reference (Original.mp4)...", end=" ", flush=True)
    t0 = time.time()
    ref_vec = video_vector(extract_frames(REF))
    print(f"done ({time.time() - t0:.1f}s, {len(ref_vec)} dims)")

    rows = []
    for name, path in TESTS.items():
        t1 = time.time()
        try:
            vec = video_vector(extract_frames(path))
            cos = float(np.dot(ref_vec, vec))
            elapsed = time.time() - t1
            rows.append({"video": name, "t6_cosine": round(cos, 5),
                         "t6_time_s": round(elapsed, 2)})
            print(f"  {name}: cosine={cos:.5f}  ({elapsed:.1f}s)")
        except Exception as e:
            rows.append({"video": name, "t6_cosine": None, "t6_time_s": None})
            print(f"  {name}: FAILED {str(e)[:80]}")

    df6 = pd.DataFrame(rows)

    # Scale cosine -> 0-100 over the observed range (relative, for readability)
    cmin, cmax = df6["t6_cosine"].min(), df6["t6_cosine"].max()
    df6["t6_score"] = ((df6["t6_cosine"] - cmin) / (cmax - cmin + 1e-12) * 100).round(0)
    df6["t6_rank"]  = df6["t6_cosine"].rank(ascending=False, method="min").astype(int)
    df6 = df6.sort_values("t6_cosine", ascending=False)

    print("\n" + "-" * 64)
    print("  T6 RANKING (best match first)")
    print("-" * 64)
    print(f"  {'Video':<7}{'Cosine':>10}{'Score/100':>11}{'Rank':>6}{'Time(s)':>10}")
    for _, r in df6.iterrows():
        print(f"  {r['video']:<7}{r['t6_cosine']:>10.5f}{r['t6_score']:>11.0f}"
              f"{r['t6_rank']:>6}{r['t6_time_s']:>10.2f}")

    avg_time = df6["t6_time_s"].dropna().mean()
    print(f"\n  Avg time per video: {avg_time:.2f}s")

    # ---- Compare against existing benchmark results ----
    if not os.path.exists(RESULTS_CSV):
        print("\n[!] similarity_results.csv not found - skipping comparison")
        return

    base = pd.read_csv(RESULTS_CSV)
    merged = base.merge(df6[["video", "t6_cosine", "t6_score", "t6_rank", "t6_time_s"]],
                        on="video", how="left")

    def rank_dict(df, score_col, higher_better=True):
        # rank #1 = best match (highest score by default)
        d = df.dropna(subset=[score_col]).copy()
        d["_r"] = d[score_col].rank(ascending=not higher_better, method="min")
        return dict(zip(d["video"], d["_r"]))

    t6_ranks = dict(zip(df6["video"], df6["t6_rank"]))
    comparisons = {
        "Consensus (T1-T5 avg)": rank_dict(base, "consensus_score"),
        "T1 GPT Vision":         rank_dict(base, "t1_score"),
        "T2 Gemini 2.5 Flash":   rank_dict(base, "t2_score"),
        "T3 CLIP Embeddings":    rank_dict(base, "t3_score"),
        "T4 Perceptual Hash":    rank_dict(base, "t4_score"),
        "T5 CV Multi-metric":    rank_dict(base, "t5_score"),
    }

    top3_t6 = set(df6.nsmallest(3, "t6_rank")["video"])
    print("\n" + "=" * 64)
    print("  ACCURACY — how T6's ranking agrees with each technique")
    print("=" * 64)
    print(f"  {'Reference technique':<24}{'Spearman':>10}{'Top-3 overlap':>16}")
    for label, rd in comparisons.items():
        rho = spearman(t6_ranks, rd)
        # top-3 of that technique
        top3_other = set(sorted(rd, key=rd.get)[:3])
        overlap = len(top3_t6 & top3_other)
        print(f"  {label:<24}{rho:>10.3f}{(str(overlap) + '/3'):>16}")
    print(f"\n  T6 top-3: {sorted(top3_t6)}")

    # ---- Speed comparison ----
    print("\n" + "=" * 64)
    print("  SPEED — avg seconds per video (lower = faster)")
    print("=" * 64)
    speeds = {
        "T4 Perceptual Hash":    base["t4_time_s"].mean(),
        "T5 CV Multi-metric":    base["t5_time_s"].mean(),
        "T3 CLIP Embeddings":    base["t3_time_s"].mean(),
        "T1 GPT Vision":         base["t1_time_s"].mean(),
        "T6 Gemini Embedding 2": avg_time,
        "T2 Gemini 2.5 Flash":   base["t2_time_s"].mean(),
    }
    for rank, (label, s) in enumerate(sorted(speeds.items(), key=lambda x: x[1]), 1):
        mark = "  <-- NEW" if label.startswith("T6") else ""
        print(f"  #{rank}  {label:<24}{s:>9.3f}s{mark}")

    # Save merged CSV for the record
    out = os.path.join(SCRIPT_DIR, "embed2_comparison.csv")
    merged.to_csv(out, index=False, encoding="utf-8-sig")
    print(f"\n[OK] Merged comparison saved -> {out}")


if __name__ == "__main__":
    main()
