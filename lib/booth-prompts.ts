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
    {
      id: "koi-pond",
      prompt:
        "A vibrant orange and white koi fish gliding slowly through a tranquil pond dotted with pink lotus flowers, clear rippling water, soft natural daylight, serene close-up",
      difficulty: "easy",
      theme: "Zen & Calm",
    },
    {
      id: "hot-air-balloons",
      prompt:
        "Dozens of colorful hot air balloons drifting over rolling green hills at sunrise, soft morning mist, warm pastel sky, gentle sweeping aerial wide shot",
      difficulty: "easy",
      theme: "Sky & Color",
    },
    {
      id: "rainforest-waterfall",
      prompt:
        "A powerful waterfall cascading into a misty turquoise pool deep in a lush tropical rainforest, sun rays piercing through the dense canopy, vibrant green foliage, cinematic",
      difficulty: "medium",
      theme: "Lush Wild",
    },
    {
      id: "vintage-train",
      prompt:
        "A vintage steam locomotive winding through snowy mountain valleys, billowing white steam, warm golden afternoon light glinting off the metal, nostalgic cinematic wide shot",
      difficulty: "medium",
      theme: "Retro Journey",
    },
    {
      id: "underwater-city",
      prompt:
        "A lone diver exploring the ruins of a bioluminescent sunken city deep underwater, glowing blue coral overtaking ancient stone towers, shafts of light from the surface, eerie atmospheric",
      difficulty: "hard",
      theme: "Sunken Future",
    },
    {
      id: "desert-sandstorm",
      prompt:
        "A massive towering sandstorm wall engulfing an abandoned desert town at dusk, swirling ochre dust, dramatic backlight, intense apocalyptic cinematic scale",
      difficulty: "hard",
      theme: "Storm & Sand",
    },
  ];
}
