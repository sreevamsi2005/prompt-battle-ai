import { blobGet, blobSet } from "./blob-storage";

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
  score: number;
  timestamp: number;
  roomId: string;
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

export async function addRoomSubmission(roomId: string, playerName: string, score: number): Promise<RoomSubmission[]> {
  const all = await blobGet<RoomSubmission[]>("rooms", "submissions", []);
  const name = playerName.trim() || "Anonymous";
  const rest = all.filter(s => !(s.roomId === roomId && s.playerName.toLowerCase() === name.toLowerCase()));
  rest.push({ roomId, playerName: name, score, timestamp: Date.now() });
  await blobSet("rooms", "submissions", rest);
  return rest.filter(s => s.roomId === roomId);
}
