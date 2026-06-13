import { blobGet, blobSet, blobUpdate } from "./blob-storage";
import { computeNormalizedScore } from "./scoring";

export interface ActivePlayer {
  playerName: string;
  lastSeen: number;
}

export interface Room {
  id: string;
  name: string;
  maxUsers: number;
  activeChallengeId: string | null;
  createdAt: number;
  players: ActivePlayer[];
}

export interface RoomSubmission {
  playerName: string;
  score: number;            // text similarity 0-100
  normalizedScore: number;  // (compositeScore / level_average) * 100, recalculated when video arrives
  timeTakenToPrompt: number; // seconds
  difficulty: "easy" | "medium" | "hard";
  videoScore?: number;
  compositeScore?: number;  // text*0.5 + video*0.5
  timestamp: number;
  roomId: string;
  email?: string;
  prompt?: string;
  videoUrl?: string;
  videoAnalysisStatus?: "pending" | "completed" | "failed";
  videoAnalysisError?: string;
}

export interface ReplayRequest {
  roomId: string;
  playerName: string;
  timestamp: number;
}

function sortSubmissions(subs: RoomSubmission[]): RoomSubmission[] {
  return [...subs].sort((a, b) => {
    if (b.normalizedScore !== a.normalizedScore) return b.normalizedScore - a.normalizedScore;
    return a.timeTakenToPrompt - b.timeTakenToPrompt;
  });
}

function cleanupInactivePlayers(room: Room): Room {
  const now = Date.now();
  return { ...room, players: (room.players ?? []).filter(p => now - p.lastSeen < 15000) };
}

export async function loadRooms(): Promise<Room[]> {
  const rooms = await blobGet<Room[]>("rooms", "rooms", []);
  const cleaned = rooms.map(cleanupInactivePlayers);

  // Always ensure at least one room exists
  if (cleaned.length === 0) {
    const defaultRoom: Room = {
      id: "main-room",
      name: "Battle Room",
      maxUsers: 4,
      activeChallengeId: null,
      createdAt: Date.now(),
      players: [],
    };
    await saveRooms([defaultRoom]);
    return [defaultRoom];
  }

  const changed = rooms.some((r, i) => (r.players?.length ?? 0) !== (cleaned[i].players?.length ?? 0));
  if (changed) await saveRooms(cleaned);
  return cleaned;
}

export async function saveRooms(rooms: Room[]): Promise<void> {
  await blobSet("rooms", "rooms", rooms);
}

export async function updateRoomChallenge(roomId: string, challengeId: string | null): Promise<Room | undefined> {
  const rooms = await loadRooms();
  const room = rooms.find(r => r.id === roomId);
  if (room) {
    room.activeChallengeId = challengeId;
    await saveRooms(rooms);
  }
  return room;
}

export async function updateRoomMaxUsers(roomId: string, maxUsers: number): Promise<Room | undefined> {
  const rooms = await loadRooms();
  const room = rooms.find(r => r.id === roomId);
  if (room) {
    room.maxUsers = Math.max(1, Math.min(20, maxUsers));
    await saveRooms(rooms);
  }
  return room;
}

export async function registerPlayerHeartbeat(roomId: string, playerName: string): Promise<Room | undefined> {
  const rooms = await loadRooms();
  const room = rooms.find(r => r.id === roomId);
  if (!room) return undefined;
  room.players = room.players ?? [];
  const now = Date.now();
  const name = playerName.trim();
  const idx = room.players.findIndex(p => p.playerName.toLowerCase() === name.toLowerCase());
  if (idx !== -1) {
    room.players[idx].lastSeen = now;
    room.players[idx].playerName = name;
  } else if (room.players.length < room.maxUsers) {
    room.players.push({ playerName: name, lastSeen: now });
  } else {
    return undefined;
  }
  await saveRooms(rooms);
  return room;
}

export async function loadRoomSubmissions(roomId?: string): Promise<RoomSubmission[]> {
  const all = await blobGet<RoomSubmission[]>("rooms", "submissions", []);
  return roomId ? all.filter(s => s.roomId === roomId) : all;
}

export async function addRoomSubmission(
  roomId: string,
  playerName: string,
  score: number,
  normalizedScore: number,
  timeTakenToPrompt: number,
  difficulty: "easy" | "medium" | "hard",
  timestamp?: number,
  prompt?: string,
  email?: string
): Promise<RoomSubmission[]> {
  const name = playerName.trim() || "Anonymous";
  const ts = timestamp ?? Date.now();
  const all = await blobUpdate<RoomSubmission[]>("rooms", "submissions", [], (cur) => {
    const rest = cur.filter(s => !(s.roomId === roomId && s.playerName.toLowerCase() === name.toLowerCase()));
    rest.push({
      roomId,
      playerName: name,
      score,
      normalizedScore,
      timeTakenToPrompt,
      difficulty,
      timestamp: ts,
      ...(prompt ? { prompt } : {}),
      ...(email ? { email } : {}),
    });
    return rest;
  });
  return sortSubmissions(all.filter(s => s.roomId === roomId));
}

export async function clearRoomSubmissions(roomId: string): Promise<void> {
  await blobUpdate<RoomSubmission[]>("rooms", "submissions", [], (cur) =>
    cur.filter(s => s.roomId !== roomId)
  );
}

export async function updateRoomSubmissionWithVideoScore(
  roomId: string,
  playerName: string,
  videoScore: number,
  textScore: number
): Promise<RoomSubmission | null> {
  const compositeScore = Math.round(textScore * 0.5 + videoScore * 0.5);
  const name = playerName.trim();
  const updated = await blobUpdate<RoomSubmission[]>("rooms", "submissions", [], (current) => {
    const submission = current.find(
      s => s.roomId === roomId && s.playerName.toLowerCase() === name.toLowerCase()
    );
    if (submission) {
      submission.videoScore = videoScore;
      submission.compositeScore = compositeScore;
      submission.normalizedScore = computeNormalizedScore(compositeScore, submission.difficulty ?? "medium");
      submission.videoAnalysisStatus = "completed";
    }
    return current;
  });
  return updated.find(s => s.roomId === roomId && s.playerName.toLowerCase() === name.toLowerCase()) || null;
}

/* ── Replay / "next challenge" requests raised by players ───────────────── */

export async function loadReplayRequests(roomId?: string): Promise<ReplayRequest[]> {
  const all = await blobGet<ReplayRequest[]>("rooms", "replay-requests", []);
  return roomId ? all.filter(r => r.roomId === roomId) : all;
}

export async function addReplayRequest(roomId: string, playerName: string): Promise<void> {
  const name = playerName.trim() || "Anonymous";
  await blobUpdate<ReplayRequest[]>("rooms", "replay-requests", [], (cur) => {
    const rest = cur.filter(r => !(r.roomId === roomId && r.playerName.toLowerCase() === name.toLowerCase()));
    rest.push({ roomId, playerName: name, timestamp: Date.now() });
    return rest;
  });
}

export async function clearReplayRequests(roomId: string): Promise<void> {
  await blobUpdate<ReplayRequest[]>("rooms", "replay-requests", [], (cur) =>
    cur.filter(r => r.roomId !== roomId)
  );
}
