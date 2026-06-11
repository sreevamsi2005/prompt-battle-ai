import { blobGet, blobSet } from "./blob-storage";

export interface SlotClaim {
  slotNum: number;
  deviceId: string;
  playerName: string;
  lastSeen: number;
}

const TIMEOUT_MS = 15_000;

async function loadClaims(): Promise<SlotClaim[]> {
  const all = await blobGet<SlotClaim[]>("slots", "claims", []);
  const now = Date.now();
  // Drop stale claims automatically
  return all.filter(c => now - c.lastSeen < TIMEOUT_MS);
}

async function saveClaims(claims: SlotClaim[]): Promise<void> {
  await blobSet("slots", "claims", claims);
}

export async function claimSlot(
  slotNum: number,
  deviceId: string,
  playerName: string
): Promise<{ ok: true } | { ok: false; takenBy: string }> {
  const claims = await loadClaims();
  const existing = claims.find(c => c.slotNum === slotNum);

  if (existing && existing.deviceId !== deviceId) {
    return { ok: false, takenBy: existing.playerName };
  }

  const rest = claims.filter(c => c.slotNum !== slotNum);
  rest.push({ slotNum, deviceId, playerName, lastSeen: Date.now() });
  await saveClaims(rest);
  return { ok: true };
}

export async function heartbeatSlot(slotNum: number, deviceId: string): Promise<boolean> {
  const claims = await loadClaims();
  const idx = claims.findIndex(c => c.slotNum === slotNum && c.deviceId === deviceId);
  if (idx === -1) return false;
  claims[idx].lastSeen = Date.now();
  await saveClaims(claims);
  return true;
}

export async function releaseSlot(slotNum: number, deviceId: string): Promise<void> {
  const claims = await loadClaims();
  await saveClaims(claims.filter(c => !(c.slotNum === slotNum && c.deviceId === deviceId)));
}

export async function getSlotClaim(slotNum: number): Promise<SlotClaim | null> {
  const claims = await loadClaims();
  return claims.find(c => c.slotNum === slotNum) ?? null;
}
