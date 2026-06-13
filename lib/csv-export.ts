import { blobGet, blobUpdate } from "./blob-storage";

export interface DataSheetRow {
  id: string;
  timestamp: number;
  playerName: string;
  email: string;
  videoId: string;
  videoTag: string;
  difficulty: string;
  similarityScore: number;
  timeTakenToPrompt: number;
  normalizedScore: number;
  leaderboardScore: number;
}

export async function appendDataSheetRow(row: DataSheetRow): Promise<void> {
  await blobUpdate<DataSheetRow[]>("data-sheet", "rows", [], (cur) => [...cur, row]);
}

export async function loadDataSheet(): Promise<DataSheetRow[]> {
  return blobGet<DataSheetRow[]>("data-sheet", "rows", []);
}

export function toCSV(rows: DataSheetRow[]): string {
  const headers = [
    "id", "timestamp", "playerName", "email",
    "videoId", "videoTag", "difficulty", "similarityScore",
    "timeTakenToPrompt", "normalizedScore", "leaderboardScore",
  ];
  const escape = (v: string | number) =>
    typeof v === "number" ? String(v) : `"${String(v).replace(/"/g, '""')}"`;

  return [
    headers.join(","),
    ...rows.map(r =>
      [
        escape(r.id),
        r.timestamp,
        escape(r.playerName),
        escape(r.email),
        escape(r.videoId),
        escape(r.videoTag),
        escape(r.difficulty ?? ""),
        r.similarityScore,
        r.timeTakenToPrompt,
        r.normalizedScore,
        r.leaderboardScore,
      ].join(",")
    ),
  ].join("\n");
}
