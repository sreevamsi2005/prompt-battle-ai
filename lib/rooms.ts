import fs from "fs";
import path from "path";
import { getPromptById } from "./booth-prompts";

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

const ROOMS_FILE = path.join(process.cwd(), "data", "rooms.json");
const ROOM_SUBMISSIONS_FILE = path.join(process.cwd(), "data", "room-submissions.json");

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Clean up players who haven't sent a heartbeat in the last 15 seconds
function cleanupInactivePlayers(room: Room): Room {
  const now = Date.now();
  const activePlayers = room.players?.filter(p => now - p.lastSeen < 15000) || [];
  return {
    ...room,
    players: activePlayers
  };
}

export function loadRooms(): Room[] {
  try {
    ensureDir(ROOMS_FILE);
    if (fs.existsSync(ROOMS_FILE)) {
      const raw = fs.readFileSync(ROOMS_FILE, "utf-8");
      const rooms = JSON.parse(raw) as Room[];
      // Apply cleanup for each room
      const cleaned = rooms.map(cleanupInactivePlayers);
      // Save cleaned rooms if any changes occurred
      let changed = false;
      for (let i = 0; i < rooms.length; i++) {
        if ((rooms[i].players?.length || 0) !== (cleaned[i].players?.length || 0)) {
          changed = true;
          break;
        }
      }
      if (changed) {
        saveRooms(cleaned);
      }
      return cleaned;
    }
  } catch (err) {
    console.error("Error loading rooms:", err);
  }
  return [];
}

export function saveRooms(rooms: Room[]) {
  try {
    ensureDir(ROOMS_FILE);
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(rooms, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving rooms:", err);
  }
}

export function getRoomById(id: string): Room | undefined {
  const rooms = loadRooms();
  return rooms.find(r => r.id === id);
}

export function createRoom(name: string, maxUsers: number): Room[] {
  const rooms = loadRooms();
  const id = `room-${Date.now().toString(36)}`;
  const newRoom: Room = {
    id,
    name: name.trim() || "New Room",
    maxUsers: maxUsers > 0 ? maxUsers : 4,
    activeChallengeId: null,
    createdAt: Date.now(),
    players: []
  };
  rooms.push(newRoom);
  saveRooms(rooms);
  return rooms;
}

export function updateRoomChallenge(roomId: string, challengeId: string | null): Room | undefined {
  const rooms = loadRooms();
  const room = rooms.find(r => r.id === roomId);
  if (room) {
    room.activeChallengeId = challengeId;
    saveRooms(rooms);
  }
  return room;
}

export function deleteRoom(id: string): Room[] {
  const rooms = loadRooms();
  const filtered = rooms.filter(r => r.id !== id);
  saveRooms(filtered);
  return filtered;
}

// Heartbeat function to register user presence and return active player list
export function registerPlayerHeartbeat(roomId: string, playerName: string): Room | undefined {
  const rooms = loadRooms();
  const room = rooms.find(r => r.id === roomId);
  if (!room) return undefined;

  room.players = room.players || [];
  const now = Date.now();
  const formattedName = playerName.trim();

  // Find existing player or add new one
  const existingIdx = room.players.findIndex(p => p.playerName.toLowerCase() === formattedName.toLowerCase());
  if (existingIdx !== -1) {
    room.players[existingIdx].lastSeen = now;
    // Update name casing just in case
    room.players[existingIdx].playerName = formattedName;
  } else {
    // Check limit
    if (room.players.length < room.maxUsers) {
      room.players.push({
        playerName: formattedName,
        lastSeen: now
      });
    } else {
      // Room full, but if we already exceeded it, let's deny
      return undefined;
    }
  }

  // Save room state
  saveRooms(rooms);
  return room;
}

export function loadRoomSubmissions(roomId?: string): RoomSubmission[] {
  try {
    ensureDir(ROOM_SUBMISSIONS_FILE);
    if (fs.existsSync(ROOM_SUBMISSIONS_FILE)) {
      const raw = fs.readFileSync(ROOM_SUBMISSIONS_FILE, "utf-8");
      const submissions = JSON.parse(raw) as RoomSubmission[];
      if (roomId) {
        return submissions.filter(s => s.roomId === roomId);
      }
      return submissions;
    }
  } catch (err) {
    console.error("Error loading room submissions:", err);
  }
  return [];
}

export function addRoomSubmission(roomId: string, playerName: string, score: number): RoomSubmission[] {
  try {
    ensureDir(ROOM_SUBMISSIONS_FILE);
    let submissions: RoomSubmission[] = [];
    if (fs.existsSync(ROOM_SUBMISSIONS_FILE)) {
      const raw = fs.readFileSync(ROOM_SUBMISSIONS_FILE, "utf-8");
      submissions = JSON.parse(raw);
    }

    // Add or replace if player plays again in the same room
    const filtered = submissions.filter(s => !(s.roomId === roomId && s.playerName.toLowerCase() === playerName.toLowerCase()));
    
    filtered.push({
      roomId,
      playerName: playerName.trim() || "Anonymous",
      score,
      timestamp: Date.now()
    });

    fs.writeFileSync(ROOM_SUBMISSIONS_FILE, JSON.stringify(filtered, null, 2), "utf-8");
    return filtered.filter(s => s.roomId === roomId);
  } catch (err) {
    console.error("Error adding room submission:", err);
  }
  return [];
}
