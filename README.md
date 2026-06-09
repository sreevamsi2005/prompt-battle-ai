# PromptBattle AI

A premium **GenAI summit booth** experience built with Next.js. Watch a cinematic AI-generated video, guess the hidden prompt, get an AI similarity score, and see a pre-rendered “recreation” clip based on how close you were.

## Tech Stack

- **Next.js 15+** App Router
- **TypeScript** + **Tailwind CSS v4**
- **Framer Motion** animations
- **Local JSON** challenges (`data/challenges.json`)
- **Local MP4** videos (`public/videos/`)
- **localStorage** leaderboard
- **OpenAI** or **Gemini** API for semantic scoring only (optional)

No backend database, auth, live video generation, or cloud storage.

## Quick Start

```bash
cd prompt-battle-ai
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### AI Scoring (Optional)

Copy `.env.example` to `.env.local` and add one provider:

```bash
OPENAI_API_KEY=sk-...
```

Or:

```bash
GEMINI_API_KEY=...
```

Without an API key, the app uses a **local mock scorer** so the booth works offline.

## Booth Flow

1. **Home** → “Start Challenge”
2. **Play** → Watch looping challenge video → enter prompt guess
3. **Analyzing** → 2–3s cinematic loader
4. **Results** → Score (0–100), AI feedback, recreation video tier
5. **Leaderboard** → Top scores (localStorage + seed data)

## Project Structure

```
app/
  page.tsx              # Homepage
  play/page.tsx         # Game
  leaderboard/page.tsx
  api/score/route.ts    # OpenAI/Gemini scoring
components/
  VideoPlayer.tsx
  PromptInput.tsx
  ScoreCard.tsx
  Loader.tsx
  Leaderboard.tsx
  Navbar.tsx
data/
  challenges.json
public/videos/          # Your MP4 assets
lib/
  challenges.ts
  leaderboard.ts
  mock-score.ts
  types.ts
```

## Videos for Production

Replace placeholder files in `public/videos/` with your real booth assets:

| File | Purpose |
|------|---------|
| `samurai.mp4` | Challenge 1 |
| `cyberpunk.mp4` | Challenge 2 |
| `ocean.mp4` | Challenge 3 |
| `recreation-low.mp4` | Score &lt; 40 |
| `recreation-medium.mp4` | Score 40–75 |
| `recreation-high.mp4` | Score &gt; 75 |

Update paths and hidden prompts in `data/challenges.json`.

## Recreation Video Logic

Pre-generated clips only (no live generation):

- **&lt; 40** → `recreation-low.mp4`
- **40–75** → `recreation-medium.mp4`
- **&gt; 75** → `recreation-high.mp4`

## Leaderboard

Stored in browser `localStorage` under `promptbattle-leaderboard`:

- `playerName`, `score`, `timestamp`
- Sorted descending by score
- Player name saved as `promptbattle-player-name`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Run production build |

## Summit Booth Tips

- Run fullscreen (F11) on a large display
- Set a default player name in the play screen before guests arrive
- Pre-load the tab on `/play` for instant starts
- Use real cinematic MP4s for maximum impact
- Add `OPENAI_API_KEY` for best scoring quality

## License

MIT — built for lightweight GenAI booth demos.
