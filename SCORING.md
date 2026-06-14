# How Scoring Works — PromptBattle AI

This is the complete, plain-English reference for how a player's score is calculated,
from the moment they submit a prompt to where the number shows up on the leaderboard.

---

## The big picture

A player watches a reference video, guesses the prompt that made it, and submits.
We produce **four numbers**:

| Number | Range | What it measures |
|--------|-------|------------------|
| **Text similarity** | 0–100 | How close their prompt is to the original prompt |
| **Video similarity** | 0–100 | How close *their generated video* looks to the reference video |
| **Composite (final) score** | 0–100 | The blend of the two above — the "real" performance |
| **Normalized score** | 0–100 | The composite, adjusted for difficulty so it's fair to compare across easy/medium/hard. **Used only for ranking the leaderboard.** |

---

## 1. Text similarity (0–100)

- **Where:** `app/api/score/route.ts`
- The player's prompt is compared to the challenge's original prompt by an LLM
  (OpenAI, model from `OPENAI_MODEL`; falls back to Gemini, then a local mock if no
  API key is set).
- The model returns `{ score: 0–100, feedback }`.
- Guideline it follows: 90–100 = nearly identical meaning, 70–89 = strong overlap,
  40–69 = partial, 0–39 = different concept.

## 2. Video similarity (0–100)

- **Where:** `app/api/video-similarity/route.ts` + `lib/video-analysis.ts`
- After the player's prompt generates a video (via fal.ai), we:
  1. Extract 4 frames each from the **reference** video and the **player's** video
     (using ffmpeg).
  2. Send both sets of frames to a vision model (`OPENAI_MODEL`) which scores how
     closely they match on theme, subject, color, mood, and style → 0–100.
- This runs in the background after results appear; the video score fills in a moment
  later (the results screen shows "…" until it arrives).

## 3. Composite (final) score (0–100)

The two similarities are blended **50/50**:

```
composite = round(textScore × 0.5 + videoScore × 0.5)
```

- **Where:** `lib/rooms.ts` and `app/api/video-similarity/route.ts`
- If the video score never arrives (e.g. generation failed), the composite is just
  the text score.
- This is the number shown to the player on the results screen ("Final Score") and in
  the room standings.

---

## 4. Normalized score (0–100) — the fairness layer

**The problem it solves:** easy challenges are easier to score high on, hard
challenges are harder. If we ranked the leaderboard by raw composite, easy players
would unfairly beat hard players. Normalization fixes that.

**Where:** `lib/scoring.ts` → `computeNormalizedScore()`

### The formula

Each difficulty has an expected **average ("par")** score:

| Difficulty | Par average |
|------------|-------------|
| easy | 80 |
| medium | 70 |
| hard | 60 |

The normalized score rescales the composite so that the **hardest** difficulty tops
out at 100, and easier difficulties scale down proportionally:

```
normalized = round( clamp( composite × 60 / parAverage , 0, 100 ) )
```

(60 is the hard par — the smallest average — so hard maps 1:1 to 0–100. This is the
exact form of "divide the old 0–167 score by its max ~1.67".)

### What this produces

**Maximum possible score per difficulty:**

| Difficulty | A perfect run (composite 100) scores |
|------------|--------------------------------------|
| easy | **75** |
| medium | **86** |
| hard | **100** |

**Hitting "par" gives everyone the same score** (this is the fairness guarantee):

| Difficulty | Composite at par | Normalized |
|------------|------------------|------------|
| easy | 80 | **60** |
| medium | 70 | **60** |
| hard | 60 | **60** |

So:
- Two players who each perform *averagely for their difficulty* tie at 60 — fair.
- A flawless **easy** run (75) can **never** outrank a flawless **hard** run (100) —
  the injustice we wanted to prevent.
- Nothing ever exceeds 100.

### Worked examples

| Raw composite | easy | medium | hard |
|---------------|------|--------|------|
| 100 | 75 | 86 | 100 |
| 80 | 60 | 69 | 80 |
| 60 | 45 | 51 | 60 |
| 0 | 0 | 0 | 0 |

---

## Where each number is shown

| Screen | Shows |
|--------|-------|
| Player **results** screen | Text %, Video %, Final composite % (no normalized score) |
| **Room standings** (live) | Composite % |
| **Leaderboard** (`/leaderboard`) | **Normalized score** (the fair, cross-difficulty ranking) |
| **CSV export** (`/api/export`) | Everything: similarity, normalized, difficulty, time, etc. |

**Ranking / tie-break:** leaderboards sort by **normalized score (high → low)**, and
ties are broken by **time taken to prompt (fast → slow)**.

---

## Resetting scores (booth operator)

- **Reset Scores** (admin, per room): clears the current room's submissions.
- **Reset Global Leaderboard** (admin): clears the global leaderboard entirely.
  Use this before an event so no old/test scores remain.

Both live in the admin dashboard. The global reset calls
`DELETE /api/leaderboard` (admin-password protected).

---

## Tuning

All the knobs live in **`lib/scoring.ts`**:
- `LEVEL_AVERAGES` — the par averages per difficulty (easy 80 / medium 70 / hard 60).
  Changing these changes the difficulty ceilings automatically (the hardest level
  always tops out at 100).
- The 50/50 composite blend lives in `lib/rooms.ts` and
  `app/api/video-similarity/route.ts` (`textScore × 0.5 + videoScore × 0.5`).
