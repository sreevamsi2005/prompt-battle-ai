import fs from "fs";
import path from "path";

export interface BoothPrompt {
  id: string;
  prompt: string;
  difficulty: "easy" | "medium" | "hard";
  theme: string;
}

const PROMPTS_FILE = path.join(process.cwd(), "data", "prompts.json");
let cachedPrompts: BoothPrompt[] | null = null;

export function loadPromptsFromFile(): BoothPrompt[] {
  try {
    if (fs.existsSync(PROMPTS_FILE)) {
      const raw = fs.readFileSync(PROMPTS_FILE, "utf-8");
      cachedPrompts = JSON.parse(raw) as BoothPrompt[];
      return cachedPrompts;
    }
  } catch (err) {
    console.error("Error loading prompts:", err);
  }
  return getDefaultPrompts();
}

export function getPromptsCache(): BoothPrompt[] {
  if (cachedPrompts === null) {
    cachedPrompts = loadPromptsFromFile();
  }
  return cachedPrompts;
}

export function getPromptById(id: string): BoothPrompt | undefined {
  return getPromptsCache().find((p) => p.id === id);
}

export function getRandomPrompt(): BoothPrompt {
  const prompts = getPromptsCache();
  return prompts[Math.floor(Math.random() * prompts.length)];
}

export function getAllPrompts(): BoothPrompt[] {
  return getPromptsCache();
}

function getDefaultPrompts(): BoothPrompt[] {
  return [
    {
      id: "golden-field",
      prompt:
        "A golden retriever puppy bounding through a vast field of sunflowers in slow motion, warm golden-hour light, shallow depth of field, cinematic",
      difficulty: "easy",
      theme: "Nature & Warmth",
    },
    {
      id: "neon-samurai",
      prompt:
        "A lone samurai in traditional armor walking through neon-lit Tokyo streets in heavy rain at night, reflections shimmering on wet pavement, epic cinematic wide shot",
      difficulty: "medium",
      theme: "Cyberpunk East",
    },
    {
      id: "space-station",
      prompt:
        "An astronaut floating weightlessly inside a sleek space station, Earth glowing blue through a panoramic window, soft zero-gravity hair, documentary IMAX style",
      difficulty: "medium",
      theme: "Space & Wonder",
    },
    {
      id: "volcanic-beach",
      prompt:
        "Aerial drone shot at golden hour over a black sand volcanic beach, massive waves crashing, steam rising where lava meets the ocean, dramatic sky",
      difficulty: "hard",
      theme: "Fire & Ocean",
    },
    {
      id: "cyberpunk-hacker",
      prompt:
        "A hooded hacker in a rain-drenched neon cyberpunk alley at night, holographic advertisements flickering on wet walls, Blade Runner aesthetic, moody cinematic lighting",
      difficulty: "hard",
      theme: "Tech Dystopia",
    },
    {
      id: "aurora-wolf",
      prompt:
        "A lone white wolf standing on a snow-covered mountain ridge howling at the Northern Lights, ultra-wide angle, breathtaking aurora borealis in vivid green and purple",
      difficulty: "medium",
      theme: "Wild North",
    },
  ];
}
