import { NextResponse } from "next/server";
import { loadDataSheet, toCSV } from "@/lib/csv-export";

export async function GET() {
  try {
    const rows = await loadDataSheet();
    const csv = toCSV(rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="promptbattle-data-${Date.now()}.csv"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
