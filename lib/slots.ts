import { blobGetWithEtag, blobSetIfNew, blobSetIfMatch, blobDelete } from "./blob-storage";

export interface SlotClaim {
  slotNum: number;
  deviceId: string;
  playerName: string;
  lastSeen: number;
}

// A claim is considered abandoned if no heartbeat arrives within this window.
// Clients heartbeat every 5s, so 15s tolerates two missed beats before release.
const TIMEOUT_MS = 15_000;

// Each slot is its own blob key so claims are independent and writes are atomic.
const slotKey = (slotNum: number) => `slot-${slotNum}`;

function isStale(claim: SlotClaim, now: number): boolean {
  return now - claim.lastSeen >= TIMEOUT_MS;
}

/**
 * Attempt to claim a slot for a device. Atomic: if two devices race for the
 * same free slot, exactly one wins — the other is told who holds it.
 */
export async function claimSlot(
  slotNum: number,
  deviceId: string,
  playerName: string
): Promise<{ ok: true } | { ok: false; takenBy: string }> {
  const now = Date.now();
  const { value: existing, etag } = await blobGetWithEtag<SlotClaim>("slots", slotKey(slotNum));
  const claim: SlotClaim = { slotNum, deviceId, playerName, lastSeen: now };

  // Case 1: nobody holds it (or never created) — claim atomically.
  if (!existing) {
    const { modified } = await blobSetIfNew("slots", slotKey(slotNum), claim);
    if (modified) return { ok: true };
    // Lost the race — someone created it microseconds ago. Re-read to report them.
    const { value: winner } = await blobGetWithEtag<SlotClaim>("slots", slotKey(slotNum));
    if (winner && winner.deviceId === deviceId) return { ok: true };
    return { ok: false, takenBy: winner?.playerName ?? "another player" };
  }

  // Case 2: we already hold it (same device re-joining) — renew.
  if (existing.deviceId === deviceId) {
    if (etag) await blobSetIfMatch("slots", slotKey(slotNum), claim, etag);
    return { ok: true };
  }

  // Case 3: someone else holds it and it's still live — reject.
  if (!isStale(existing, now)) {
    return { ok: false, takenBy: existing.playerName };
  }

  // Case 4: stale claim — take it over, but only if nobody else touched it first.
  if (etag) {
    const { modified } = await blobSetIfMatch("slots", slotKey(slotNum), claim, etag);
    if (modified) return { ok: true };
  }
  // The owner heartbeated or another device grabbed it between our read and write.
  const { value: winner } = await blobGetWithEtag<SlotClaim>("slots", slotKey(slotNum));
  if (winner && winner.deviceId === deviceId) return { ok: true };
  return { ok: false, takenBy: winner?.playerName ?? "another player" };
}

/** Refresh the heartbeat. Returns false if the device no longer owns the slot. */
export async function heartbeatSlot(slotNum: number, deviceId: string): Promise<boolean> {
  const { value: existing, etag } = await blobGetWithEtag<SlotClaim>("slots", slotKey(slotNum));
  if (!existing || existing.deviceId !== deviceId || !etag) return false;
  const renewed: SlotClaim = { ...existing, lastSeen: Date.now() };
  const { modified } = await blobSetIfMatch("slots", slotKey(slotNum), renewed, etag);
  return modified;
}

/** Release a slot — only the owning device may delete its claim. */
export async function releaseSlot(slotNum: number, deviceId: string): Promise<void> {
  const { value: existing } = await blobGetWithEtag<SlotClaim>("slots", slotKey(slotNum));
  if (existing && existing.deviceId === deviceId) {
    await blobDelete("slots", slotKey(slotNum));
  }
}

export async function getSlotClaim(slotNum: number): Promise<SlotClaim | null> {
  const { value } = await blobGetWithEtag<SlotClaim>("slots", slotKey(slotNum));
  if (!value) return null;
  return isStale(value, Date.now()) ? null : value;
}
