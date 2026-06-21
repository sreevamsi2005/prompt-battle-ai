# How Scoring Works — PromptBattle AI

Plain-English reference for how a player's score is calculated.

---

## The big picture

A player watches a reference video, guesses the prompt that made it, and submits.
We produce **three numbers**, but only the **final score** is shown and ranked:

| Number | Range | What it measures | Shown? |
|--------|-------|------------------|--------|
| Prompt (text) similarity | 0–100 | How close their prompt is to the original prompt | Used internally; surfaced only as a remark |
| Video similarity | 0–100 | How close *their generated video* looks to the reference | Used internally; surfaced only as a remark |
| **Final score** | 0–100 | **The blend of the two above — the single score** | ✅ everywhere |

There is **no difficulty normalization** and difficulty is **not** shown anywhere
(it's kept in the data export only, as a record).

---

## 1. Prompt (text) similarity — `app/api/score/route.ts`
An LLM compares the player's prompt to the challenge's original prompt and returns
`{ score: 0–100, feedback }`. The `feedback` becomes the "Prompt" remark on results.

## 2. Video similarity — `app/api/video-similarity/route.ts` + `lib/video-analysis.ts`
After the player's video generates (fal.ai), we extract 4 frames each from the
reference and the player's video and ask a vision model to score how closely they
match (theme, subject, color, mood, style) → `{ score: 0–100, feedback }`. The
`feedback` becomes the "Video" remark on results. This runs in the background, so
the final score updates a moment after results appear.

## 3. Final score (the only score shown) — `lib/scoring.ts` → `computeFinalScore`

```
finalScore = round(textScore * 0.5 + videoScore * 0.5)
```

- If no video was generated (e.g. solo prompt ≤70, or generation failed/skipped),
  the final score is just the text score.
- This single number is shown on the results screen and is the **ranking metric**
  on every leaderboard (ties broken by fastest prompt time).

### Evaluation details (results screen)
Instead of separate numbers, results show:
- the **final score** in one ring,
- a one-line **overall remark** (`evaluationRemark` in `lib/scoring.ts`), and
- an **Evaluation Details** box with a qualitative **Prompt** remark (text feedback)
  and **Video** remark (vision feedback).

---

## Where the final score is used

| Screen | Shows |
|--------|-------|
| Player **results** | Final score + Prompt/Video remarks (no separate numbers, no difficulty) |
| **Room standings** (live) | Final score |
| **Leaderboard** (`/leaderboard`) | Final score (ranks by it) |
| **CSV export** (`/api/export`) | similarityScore (text), finalScore, difficulty (record only), time, etc. |

**Ranking / tie-break:** leaderboards sort by **final score (high → low)**, ties by
**time taken to prompt (fast → slow)**.

---

## Multiplayer battle flow
- Players who join sit on a **"Waiting for Players"** screen.
- The battle starts (challenge video + 90s timer) **only when the room fills**, or
  when the **admin force-starts** it. A shared start timestamp keeps the 90s
  countdown synchronized across all players.

---

## Resetting scores (booth operator)
- **Reset Scores** (admin, per room): clears the current room's submissions.
- **Reset Global Leaderboard** (admin): clears the global leaderboard entirely.

---

## Tuning
- The 50/50 blend lives in `lib/scoring.ts` (`computeFinalScore`), `lib/rooms.ts`,
  and `app/api/video-similarity/route.ts`.
- Result remarks: `evaluationRemark` in `lib/scoring.ts`.
