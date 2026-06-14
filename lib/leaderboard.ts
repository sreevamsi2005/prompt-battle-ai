const PLAYER_NAME_KEY = "pb_player_name";

export function getPlayerName(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PLAYER_NAME_KEY);
}

export function setPlayerName(name: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PLAYER_NAME_KEY, name.trim());
}
