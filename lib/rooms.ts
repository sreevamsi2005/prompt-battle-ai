import { blobGet, blobSet, blobUpdate } from "./blob-storage";

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
  score: number;   // similarity 0-100 from the scoring model
  points: number;  // competition points awarded (difficulty × similarity tier)
  timestamp: number;
  roomId: string;
}

export interface ReplayRequest {
  roomId: string;
  playerName: string;
  timestamp: number;
}

function cleanupInactivePlayers(room: Room): Room {
  const now = Date.now();
  return { ...room, players: (room.players ?? []).filter(p => now - p.lastSeen < 15000) };
}

export async function loadRooms(): Promise<Room[]> {
  const rooms = await blobGet<Room[]>("rooms", "rooms", []);
  const cleaned = rooms.map(cleanupInactivePlayers);
  const changed = rooms.some((r, i) => (r.players?.length ?? 0) !== (cleaned[i].players?.length ?? 0));
  if (changed) await saveRooms(cleaned);
  return cleaned;
}

export async function saveRooms(rooms: Room[]): Promise<void> {
  await blobSet("rooms", "rooms", rooms);
}

export async function getRoomById(id: string): Promise<Room | undefined> {
  const rooms = await loadRooms();
  return rooms.find(r => r.id === id);
}

export async function createRoom(name: string, maxUsers: number): Promise<Room[]> {
  const rooms = await loadRooms();
  rooms.push({
    id: `room-${Date.now().toString(36)}`,
    name: name.trim() || "New Room",
    maxUsers: maxUsers > 0 ? maxUsers : 4,
    activeChallengeId: null,
    createdAt: Date.now(),
    players: [],
  });
  await saveRooms(rooms);
  return rooms;
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

export async function deleteRoom(id: string): Promise<Room[]> {
  const rooms = await loadRooms();
  const filtered = rooms.filter(r => r.id !== id);
  await saveRooms(filtered);
  return filtered;
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
  points: number
): Promise<RoomSubmission[]> {
  const name = playerName.trim() || "Anonymous";
  // Atomic update — concurrent submitters can't overwrite each other's rows.
  const all = await blobUpdate<RoomSubmission[]>("rooms", "submissions", [], (cur) => {
    const rest = cur.filter(s => !(s.roomId === roomId && s.playerName.toLowerCase() === name.toLowerCase()));
    rest.push({ roomId, playerName: name, score, points, timestamp: Date.now() });
    return rest;
  });
  return all.filter(s => s.roomId === roomId);
}

export async function clearRoomSubmissions(roomId: string): Promise<void> {
  await blobUpdate<RoomSubmission[]>("rooms", "submissions", [], (cur) =>
    cur.filter(s => s.roomId !== roomId)
  );
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
