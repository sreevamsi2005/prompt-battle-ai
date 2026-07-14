import { blobGet, blobUpdate } from "./blob-storage";
import { computeFinalScore } from "./scoring";

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
  // null while players are still gathering ("Waiting for players"); set to a
  // timestamp when the battle starts (auto when full, or admin force-start).
  // The shared timestamp also synchronizes the countdown across all players.
  battleStartedAt: number | null;
  // Bumped to Date.now() when the admin resets the session. Connected /play
  // clients compare it against the value they saw when joining and, when it
  // increases, return to the lobby (general /play join screen).
  resetAt?: number | null;
}

export interface RoomSubmission {
  playerName: string;
  score: number;            // text/prompt similarity 0-100
  timeTakenToPrompt: number; // seconds
  difficulty: "easy" | "medium" | "hard";  // kept for records only (not scored)
  videoScore?: number;      // visual similarity 0-100 (once analyzed)
  compositeScore?: number;  // FINAL score — see computeFinalScore() in lib/scoring.ts (null until video arrives)
  timestamp: number;
  roomId: string;
  email?: string;
  prompt?: string;
  videoUrl?: string;
  videoAnalysisStatus?: "pending" | "completed" | "failed";
  videoAnalysisError?: string;
  autoSubmitted?: boolean;  // true when the 90s timer auto-submitted the prompt
}

export interface ReplayRequest {
  roomId: string;
  playerName: string;
  timestamp: number;
}

// Rank by the final score (composite text+video; text-only until video arrives),
// breaking ties by who prompted fastest.
function finalOf(s: RoomSubmission): number {
  return s.compositeScore ?? s.score;
}
function sortSubmissions(subs: RoomSubmission[]): RoomSubmission[] {
  return [...subs].sort((a, b) => {
    if (finalOf(b) !== finalOf(a)) return finalOf(b) - finalOf(a);
    return a.timeTakenToPrompt - b.timeTakenToPrompt;
  });
}

function cleanupInactivePlayers(room: Room): Room {
  const now = Date.now();
  const players = (room.players ?? []).filter(p => now - p.lastSeen < 15000);
  // When the room empties, end the battle so the next gathering starts fresh
  // (waiting for players) instead of inheriting a stale "started" timestamp.
  const battleStartedAt = players.length === 0 ? null : room.battleStartedAt;
  return { ...room, players, battleStartedAt };
}

const DEFAULT_ROOM: Omit<Room, "createdAt"> = {
  id: "main-room",
  name: "Battle Room",
  maxUsers: 4,
  activeChallengeId: null,
  players: [],
  battleStartedAt: null,
};

// Every room mutation goes through here so writes to the shared "rooms" blob are
// serialized with optimistic concurrency (etag compare-and-set + retry) — exactly
// like room submissions already are. Plain blobGet + blobSet (read-modify-write
// with NO etag) was the production bug: with many players heartbeating every 3s
// across concurrent serverless instances, updates clobbered each other and a stale
// read briefly resurrected an empty player list, which flipped battleStartedAt
// between null and its real value. The /play client keys each round on
// `activeChallengeId:battleStartedAt`, so that flip wiped state and bounced players
// back to a fresh challenge mid-round (worst during the long post-submit
// generating/results window). Cleanup runs INSIDE the transaction against the
// latest value, so it can't act on a stale snapshot. Extra retries because a busy
// booth can put a dozen concurrent writers on this one key.
async function mutateRooms(mutate: (rooms: Room[]) => void): Promise<Room[]> {
  return blobUpdate<Room[]>(
    "rooms",
    "rooms",
    [],
    (cur) => {
      let rooms = (cur ?? []).map(cleanupInactivePlayers);
      if (rooms.length === 0) rooms = [{ ...DEFAULT_ROOM, createdAt: Date.now() }];
      mutate(rooms);
      return rooms;
    },
    12
  );
}

export async function loadRooms(): Promise<Room[]> {
  const rooms = await blobGet<Room[]>("rooms", "rooms", []);
  // Seed the default room once, atomically, if none exists yet.
  if (rooms.length === 0) return mutateRooms(() => {});
  // Read path: apply cleanup in-memory only. The cleaned state is persisted by
  // the next mutation (heartbeats run every few seconds), so reads never write
  // and therefore never race with concurrent writers.
  return rooms.map(cleanupInactivePlayers);
}

export async function updateRoomChallenge(roomId: string, challengeId: string | null): Promise<Room | undefined> {
  const rooms = await mutateRooms((rs) => {
    const room = rs.find(r => r.id === roomId);
    if (room) {
      room.activeChallengeId = challengeId;
      // New challenge → new round: players wait again until the battle (re)starts.
      room.battleStartedAt = null;
    }
  });
  return rooms.find(r => r.id === roomId);
}

// Force-start the battle (admin) — begins the round even if the room isn't full.
export async function startBattle(roomId: string): Promise<Room | undefined> {
  const rooms = await mutateRooms((rs) => {
    const room = rs.find(r => r.id === roomId);
    if (room && room.activeChallengeId && room.battleStartedAt == null) {
      room.battleStartedAt = Date.now();
    }
  });
  return rooms.find(r => r.id === roomId);
}

// Full session reset: clear the challenge, battle, and player list, and bump
// resetAt so every connected client returns to the /play lobby on its next
// heartbeat. Scores/replay requests are cleared separately by the caller.
export async function resetRoom(roomId: string): Promise<Room | undefined> {
  const rooms = await mutateRooms((rs) => {
    const room = rs.find(r => r.id === roomId);
    if (room) {
      room.activeChallengeId = null;
      room.battleStartedAt = null;
      room.players = [];
      room.resetAt = Date.now();
    }
  });
  return rooms.find(r => r.id === roomId);
}

export async function updateRoomMaxUsers(roomId: string, maxUsers: number): Promise<Room | undefined> {
  const rooms = await mutateRooms((rs) => {
    const room = rs.find(r => r.id === roomId);
    if (room) room.maxUsers = Math.max(1, Math.min(20, maxUsers));
  });
  return rooms.find(r => r.id === roomId);
}

export async function registerPlayerHeartbeat(roomId: string, playerName: string): Promise<Room | undefined> {
  // `rejected` = the room doesn't exist or is full; distinguished from a normal
  // update so the caller can still return 404 while the transaction only persists
  // the (cleaned) state without adding this player.
  let rejected = false;
  const rooms = await mutateRooms((rs) => {
    const room = rs.find(r => r.id === roomId);
    if (!room) { rejected = true; return; }
    room.players = room.players ?? [];
    const now = Date.now();
    const name = playerName.trim();
    const wasEmpty = room.players.length === 0;
    const idx = room.players.findIndex(p => p.playerName.toLowerCase() === name.toLowerCase());
    if (idx !== -1) {
      room.players[idx].lastSeen = now;
      room.players[idx].playerName = name;
    } else if (room.players.length < room.maxUsers) {
      room.players.push({ playerName: name, lastSeen: now });
    } else {
      rejected = true;
      return;
    }
    // First player into an empty room begins a fresh round: clear any stale
    // battle timestamp so they wait (and auto-start can fire again when full).
    if (wasEmpty) {
      room.battleStartedAt = null;
    }
    // Auto-start the battle once every slot is filled and a challenge is set.
    if (room.activeChallengeId && room.battleStartedAt == null && room.players.length >= room.maxUsers) {
      room.battleStartedAt = now;
    }
  });
  if (rejected) return undefined;
  return rooms.find(r => r.id === roomId);
}

export async function loadRoomSubmissions(roomId?: string): Promise<RoomSubmission[]> {
  const all = await blobGet<RoomSubmission[]>("rooms", "submissions", []);
  return roomId ? all.filter(s => s.roomId === roomId) : all;
}

export async function addRoomSubmission(
  roomId: string,
  playerName: string,
  score: number,
  timeTakenToPrompt: number,
  difficulty: "easy" | "medium" | "hard",
  timestamp?: number,
  prompt?: string,
  email?: string,
  autoSubmitted?: boolean
): Promise<RoomSubmission[]> {
  const name = playerName.trim() || "Anonymous";
  const ts = timestamp ?? Date.now();
  const all = await blobUpdate<RoomSubmission[]>("rooms", "submissions", [], (cur) => {
    const rest = cur.filter(s => !(s.roomId === roomId && s.playerName.toLowerCase() === name.toLowerCase()));
    rest.push({
      roomId,
      playerName: name,
      score,
      // No final score yet — it stays undefined until the video is analyzed, so
      // the admin shows "scoring…" rather than the text score prematurely. The
      // composite (see computeFinalScore in lib/scoring.ts) is written once
      // video analysis resolves.
      timeTakenToPrompt,
      difficulty,
      timestamp: ts,
      videoAnalysisStatus: "pending",
      ...(prompt ? { prompt } : {}),
      ...(email ? { email } : {}),
      ...(autoSubmitted ? { autoSubmitted: true } : {}),
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
  const compositeScore = computeFinalScore(textScore, videoScore)!;
  const name = playerName.trim();
  const updated = await blobUpdate<RoomSubmission[]>("rooms", "submissions", [], (current) => {
    const submission = current.find(
      s => s.roomId === roomId && s.playerName.toLowerCase() === name.toLowerCase()
    );
    if (submission) {
      submission.videoScore = videoScore;
      submission.compositeScore = compositeScore;
      submission.videoAnalysisStatus = "completed";
    }
    return current;
  });
  return updated.find(s => s.roomId === roomId && s.playerName.toLowerCase() === name.toLowerCase()) || null;
}

// Finalize a submission as text-only when no video score can be produced (video
// generation failed, frame extraction/vision scoring errored, etc.). The prompt
// score becomes the final score so the admin stops showing "scoring…". Never
// overrides a submission that already completed video analysis.
export async function markRoomSubmissionVideoUnavailable(
  roomId: string,
  playerName: string
): Promise<void> {
  const name = playerName.trim();
  await blobUpdate<RoomSubmission[]>("rooms", "submissions", [], (current) => {
    const submission = current.find(
      s => s.roomId === roomId && s.playerName.toLowerCase() === name.toLowerCase()
    );
    if (submission && submission.videoAnalysisStatus !== "completed") {
      submission.compositeScore = submission.score;
      submission.videoAnalysisStatus = "failed";
    }
    return current;
  });
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
