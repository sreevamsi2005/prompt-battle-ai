import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { isAdminPasswordValid } from "@/lib/admin-auth";
import type { BoothPrompt } from "@/lib/booth-prompts";

const PROMPTS_FILE = path.join(process.cwd(), "data", "prompts.json");

function ensureDir() {
  const dir = path.dirname(PROMPTS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function checkAuth(req: NextRequest): boolean {
  const password = req.headers.get("x-admin-password");
  return password ? isAdminPasswordValid(password) : false;
}

// GET /api/admin/prompts - list prompts
export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    ensureDir();
    if (fs.existsSync(PROMPTS_FILE)) {
      const raw = fs.readFileSync(PROMPTS_FILE, "utf-8");
      const prompts = JSON.parse(raw) as BoothPrompt[];
      return NextResponse.json(prompts);
    }
    return NextResponse.json([]);
  } catch (err) {
    console.error("Error loading prompts:", err);
    return NextResponse.json({ error: "Failed to load prompts" }, { status: 500 });
  }
}

// POST /api/admin/prompts - add prompt
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, prompt, difficulty, theme } = body as Partial<BoothPrompt>;

    if (!id?.trim() || !prompt?.trim() || !difficulty || !theme?.trim()) {
      return NextResponse.json(
        { error: "All fields required" },
        { status: 400 }
      );
    }

    ensureDir();
    let prompts: BoothPrompt[] = [];
    if (fs.existsSync(PROMPTS_FILE)) {
      const raw = fs.readFileSync(PROMPTS_FILE, "utf-8");
      prompts = JSON.parse(raw);
    }

    // Check for duplicate ID
    if (prompts.some((p) => p.id === id)) {
      return NextResponse.json(
        { error: "Prompt ID already exists" },
        { status: 400 }
      );
    }

    prompts.push({
      id: id.trim(),
      prompt: prompt.trim(),
      difficulty: difficulty as "easy" | "medium" | "hard",
      theme: theme.trim(),
    });

    fs.writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2), "utf-8");
    return NextResponse.json(prompts);
  } catch (err) {
    console.error("Error adding prompt:", err);
    return NextResponse.json({ error: "Failed to add prompt" }, { status: 500 });
  }
}

// PUT /api/admin/prompts/:id - update prompt
export async function PUT(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const body = await req.json();
    const { prompt, difficulty, theme } = body as Partial<BoothPrompt>;

    ensureDir();
    let prompts: BoothPrompt[] = [];
    if (fs.existsSync(PROMPTS_FILE)) {
      const raw = fs.readFileSync(PROMPTS_FILE, "utf-8");
      prompts = JSON.parse(raw);
    }

    const idx = prompts.findIndex((p) => p.id === id);
    if (idx === -1) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    if (prompt?.trim()) prompts[idx].prompt = prompt.trim();
    if (difficulty) prompts[idx].difficulty = difficulty as "easy" | "medium" | "hard";
    if (theme?.trim()) prompts[idx].theme = theme.trim();

    fs.writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2), "utf-8");
    return NextResponse.json(prompts);
  } catch (err) {
    console.error("Error updating prompt:", err);
    return NextResponse.json({ error: "Failed to update prompt" }, { status: 500 });
  }
}

// DELETE /api/admin/prompts/:id - delete prompt
export async function DELETE(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    ensureDir();
    let prompts: BoothPrompt[] = [];
    if (fs.existsSync(PROMPTS_FILE)) {
      const raw = fs.readFileSync(PROMPTS_FILE, "utf-8");
      prompts = JSON.parse(raw);
    }

    prompts = prompts.filter((p) => p.id !== id);
    fs.writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2), "utf-8");
    return NextResponse.json(prompts);
  } catch (err) {
    console.error("Error deleting prompt:", err);
    return NextResponse.json({ error: "Failed to delete prompt" }, { status: 500 });
  }
}
