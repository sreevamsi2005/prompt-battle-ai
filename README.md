# PromptBattle AI

A live **GenAI summit booth game** built with Next.js. Players watch a short cinematic reference video, race to write the prompt that would generate it, and a real AI video model renders their guess. Scores blend prompt-similarity and video-similarity into one final number, with live synced multiplayer rounds, a real-time podium, and a full admin control panel for running the booth.

## Tech Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4**
- **Framer Motion** for the game's animations (timers, podium, confetti, transitions)
- **fal.ai** (`fal-ai/vidu/q3/text-to-video/turbo`) — turns a player's prompt into a real video
- **OpenAI (GPT-4o-mini)** or **Google Gemini** — scores prompt-to-prompt semantic similarity
- **Google `gemini-embedding-2`** — scores generated-video-to-reference-video visual similarity (full-video embedding, with an automatic 16-frame fallback if it's slow)
- **`@ffmpeg-installer/ffmpeg`** — frame extraction for the video-similarity fallback path
- **Netlify Blobs** — persistence in production (rooms, submissions, leaderboard, event logs), with a local-JSON fallback for `npm run dev` so the whole game works offline

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Without any API keys configured, prompt scoring falls back to a local mock scorer and video generation is skipped — the game flow still works end-to-end for local UI development.

## Environment Variables

Copy `.env.example` to `.env.local` and fill in what you have:

| Variable | Required for | Notes |
|---|---|---|
| `FAL_KEY` | Video generation | Get one at [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys). Without it, video generation is skipped and scoring is text-only. |
| `OPENAI_API_KEY` | Prompt scoring (primary) + voice input | Also powers Whisper transcription for the mic-input feature. |
| `OPENAI_MODEL` | — | Optional override, defaults to `gpt-4o-mini`. |
| `GEMINI_API_KEY` | Prompt scoring (fallback) + video similarity | Required for video-similarity scoring (`gemini-embedding-2`). Free tier at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). |
| `ADMIN_PASSWORD` | Admin panel (`/admin`, `/admin/logs`) | Defaults to `booth2024` if unset — **change this before running a real event.** |
| `NETLIFY_BLOBS_CONTEXT` | — | Auto-injected by Netlify at runtime; its presence switches persistence from local JSON files to Netlify Blobs. Don't set this manually. |

If neither `OPENAI_API_KEY` nor `GEMINI_API_KEY` is set, prompt scoring falls back to a local Jaccard-similarity mock scorer, so the booth keeps working even if a key expires mid-event.

## Booth Flow (multiplayer)

1. **Lobby** — a player enters their name/email and joins the room's next open slot.
2. **Waiting** — once the admin sets a challenge and starts the battle (or the room fills), every connected player's 60-second countdown starts from the *same* shared timestamp, so all clocks stay in sync. A player who joins a few seconds late still gets their own fresh 60s rather than an already-expired timer.
3. **Playing** — the reference video loops on one side; the player writes (or speaks) the prompt they think generated it.
4. **Submit** → the prompt is scored for semantic similarity immediately (so admin standings show "submitted" right away), then queued to fal.ai for video generation. The player is dropped straight into **Results** the moment their video finishes rendering — they don't wait for scoring to see their video.
5. **Results** — the player's own score fills in as it resolves. In multiplayer, the **standings panel stays in a waiting state until every present player's final score has resolved** (never shows a premature "leader" that then flips as others finish), then reveals a 3D podium with the top 3, a full ranked list, and a confetti burst for whoever's in first. A side-by-side reference/generated video comparison and prompt+video feedback follow below.

Final score = **30% prompt similarity + 70% video similarity** (see [SCORING.md](SCORING.md) for the exact formulas and calibration). Scores publish to the room's live standings immediately and to the global leaderboard once resolved.

## Admin Panel

Password-gated at `/admin` (`x-admin-password` header, checked against `ADMIN_PASSWORD`):

- Set or randomize the active challenge from a **Challenge Video Library** — an autoplaying grid of all reference videos, click to go live
- Force-start a battle, reset the current session (returns everyone to the lobby), or reset just the scores
- Adjust the room's max player count
- Live **Round Standings** with a browsable per-player score breakdown (prompt used, text/video/final scores)
- Handle "play again" requests from players
- Reset the global leaderboard
- Export the full session data sheet as CSV (`/api/export`)

A separate **`/admin/logs`** view shows a structured, filterable event log of every scoring call, video-generation job, and error across the whole booth session — useful for diagnosing a flaky run after the fact. See "Event Logging" below.

## Project Structure

```
app/
  page.tsx                    # Landing page
  play/page.tsx                # The game itself (lobby → waiting → playing → generating → results)
  leaderboard/page.tsx         # Public global leaderboard
  admin/page.tsx                # Admin dashboard
  admin/logs/page.tsx           # Admin event-log viewer
  api/
    challenge/                  # Random challenge (solo/legacy path)
    score/                      # LLM prompt-similarity scoring
    transcribe/                 # Whisper voice-to-text
    generate-prompt/            # Queue a fal.ai video generation job
    generate-poll/              # Poll a queued fal.ai job for completion
    video-similarity/           # Gemini embedding video-similarity scoring
    leaderboard/                # Room + global leaderboard reads/writes
    export/                     # Full data-sheet CSV export
    rooms/                      # Room listing
    rooms/heartbeat/            # Join/keepalive + full synced room state
    rooms/replay-request/       # "Play again" request
    admin/rooms/                # Room control (password-gated)
    admin/prompts/               # Challenge CRUD (password-gated)
    admin/logs/                  # Event log read/export/clear (password-gated)
components/
  Navbar.tsx                    # Top nav (used in app/layout.tsx)
  Leaderboard.tsx                # Leaderboard table (used in app/leaderboard/page.tsx)
lib/
  rooms.ts                     # Room/player/submission model, battle sync, ranking
  scoring.ts                   # Final-score formula (30% text + 70% video)
  video-analysis.ts             # Gemini video-embedding similarity (+ frame-sampling fallback)
  booth-prompts.ts              # Challenge prompt loading
  server-leaderboard.ts         # Global leaderboard persistence/ranking
  blob-storage.ts               # Netlify Blobs (prod) / local JSON (dev) storage abstraction
  event-log.ts                  # Structured event logging for the admin logs viewer
  csv-export.ts                 # Data-sheet CSV building
  download-video.ts             # Caches fal.ai-generated videos locally
  video-cache.ts                # Generated-video cache bookkeeping
  admin-auth.ts                 # Admin password check
  mock-score.ts                 # Offline fallback scorer
  error-stage.ts                # Human-readable API error labels
  types.ts                      # Shared TypeScript types
data/
  prompts.json                 # Challenge library (id, prompt, difficulty, theme)
  *.json                       # Local-dev persistence (rooms, submissions, leaderboard, logs) — gitignored, mirrors Netlify Blobs in prod
public/
  videos/                      # Reference challenge videos + cached generated player videos
  animations/                  # Custom SVG loading animations used in the game UI
```

## Data Persistence

Everything (rooms, submissions, the global leaderboard, and the event log) is stored via `lib/blob-storage.ts`:

- **In production (Netlify)**: [Netlify Blobs](https://docs.netlify.com/blobs/overview/) — no database to provision.
- **In local dev**: plain JSON files under `data/` (gitignored), so the game works fully offline without any cloud dependency.

Writes that could race (e.g. two players submitting at the same instant) go through an optimistic-concurrency helper (`blobUpdate`) that retries on conflict, so simultaneous submissions never clobber each other.

## Event Logging

Every scoring call, video-generation job (queued → completed/failed, with duration), and video-similarity check is recorded as a structured event — visible, filterable, and exportable from `/admin/logs`. This is the first place to look if a booth run had errors or slow video generations.

## Scoring

See [SCORING.md](SCORING.md) for the full breakdown of how prompt similarity and video similarity are each computed and blended into the final score.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run lint` | Lint the codebase |

## Deployment

Deployed via Netlify (`netlify.toml`: `npm run build`, publish `.next`, Node 20). Set `FAL_KEY`, `OPENAI_API_KEY` and/or `GEMINI_API_KEY`, and a strong `ADMIN_PASSWORD` in the Netlify site's environment variables before going live — `NETLIFY_BLOBS_CONTEXT` is injected automatically and should not be set manually.

## Summit Booth Tips

- Run fullscreen on the booth display and pre-load `/play` before guests arrive
- Set `ADMIN_PASSWORD` to something other than the default before a real event
- Keep `/admin` open on a second screen to manage challenges and watch standings live
- If a video generation stalls or fails, the game still finalizes the player's score from text similarity alone — no one gets stuck
- Check `/admin/logs` after the event (or mid-event) to see exactly what happened, and how long each step took

## License

MIT — built for GenAI summit booth demos.
