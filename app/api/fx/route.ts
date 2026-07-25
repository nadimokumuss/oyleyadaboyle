import { NextResponse } from "next/server";
import { getFx } from "@/lib/market/fxStore";
import { TRACKED_CURRENCIES } from "@/lib/market/frankfurter";
import { assertAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET /api/fx — 1 USD karşılığı kur tablosu */
export async function GET() {
  await assertAuth();
  try {
    const fx = await getFx();
    const rates: Record<string, string> = { USD: "1" };
    for (const code of TRACKED_CURRENCIES) {
      if (fx.converter.has(code)) {
        rates[code] = fx.converter.rate("USD", code).toFixed();
      }
    }
    return NextResponse.json({
      base: "USD",
      rates,
      date: fx.date,
      stale: fx.stale,
      ageMs: fx.ageMs,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 });
  }
}
