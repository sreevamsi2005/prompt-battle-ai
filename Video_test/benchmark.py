#!/usr/bin/env python3
"""
Video Similarity Benchmark — 5 Techniques
==========================================
Compares w1.mp4 - w8.mp4 against Original.mp4 using five different methods.
Results saved to similarity_results.csv sorted by consensus score.

Techniques:
  T1  GPT Vision        — gpt-4o-mini frames (existing prod approach)
  T2  Gemini 2.5 Flash  — full-video upload via Files API (free tier)
  T3  CLIP Embeddings   — cosine similarity of ViT-B/32 frame embeddings
  T4  Perceptual Hash   — pHash Hamming distance on frames
  T5  CV Multi-metric   — color histogram + SSIM + temporal dynamics + edges

Install:
    pip install opencv-python numpy pandas openai google-generativeai \
                Pillow imagehash scikit-image torch torchvision transformers tqdm
"""

# ─── Config ───────────────────────────────────────────────────────────────────
import os


def _load_dotenv_keys():
    """Read OPENAI_API_KEY / GEMINI_API_KEY from the project .env files if they
    aren't already set in the environment. Looks one level up (project root)."""
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, ".env"),
        os.path.join(os.path.dirname(here), ".env"),
        os.path.join(os.path.dirname(here), ".env.local"),
    ]
    found = {}
    for path in candidates:
        if not os.path.exists(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, val = line.partition("=")
                    key, val = key.strip(), val.strip().strip('"').strip("'")
                    if key in ("OPENAI_API_KEY", "GEMINI_API_KEY") and val:
                        # First file wins; .env (root) before .env.local
                        found.setdefault(key, val)
        except Exception:
            pass
    return found


_dotenv = _load_dotenv_keys()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY") or _dotenv.get("OPENAI_API_KEY", "")
GEMINI_API_KEY = (os.getenv("GEMINI_API_KEY") or _dotenv.get("GEMINI_API_KEY")
                  or "AIzaSyCP9FyY_c_613r9GOAZwtq5sdFnDEXVLEA")  # Gemini free tier

GPT_MODEL    = "gpt-4o-mini"   # existing prod model (gpt-5.4-mini in prod = same vision)
GEMINI_MODEL = "gemini-2.5-flash"  # thinking model — needs large max_output_tokens

NUM_FRAMES   = 6    # evenly-spaced frames extracted per video

SCRIPT_DIR      = os.path.dirname(os.path.abspath(__file__))
REFERENCE_VIDEO = os.path.join(SCRIPT_DIR, "Original.mp4")
TEST_VIDEOS     = {f"w{i}": os.path.join(SCRIPT_DIR, f"w{i}.mp4") for i in range(1, 9)}
OUTPUT_CSV      = os.path.join(SCRIPT_DIR, "similarity_results.csv")
OUTPUT_REPORT   = os.path.join(SCRIPT_DIR, "similarity_report.txt")

# ─── Imports ──────────────────────────────────────────────────────────────────
import sys, time, json, base64, warnings, textwrap, io
from pathlib import Path
from typing import List, Dict, Optional

# Force Windows console to UTF-8 so print() never trips on non-ASCII chars
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import cv2
import numpy as np
import pandas as pd
from tqdm import tqdm

warnings.filterwarnings("ignore")

# Optional deps — techniques skip gracefully if not installed
try:
    import openai as _openai
    OPENAI_OK = True
except ImportError:
    OPENAI_OK = False
    print("[!] openai not installed -- T1 will be skipped")

try:
    import google.generativeai as genai
    GEMINI_OK = True
except ImportError:
    GEMINI_OK = False
    print("[!] google-generativeai not installed -- T2 will be skipped")

try:
    import imagehash
    from PIL import Image as PILImage
    PHASH_OK = True
except ImportError:
    PHASH_OK = False
    print("[!] imagehash/Pillow not installed -- T4 uses fallback hash")

try:
    # open_clip_torch: pure PyTorch CLIP, no TensorFlow dependency
    import open_clip
    import torch
    from PIL import Image as PILImage
    CLIP_OK      = True
    CLIP_BACKEND = "open_clip"
except ImportError:
    try:
        # Fallback: torchvision ResNet-50 features (also pure PyTorch)
        import torch
        import torchvision.models as _tv_models
        import torchvision.transforms as _tv_transforms
        from PIL import Image as PILImage
        CLIP_OK      = True
        CLIP_BACKEND = "resnet"
    except ImportError:
        CLIP_OK      = False
        CLIP_BACKEND = None
        print("[!] open_clip_torch / torchvision not available -- T3 will be skipped")

try:
    from skimage.metrics import structural_similarity as ssim_fn
    SSIM_OK = True
except ImportError:
    SSIM_OK = False
    print("[!] scikit-image not installed -- SSIM replaced with NCC in T5")


# ─── Frame Extraction ─────────────────────────────────────────────────────────
def extract_frames(video_path: str, count: int = NUM_FRAMES) -> List[np.ndarray]:
    """Return `count` evenly-spaced BGR frames (384×216) from a video."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open: {video_path}")
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total == 0:
        raise RuntimeError(f"Empty video: {video_path}")
    indices = np.linspace(0, total - 1, count, dtype=int)
    frames = []
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
        ok, frame = cap.read()
        if ok:
            frames.append(cv2.resize(frame, (384, 216)))
    cap.release()
    if not frames:
        raise RuntimeError(f"No frames extracted from: {video_path}")
    return frames


def frames_to_b64_jpeg(frames: List[np.ndarray], quality: int = 85) -> List[str]:
    result = []
    for f in frames:
        _, buf = cv2.imencode(".jpg", f, [cv2.IMWRITE_JPEG_QUALITY, quality])
        result.append(base64.b64encode(buf.tobytes()).decode())
    return result


# ─── T1: GPT Vision (existing prod technique) ─────────────────────────────────
def t1_gpt_vision(ref_frames: List[np.ndarray], test_frames: List[np.ndarray]) -> Dict:
    """
    Uses gpt-4o-mini vision to judge similarity from 3 frames each.
    Mirrors the logic in lib/video-analysis.ts exactly.
    """
    if not OPENAI_OK or not OPENAI_API_KEY:
        return {"score": None, "feedback": "OPENAI_API_KEY not set or openai not installed",
                "time_s": 0.0}

    client = _openai.OpenAI(api_key=OPENAI_API_KEY)

    def img_msg(b64: str):
        return {"type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "low"}}

    ref_b64  = frames_to_b64_jpeg(ref_frames[:3])
    test_b64 = frames_to_b64_jpeg(test_frames[:3])

    t0 = time.time()
    try:
        resp = client.chat.completions.create(
            model=GPT_MODEL,
            messages=[{"role": "user", "content": [
                {"type": "text",
                 "text": "You are a judge comparing two AI-generated video sequences.\n\n"
                         "REFERENCE VIDEO (the challenge target):"},
                *[img_msg(b) for b in ref_b64],
                {"type": "text", "text": "USER VIDEO (the player's attempt):"},
                *[img_msg(b) for b in test_b64],
                {"type": "text",
                 "text": ("Score how closely the user's video matches the reference in: "
                          "visual theme, subject matter, color palette, mood, and style.\n\n"
                          "Scoring guide:\n"
                          "90-100 = near-identical theme and style\n"
                          "70-89  = strong thematic match, minor differences\n"
                          "50-69  = partial match, some overlap\n"
                          "0-49   = different content or style\n\n"
                          'Respond ONLY with valid JSON (no markdown): '
                          '{"score": <0-100>, "feedback": "<one sentence why>"}')},
            ]}],
            max_tokens=150,
            temperature=0.2,
        )
        elapsed = time.time() - t0
        raw = resp.choices[0].message.content.strip()
        raw = raw.replace("```json", "").replace("```", "").strip()
        data = json.loads(raw)
        score = max(0, min(100, round(float(data["score"]))))
        return {"score": score, "feedback": str(data.get("feedback", "")),
                "time_s": round(elapsed, 2)}
    except Exception as exc:
        return {"score": None, "feedback": str(exc)[:120],
                "time_s": round(time.time() - t0, 2)}


# ─── T2: Gemini 2.5 Flash (full video upload) ─────────────────────────────────
_gemini_ref_file = None   # cache so reference is uploaded only once

def t2_gemini(ref_path: str, test_path: str) -> Dict:
    """
    Uploads both videos to Gemini Files API and asks the model to compare
    the full temporal content — unique advantage over frame-based techniques.
    Falls back to frame-based if video upload fails.
    """
    global _gemini_ref_file
    if not GEMINI_OK:
        return {"score": None, "feedback": "google-generativeai not installed", "time_s": 0.0}

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)

    PROMPT = textwrap.dedent("""\
        You are comparing two AI-generated short videos for visual similarity.
        The FIRST video is the REFERENCE (original target).
        The SECOND video is the GENERATED VIDEO (attempt to recreate the reference).

        Score how closely the generated video matches the reference on:
        - Visual theme and subject matter
        - Color palette and lighting
        - Mood and atmosphere
        - Motion style and dynamics
        - Overall aesthetic similarity

        Scoring:
        90-100 = near-identical theme, style, and feel
        70-89  = strong match with minor differences
        50-69  = partial match, captures some elements
        0-49   = significantly different content or style

        Respond ONLY with valid JSON: {"score": <0-100>, "feedback": "<one concise sentence>"}
    """)

    t0 = time.time()
    try:
        # Upload reference video once and cache the file object
        if _gemini_ref_file is None:
            print("\n    [Gemini] Uploading reference video…", end=" ", flush=True)
            _gemini_ref_file = genai.upload_file(ref_path, mime_type="video/mp4")
            while _gemini_ref_file.state.name == "PROCESSING":
                time.sleep(2)
                _gemini_ref_file = genai.get_file(_gemini_ref_file.name)
            print("ready")

        # Upload test video
        test_file = genai.upload_file(test_path, mime_type="video/mp4")
        while test_file.state.name == "PROCESSING":
            time.sleep(2)
            test_file = genai.get_file(test_file.name)

        resp = model.generate_content(
            [PROMPT, _gemini_ref_file, test_file],
            generation_config={"temperature": 0.2, "max_output_tokens": 8192},
        )
        elapsed = time.time() - t0
        raw = (resp.text or "").strip().replace("```json", "").replace("```", "").strip()
        # Try full JSON parse; fall back to regex extraction for truncated responses
        try:
            data = json.loads(raw)
            score = max(0, min(100, round(float(data["score"]))))
            feedback = str(data.get("feedback", ""))
        except (json.JSONDecodeError, KeyError, ValueError):
            import re
            m = re.search(r'"score"\s*:\s*(\d+)', raw)
            score = max(0, min(100, int(m.group(1)))) if m else None
            feedback = raw[:80] if score is not None else f"parse error: {raw[:80]}"

        # Clean up test file immediately
        try:
            genai.delete_file(test_file.name)
        except Exception:
            pass

        return {"score": score, "feedback": feedback,
                "time_s": round(elapsed, 2)}

    except Exception as exc:
        # Fall back to frame-based comparison if video upload fails
        err_msg = str(exc)[:120]
        try:
            ref_frames  = extract_frames(ref_path)
            test_frames = extract_frames(test_path)
            ref_b64  = frames_to_b64_jpeg(ref_frames[:3])
            test_b64 = frames_to_b64_jpeg(test_frames[:3])

            def img_part(b64):
                return {"mime_type": "image/jpeg",
                        "data": base64.b64decode(b64)}

            resp = model.generate_content([
                "REFERENCE FRAMES:", *[genai.protos.Part(inline_data=genai.protos.Blob(
                    mime_type="image/jpeg", data=base64.b64decode(b))) for b in ref_b64],
                "TEST FRAMES:", *[genai.protos.Part(inline_data=genai.protos.Blob(
                    mime_type="image/jpeg", data=base64.b64decode(b))) for b in test_b64],
                ('Score similarity 0-100. JSON only: '
                 '{"score": <int>, "feedback": "<one sentence>"}'),
            ], generation_config=genai.GenerationConfig(temperature=0.2, max_output_tokens=200))
            elapsed = time.time() - t0
            raw = resp.text.strip().replace("```json","").replace("```","").strip()
            data = json.loads(raw)
            score = max(0, min(100, round(float(data["score"]))))
            return {"score": score,
                    "feedback": f"[frame fallback] {data.get('feedback','')}",
                    "time_s": round(elapsed, 2)}
        except Exception as exc2:
            return {"score": None,
                    "feedback": f"upload failed: {err_msg} | fallback failed: {str(exc2)[:60]}",
                    "time_s": round(time.time() - t0, 2)}


# ─── T3: CLIP Frame Embeddings ────────────────────────────────────────────────
_clip_model      = None
_clip_preprocess = None

def _load_clip():
    global _clip_model, _clip_preprocess
    if _clip_model is not None:
        return _clip_model, _clip_preprocess

    if CLIP_BACKEND == "open_clip":
        print("\n  [T3] Loading open_clip ViT-B-32 (openai weights)...", end=" ", flush=True)
        model, _, preprocess = open_clip.create_model_and_transforms(
            "ViT-B-32", pretrained="openai"
        )
        model.eval()
        _clip_model, _clip_preprocess = model, preprocess
        print("ready")

    else:  # resnet fallback
        print("\n  [T3] Loading torchvision ResNet-50 features...", end=" ", flush=True)
        base = _tv_models.resnet50(weights=_tv_models.ResNet50_Weights.IMAGENET1K_V1)
        model = torch.nn.Sequential(*list(base.children())[:-1])
        model.eval()
        preprocess = _tv_transforms.Compose([
            _tv_transforms.Resize(256),
            _tv_transforms.CenterCrop(224),
            _tv_transforms.ToTensor(),
            _tv_transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
        _clip_model, _clip_preprocess = model, preprocess
        print("ready")

    return _clip_model, _clip_preprocess


def _clip_video_embedding(frames: List[np.ndarray]) -> np.ndarray:
    model, preprocess = _load_clip()
    pil_imgs = [PILImage.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)) for f in frames]

    if CLIP_BACKEND == "open_clip":
        tensors = torch.stack([preprocess(img) for img in pil_imgs])
        with torch.no_grad():
            feats = model.encode_image(tensors)
        feats = feats / feats.norm(dim=-1, keepdim=True)
        return feats.mean(dim=0).numpy()
    else:  # resnet
        tensors = torch.stack([preprocess(img) for img in pil_imgs])
        with torch.no_grad():
            feats = model(tensors).squeeze(-1).squeeze(-1)
        feats = feats / (feats.norm(dim=-1, keepdim=True) + 1e-9)
        return feats.mean(dim=0).numpy()


def t3_clip(ref_frames: List[np.ndarray], test_frames: List[np.ndarray]) -> Dict:
    """
    Computes CLIP ViT-B/32 embeddings for all frames of each video,
    mean-pools them into a single video vector, then measures cosine similarity.
    No API cost after the one-time model download.
    """
    if not CLIP_OK:
        return {"score": None, "cosine_raw": None,
                "feedback": "transformers/torch not installed", "time_s": 0.0}
    t0 = time.time()
    try:
        ref_emb  = _clip_video_embedding(ref_frames)
        test_emb = _clip_video_embedding(test_frames)
        cos = float(np.dot(ref_emb, test_emb))

        # CLIP cosine for unrelated images ≈ 0.2-0.5, related ≈ 0.6-0.95
        # Scale [0.2, 0.98] → [0, 100] so scores are human-readable
        score = max(0, min(100, round((cos - 0.20) / 0.78 * 100)))

        return {"score": score, "cosine_raw": round(cos, 5),
                "feedback": f"cosine={cos:.4f}",
                "time_s": round(time.time() - t0, 2)}
    except Exception as exc:
        return {"score": None, "cosine_raw": None, "feedback": str(exc)[:120],
                "time_s": round(time.time() - t0, 2)}


# ─── T4: Perceptual Hash (pHash) ──────────────────────────────────────────────
def t4_phash(ref_frames: List[np.ndarray], test_frames: List[np.ndarray]) -> Dict:
    """
    Computes perceptual hash (DCT-based) for every frame, then computes the
    minimum Hamming distance between each reference frame and all test frames.
    No API, no model — extremely fast.
    """
    t0 = time.time()
    try:
        if PHASH_OK:
            def to_hashes(frames):
                return [imagehash.phash(
                    PILImage.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
                ) for f in frames]

            ref_hashes  = to_hashes(ref_frames)
            test_hashes = to_hashes(test_frames)
            HASH_BITS   = 64  # default pHash size

            sims = []
            for rh in ref_hashes:
                best = min(rh - th for th in test_hashes)   # lowest Hamming distance
                sims.append(1.0 - best / HASH_BITS)

            avg_sim = float(np.mean(sims))
            score   = max(0, min(100, round(avg_sim * 100)))
            detail  = f"avg_hamming_sim={avg_sim:.4f}"

        else:
            # Fallback: normalized cross-correlation on grayscale
            def to_gray_flat(f):
                return cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(float).flatten() / 255.0

            ref_vecs  = [to_gray_flat(f) for f in ref_frames]
            test_vecs = [to_gray_flat(f) for f in test_frames]
            nccs = []
            for rv in ref_vecs:
                for tv in test_vecs:
                    ncc = np.dot(rv, tv) / (np.linalg.norm(rv) * np.linalg.norm(tv) + 1e-9)
                    nccs.append(ncc)
            avg_sim = float(np.mean(nccs))
            score   = max(0, min(100, round(avg_sim * 100)))
            detail  = f"fallback_ncc={avg_sim:.4f}"

        return {"score": score, "feedback": detail,
                "time_s": round(time.time() - t0, 2)}
    except Exception as exc:
        return {"score": None, "feedback": str(exc)[:120],
                "time_s": round(time.time() - t0, 2)}


# ─── T5: CV Multi-metric ──────────────────────────────────────────────────────
def _color_hist_sim(f1: np.ndarray, f2: np.ndarray) -> float:
    """Bhattacharyya similarity on HSV histograms (8×8×8 bins)."""
    h1 = cv2.calcHist([cv2.cvtColor(f1, cv2.COLOR_BGR2HSV)], [0, 1, 2],
                      None, [8, 8, 8], [0, 180, 0, 256, 0, 256])
    h2 = cv2.calcHist([cv2.cvtColor(f2, cv2.COLOR_BGR2HSV)], [0, 1, 2],
                      None, [8, 8, 8], [0, 180, 0, 256, 0, 256])
    cv2.normalize(h1, h1)
    cv2.normalize(h2, h2)
    bhatt = cv2.compareHist(h1, h2, cv2.HISTCMP_BHATTACHARYYA)
    return float(max(0.0, 1.0 - bhatt))


def _ssim_or_ncc(f1: np.ndarray, f2: np.ndarray) -> float:
    g1 = cv2.cvtColor(f1, cv2.COLOR_BGR2GRAY)
    g2 = cv2.cvtColor(f2, cv2.COLOR_BGR2GRAY)
    if SSIM_OK:
        val, _ = ssim_fn(g1, g2, full=True)
        return float(max(0.0, val))
    # Normalized cross-correlation fallback
    a, b = g1.astype(float), g2.astype(float)
    return float(max(0.0, np.dot(a.flat, b.flat) /
                     (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9)))


def _temporal_profile_sim(ref_frames: List[np.ndarray],
                           test_frames: List[np.ndarray]) -> float:
    """
    Compares mean-color-per-frame trajectories.
    Captures whether the two videos have similar temporal color dynamics.
    """
    def profile(frames):
        arr = np.array([cv2.mean(f)[:3] for f in frames]) / 255.0  # (N, 3)
        return arr.flatten()

    r, t = profile(ref_frames), profile(test_frames)
    # Pad the shorter one to match length
    n = max(len(r), len(t))
    r = np.pad(r, (0, n - len(r)), mode="edge")
    t = np.pad(t, (0, n - len(t)), mode="edge")
    return float(max(0.0, np.dot(r, t) / (np.linalg.norm(r) * np.linalg.norm(t) + 1e-9)))


def _edge_density_sim(ref_frames: List[np.ndarray],
                      test_frames: List[np.ndarray]) -> float:
    """
    Compares scene complexity (edge density) — penalizes videos that are much
    busier or much simpler than the reference.
    """
    def density(frames):
        return float(np.mean([
            np.mean(cv2.Canny(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), 50, 150))
            for f in frames
        ]))

    rd, td = density(ref_frames), density(test_frames)
    return float(1.0 - abs(rd - td) / (max(rd, td, 1e-9)))


def t5_cv_multi(ref_frames: List[np.ndarray], test_frames: List[np.ndarray]) -> Dict:
    """
    Classical computer vision ensemble — no API, no model download.
    Weights: Color hist 30% · SSIM 35% · Temporal dynamics 20% · Edge density 15%
    """
    t0 = time.time()
    try:
        n        = min(len(ref_frames), len(test_frames))
        rf, tf   = ref_frames[:n], test_frames[:n]

        color    = float(np.mean([_color_hist_sim(r, t)  for r, t in zip(rf, tf)]))
        struct   = float(np.mean([_ssim_or_ncc(r, t)     for r, t in zip(rf, tf)]))
        temporal = _temporal_profile_sim(rf, tf)
        edge     = _edge_density_sim(rf, tf)

        composite = 0.30 * color + 0.35 * struct + 0.20 * temporal + 0.15 * edge
        score = max(0, min(100, round(composite * 100)))

        return {
            "score":    score,
            "color":    round(color    * 100, 1),
            "ssim":     round(struct   * 100, 1),
            "temporal": round(temporal * 100, 1),
            "edge":     round(edge     * 100, 1),
            "feedback": (f"color={color:.3f} ssim={struct:.3f} "
                         f"temporal={temporal:.3f} edge={edge:.3f}"),
            "time_s":   round(time.time() - t0, 2),
        }
    except Exception as exc:
        return {"score": None, "color": None, "ssim": None,
                "temporal": None, "edge": None, "feedback": str(exc)[:120],
                "time_s": round(time.time() - t0, 2)}


# ─── Benchmark Runner ─────────────────────────────────────────────────────────
def run_benchmark():
    print("\n" + "═" * 62)
    print("  VIDEO SIMILARITY BENCHMARK  — 5 Techniques")
    print("  Reference : Original.mp4")
    print("  Test set  : w1.mp4 … w8.mp4")
    print("═" * 62)

    print("\nExtracting reference frames…")
    ref_frames = extract_frames(REFERENCE_VIDEO)
    print(f"  → {len(ref_frames)} frames @ 384×216")

    if CLIP_OK:
        _load_clip()   # warm up model before timed runs

    rows = []

    for vid_name, vid_path in tqdm(TEST_VIDEOS.items(),
                                   desc="Benchmarking", ncols=68):
        print(f"\n{'─' * 50}")
        print(f"  ▶  {vid_name}.mp4")

        try:
            test_frames = extract_frames(vid_path)
        except Exception as exc:
            print(f"  ✗  Frame extraction failed: {exc}")
            rows.append({"video": vid_name})
            continue

        row = {"video": vid_name}

        # T1 — GPT Vision
        print("  [T1] GPT Vision       …", end=" ", flush=True)
        r1 = t1_gpt_vision(ref_frames, test_frames)
        row.update({"t1_score": r1["score"], "t1_time_s": r1["time_s"],
                    "t1_feedback": r1["feedback"]})
        print(f"score={r1['score']}  ({r1['time_s']}s)")

        # T2 — Gemini 2.5 Flash
        print("  [T2] Gemini 2.5 Flash …", end=" ", flush=True)
        r2 = t2_gemini(REFERENCE_VIDEO, vid_path)
        row.update({"t2_score": r2["score"], "t2_time_s": r2["time_s"],
                    "t2_feedback": r2["feedback"]})
        print(f"score={r2['score']}  ({r2['time_s']}s)")

        # T3 — CLIP Embeddings
        print("  [T3] CLIP Embeddings  …", end=" ", flush=True)
        r3 = t3_clip(ref_frames, test_frames)
        row.update({"t3_score": r3["score"], "t3_cosine": r3.get("cosine_raw"),
                    "t3_time_s": r3["time_s"]})
        print(f"score={r3['score']}  ({r3['time_s']}s)  cosine={r3.get('cosine_raw')}")

        # T4 — Perceptual Hash
        print("  [T4] pHash            …", end=" ", flush=True)
        r4 = t4_phash(ref_frames, test_frames)
        row.update({"t4_score": r4["score"], "t4_time_s": r4["time_s"]})
        print(f"score={r4['score']}  ({r4['time_s']}s)")

        # T5 — CV Multi-metric
        print("  [T5] CV Multi-metric  …", end=" ", flush=True)
        r5 = t5_cv_multi(ref_frames, test_frames)
        row.update({
            "t5_score": r5["score"], "t5_color": r5.get("color"),
            "t5_ssim": r5.get("ssim"), "t5_temporal": r5.get("temporal"),
            "t5_edge": r5.get("edge"), "t5_time_s": r5["time_s"],
        })
        print(f"score={r5['score']}  ({r5['time_s']}s)")

        rows.append(row)

    return rows


# ─── CSV Export ───────────────────────────────────────────────────────────────
SCORE_COLS = ["t1_score", "t2_score", "t3_score", "t4_score", "t5_score"]
TIME_COLS  = ["t1_time_s", "t2_time_s", "t3_time_s", "t4_time_s", "t5_time_s"]
TECH_LABELS = {
    "t1_score": ("T1 - GPT Vision",          "OpenAI gpt-4o-mini",         "frame-level vision LLM judge (existing prod)"),
    "t2_score": ("T2 - Gemini 2.5 Flash",    "google/gemini-2.5-flash",    "full-video multimodal scoring via Files API"),
    "t3_score": ("T3 - CLIP Embeddings",     "open_clip ViT-B-32 / ResNet-50", "cosine sim of visual frame embeddings (no API cost)"),
    "t4_score": ("T4 - Perceptual Hash",     "pHash (no model)",           "DCT-based perceptual hash Hamming distance"),
    "t5_score": ("T5 - CV Multi-metric",     "OpenCV (no model)",          "color hist 30% + SSIM 35% + temporal 20% + edge 15%"),
}


def _write_report(df: "pd.DataFrame"):
    """Human-readable summary. Plain ASCII only (no fancy dashes/arrows/boxes)
    so it renders identically in any editor or terminal."""
    lines = []
    lines.append("=" * 70)
    lines.append("  VIDEO SIMILARITY BENCHMARK RESULTS")
    lines.append(f"  Reference : Original.mp4   |   Test set : w1-w8.mp4   |   Frames : {NUM_FRAMES}")
    lines.append("=" * 70)
    lines.append("")
    lines.append("TECHNIQUE LEGEND")
    for col, (label, model, desc) in TECH_LABELS.items():
        lines.append(f"  {label:<24}  model={model:<32}  {desc}")
    lines.append("")

    lines.append("-" * 70)
    lines.append("SUMMARY STATISTICS")
    lines.append("-" * 70)
    lines.append(f"  {'Technique':<24}{'Min':>6}{'Max':>6}{'Mean':>7}{'Std':>7}{'AvgTime(s)':>12}")
    for col, (label, model, _) in TECH_LABELS.items():
        if col not in df.columns:
            continue
        vals = df[col].dropna()
        tcol = col.replace("_score", "_time_s")
        avg_time = df[tcol].mean() if tcol in df.columns else float("nan")
        if len(vals) == 0:
            lines.append(f"  {label:<24}{'n/a':>6}{'n/a':>6}{'n/a':>7}{'n/a':>7}{avg_time:>12.3f}    (no data)")
        else:
            std = vals.std() if len(vals) > 1 else 0.0
            lines.append(f"  {label:<24}{vals.min():>6.1f}{vals.max():>6.1f}"
                         f"{vals.mean():>7.1f}{std:>7.1f}{avg_time:>12.3f}")
    lines.append("")

    lines.append("-" * 70)
    lines.append("SPEED RANKING (fastest to slowest, avg per video)")
    lines.append("-" * 70)
    speed_map = {}
    for col, (label, _, _) in TECH_LABELS.items():
        tcol = col.replace("_score", "_time_s")
        if tcol in df.columns and df[tcol].notna().any():
            speed_map[label] = df[tcol].mean()
    for rank, (label, avg_t) in enumerate(sorted(speed_map.items(), key=lambda x: x[1]), 1):
        lines.append(f"  #{rank}  {label:<24}  {avg_t:.3f}s avg")
    lines.append("")

    lines.append("-" * 70)
    lines.append("ACCURACY PROXY - top-3 agreement with consensus")
    lines.append("-" * 70)
    top3_consensus = set(df.head(3)["video"].tolist())
    lines.append(f"  Consensus top-3 : {', '.join(sorted(top3_consensus))}")
    for col, (label, _, _) in TECH_LABELS.items():
        if col not in df.columns:
            continue
        valid_df = df[df[col].notna()]
        if len(valid_df) < 3:
            lines.append(f"  {label:<24}  top-3 overlap=N/A  (insufficient data)")
            continue
        top3_tech = set(valid_df.nlargest(3, col)["video"].tolist())
        overlap = len(top3_consensus & top3_tech)
        lines.append(f"  {label:<24}  top-3 overlap={overlap}/3  {sorted(top3_tech)}")
    lines.append("")

    lines.append("-" * 70)
    lines.append("PER-VIDEO BREAKDOWN")
    lines.append("-" * 70)
    lines.append(f"  {'Video':<8}{'GPT':>6}{'Gemini':>8}{'CLIP':>7}{'pHash':>7}{'CV':>6}{'Consensus':>11}{'Rank':>6}")
    lines.append("  " + "-" * 60)

    def cell(v):
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return "-"
        if isinstance(v, float):
            return str(int(v)) if v == int(v) else str(v)
        return str(v)

    for _, r in df.iterrows():
        lines.append(f"  {str(r['video']):<8}"
                     f"{cell(r.get('t1_score')):>6}"
                     f"{cell(r.get('t2_score')):>8}"
                     f"{cell(r.get('t3_score')):>7}"
                     f"{cell(r.get('t4_score')):>7}"
                     f"{cell(r.get('t5_score')):>6}"
                     f"{cell(r.get('consensus_score')):>11}"
                     f"{('#' + cell(r.get('consensus_rank'))):>6}")
    lines.append("")

    with open(OUTPUT_REPORT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def export_csv(rows: List[Dict]):
    df = pd.DataFrame(rows)

    # Consensus score = mean of available technique scores
    # Coerce all score columns to numeric so None/NaN don't cause rank() errors
    for col in SCORE_COLS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    available_score_cols = [c for c in SCORE_COLS if c in df.columns]
    df["consensus_score"] = df[available_score_cols].mean(axis=1, skipna=True).round(1)
    df["consensus_rank"]  = df["consensus_score"].rank(ascending=False, method="min").astype("Int64")

    # Per-technique rank (only where data exists)
    for col in SCORE_COLS:
        if col in df.columns:
            rank_col = col.replace("_score", "_rank")
            valid = df[col].notna()
            df[rank_col] = pd.NA
            if valid.any():
                df.loc[valid, rank_col] = (
                    df.loc[valid, col].rank(ascending=False, method="min").astype("Int64")
                )

    # Sort best → worst
    df = df.sort_values("consensus_score", ascending=False)

    # Column order
    ordered_cols = (
        ["video", "consensus_score", "consensus_rank"]
        + ["t1_score", "t1_rank", "t1_time_s", "t1_feedback"]
        + ["t2_score", "t2_rank", "t2_time_s", "t2_feedback"]
        + ["t3_score", "t3_rank", "t3_cosine",  "t3_time_s"]
        + ["t4_score", "t4_rank",               "t4_time_s"]
        + ["t5_score", "t5_rank", "t5_color", "t5_ssim", "t5_temporal", "t5_edge", "t5_time_s"]
    )
    df = df[[c for c in ordered_cols if c in df.columns]]

    # ── Write the CLEAN data CSV ──
    # Pure tabular data only (no decorative report), ASCII-safe, UTF-8 BOM so
    # Excel reads accented feedback text correctly instead of as mojibake.
    df.to_csv(OUTPUT_CSV, index=False, encoding="utf-8-sig")
    print(f"\n[OK] Saved data CSV -> {OUTPUT_CSV}")

    # ── Write the human-readable REPORT (separate .txt, keeps CSV clean) ──
    _write_report(df)

    print(f"[OK] Saved report   -> {OUTPUT_REPORT}")

    # ── Console summary ──
    print("\n" + "═" * 62)
    print("  RESULTS  (sorted by consensus, best first)")
    print("═" * 62)
    print(f"  {'Video':<8}  {'T1 GPT':>7}  {'T2 Gem':>7}  {'T3 CLIP':>8}  "
          f"{'T4 Hash':>8}  {'T5 CV':>6}  {'Avg':>6}  Rank")
    print("  " + "─" * 56)
    for _, r in df.iterrows():
        print(f"  {str(r['video']):<8}  "
              f"{str(r.get('t1_score','—')):>7}  "
              f"{str(r.get('t2_score','—')):>7}  "
              f"{str(r.get('t3_score','—')):>8}  "
              f"{str(r.get('t4_score','—')):>8}  "
              f"{str(r.get('t5_score','—')):>6}  "
              f"{str(r.get('consensus_score','—')):>6}  "
              f"#{r.get('consensus_rank','?')}")
    print("═" * 62)

    print("\nTIMINGS (avg per video):")
    for col, (label, _, _) in TECH_LABELS.items():
        tcol = col.replace("_score", "_time_s")
        if tcol in df.columns and df[tcol].notna().any():
            print(f"  {label:<28}  {df[tcol].mean():.3f}s")


# ─── Entry Point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Validate paths
    if not os.path.exists(REFERENCE_VIDEO):
        print(f"✗  Reference video not found: {REFERENCE_VIDEO}")
        sys.exit(1)

    missing = [n for n, p in TEST_VIDEOS.items() if not os.path.exists(p)]
    if missing:
        print(f"⚠  Missing test videos (will be skipped): {missing}")
        for m in missing:
            TEST_VIDEOS.pop(m, None)

    if not TEST_VIDEOS:
        print("✗  No test videos found in Video_test/")
        sys.exit(1)

    results = run_benchmark()
    export_csv(results)

    # Clean up cached Gemini reference upload
    if _gemini_ref_file is not None and GEMINI_OK:
        try:
            genai.configure(api_key=GEMINI_API_KEY)
            genai.delete_file(_gemini_ref_file.name)
            print("\n  [Gemini] Reference file deleted from Files API")
        except Exception:
            pass
